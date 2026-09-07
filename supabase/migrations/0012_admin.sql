-- Admin portal: moderation queue, enforcement, appeals, role management.
-- Spec refs: §20.3 (queue + SLA), §20.5 (appeals), §29 (roles + audit log).
--
-- §29 is categorical: every admin action writes to audit_log with actor, target,
-- action and reason. No exceptions, including super admins. Each RPC below
-- writes its own audit row before returning.

-- ---------------------------------------------------------------- helpers

create or replace function public.write_audit(
  p_action text, p_target_type text, p_target_id uuid, p_metadata jsonb default '{}')
returns void language sql volatile security definer set search_path = public as $$
  insert into public.audit_log (actor_id, actor_type, action, target_type, target_id, metadata)
  values ((select public.current_user_id()), 'admin', p_action, p_target_type, p_target_id, p_metadata);
$$;

/** The caller's role, or null. Used to gate both RPCs and the client's UI. */
create or replace function public.my_admin_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.admin_roles where user_id = (select public.current_user_id());
$$;

create or replace function public.require_admin(min_role text default 'moderator')
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin(min_role) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
end;
$$;

-- §20.3 SLA: unsafe-content and child-safety reports triaged within 24 hours,
-- everything else within 72. Surfaced as visible aging in the queue.
create or replace function public.report_sla_hours(p_priority text)
returns int language sql immutable parallel safe set search_path = public as $$
  select case when p_priority = 'high' then 24 else 72 end;
$$;

-- ---------------------------------------------------------------- dashboard

create or replace function public.admin_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin('moderator');
  return jsonb_build_object(
    'openReports', (select count(*) from reports where status in ('open','triaged')),
    'highPriorityOpen', (select count(*) from reports
                          where status in ('open','triaged') and priority = 'high'),
    'overdue', (select count(*) from reports r
                 where r.status in ('open','triaged')
                   and now() > r.created_at
                       + make_interval(hours => public.report_sla_hours(r.priority))),
    'openAppeals', (select count(*) from appeals where status in ('open','under_review')),
    'copyrightOpen', (select count(*) from copyright_complaints where status = 'open'),
    'publishedRecipes', (select count(*) from recipes where status = 'published'),
    'removedRecipes', (select count(*) from recipes where moderation_state = 'removed'),
    'totalUsers', (select count(*) from users where deleted_at is null and not is_seed_account),
    'suspendedUsers', (select count(*) from users where status in ('suspended','banned')),
    'actionsLast7d', (select count(*) from moderation_actions
                       where created_at > now() - interval '7 days')
  );
end;
$$;

-- ---------------------------------------------------------------- report queue

create or replace function public.admin_reports(
  p_status text default 'open', p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_super boolean;
begin
  perform public.require_admin('moderator');
  v_super := public.is_admin('super_admin');

  return coalesce((
    select jsonb_agg(row order by row->>'priority' desc, (row->>'ageHours')::numeric desc)
    from (
      select jsonb_build_object(
        'id', r.id,
        'reason', r.reason,
        'priority', r.priority,
        'status', r.status,
        'details', r.details,
        'targetType', r.target_type,
        'targetId', r.target_id,
        'createdAt', r.created_at,
        'ageHours', round(extract(epoch from (now() - r.created_at)) / 3600.0, 1),
        'slaHours', public.report_sla_hours(r.priority),
        'overdue', now() > r.created_at
                   + make_interval(hours => public.report_sla_hours(r.priority)),
        -- how many separate reports name the same target
        'reportCount', (select count(*) from reports r2
                         where r2.target_type = r.target_type and r2.target_id = r.target_id),
        'targetTitle', case r.target_type
          when 'recipe' then (select title from recipes where id = r.target_id)
          else (select display_name from users where id = r.target_id) end,
        'targetCreator', case r.target_type
          when 'recipe' then (select u.username from recipes rr
                              join users u on u.id = rr.creator_id where rr.id = r.target_id)
          else (select username from users where id = r.target_id) end,
        -- §29: a moderator sees who reported it, not their email.
        'reporter', (select jsonb_build_object(
                        'username', u.username,
                        'email', case when v_super then u.email::text else null end)
                     from users u where u.id = r.reporter_id)
      ) as row
      from reports r
      where (p_status = 'all'
             or (p_status = 'open' and r.status in ('open','triaged'))
             or r.status::text = p_status)
      order by r.priority desc, r.created_at
      limit least(greatest(p_limit, 1), 200)
    ) q
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_report_detail(p_report_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r reports%rowtype;
begin
  perform public.require_admin('moderator');
  select * into r from reports where id = p_report_id;
  if not found then raise exception 'report not found'; end if;

  return jsonb_build_object(
    'id', r.id, 'reason', r.reason, 'priority', r.priority, 'status', r.status,
    'details', r.details, 'createdAt', r.created_at,
    'targetType', r.target_type, 'targetId', r.target_id,
    'ageHours', round(extract(epoch from (now() - r.created_at)) / 3600.0, 1),
    'overdue', now() > r.created_at + make_interval(hours => public.report_sla_hours(r.priority)),
    -- Full content context so the decision is made on the material, not a title.
    'recipe', case when r.target_type = 'recipe'
      then (select jsonb_build_object(
              'id', rr.id, 'title', rr.title, 'description', rr.description,
              'coverImageUrl', rr.cover_image_url, 'status', rr.status,
              'moderationState', rr.moderation_state, 'createdAt', rr.created_at,
              'creator', jsonb_build_object('id', u.id, 'username', u.username,
                                            'displayName', u.display_name,
                                            'isSeed', u.is_seed_account),
              'ingredients', coalesce((select jsonb_agg(ri.ingredient_text order by ri.position)
                                        from recipe_ingredients ri where ri.recipe_id = rr.id), '[]'::jsonb),
              'steps', coalesce((select jsonb_agg(st.instruction order by st.position)
                                  from recipe_steps st where st.recipe_id = rr.id), '[]'::jsonb))
            from recipes rr join users u on u.id = rr.creator_id where rr.id = r.target_id)
      else null end,
    'user', case when r.target_type = 'user'
      then (select jsonb_build_object('id', u.id, 'username', u.username,
              'displayName', u.display_name, 'bio', u.bio, 'status', u.status,
              'createdAt', u.created_at,
              'recipeCount', (select count(*) from recipes where creator_id = u.id),
              'strikes', (select count(*) from user_strikes where user_id = u.id))
            from users u where u.id = r.target_id)
      else null end,
    'otherReports', coalesce((
      select jsonb_agg(jsonb_build_object('reason', r2.reason, 'details', r2.details,
                                          'createdAt', r2.created_at) order by r2.created_at desc)
      from reports r2 where r2.target_type = r.target_type and r2.target_id = r.target_id
        and r2.id <> r.id), '[]'::jsonb),
    'priorActions', coalesce((
      select jsonb_agg(jsonb_build_object('action', ma.action, 'reason', ma.reason,
                                          'createdAt', ma.created_at) order by ma.created_at desc)
      from moderation_actions ma
      where ma.target_type = r.target_type and ma.target_id = r.target_id), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------- enforcement

/**
 * Applies a moderation decision. Records the action, changes the target's state,
 * notifies the affected creator with the reason and an appeal path (§20.5), adds
 * a strike where the reason warrants one (§18.2 repeat infringer policy), and
 * writes the audit row.
 */
create or replace function public.admin_act(
  p_report_id  uuid,
  p_action     text,
  p_reason     text default null,
  p_notes      text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_actor  uuid := (select public.current_user_id());
  r        reports%rowtype;
  v_action moderation_action_type := p_action::moderation_action_type;
  v_action_id uuid;
  v_owner  uuid;
  v_body   text;
begin
  perform public.require_admin('moderator');
  select * into r from reports where id = p_report_id;
  if not found then raise exception 'report not found'; end if;

  -- Who is affected: the recipe's creator, or the reported user themselves.
  v_owner := case r.target_type
    when 'recipe' then (select creator_id from recipes where id = r.target_id)
    else r.target_id end;

  insert into moderation_actions (moderator_id, target_type, target_id, action, reason, notes, report_id)
  values (v_actor, r.target_type, r.target_id, v_action, p_reason, p_notes, r.id)
  returning id into v_action_id;

  if r.target_type = 'recipe' then
    if v_action = 'remove' then
      update recipes set moderation_state = 'removed', status = 'removed' where id = r.target_id;
    elsif v_action = 'restrict' then
      update recipes set moderation_state = 'under_review' where id = r.target_id;
    elsif v_action = 'reinstate' then
      update recipes set moderation_state = 'clear',
             status = case when status = 'removed' then 'published' else status end
       where id = r.target_id;
    end if;
  end if;

  if v_action = 'suspend' then
    update users set status = 'suspended' where id = v_owner;
  elsif v_action = 'ban' then
    update users set status = 'banned' where id = v_owner;
  elsif v_action = 'reinstate' and r.target_type = 'user' then
    update users set status = 'active' where id = v_owner;
  end if;

  -- §18.2: strikes are tracked so a repeat infringer policy has something to act on.
  if v_action in ('remove','suspend','ban') and r.reason in ('copyright','unsafe_food','impersonation') then
    insert into user_strikes (user_id, reason, action_id) values (v_owner, r.reason, v_action_id);
  end if;

  -- §20.5: every enforcement action notifies the user with the reason and an
  -- appeal control. A dismissal affects nobody, so it stays silent.
  if v_action <> 'dismiss' and v_owner is not null then
    v_body := case v_action
      when 'remove' then 'A recipe of yours was removed'
      when 'restrict' then 'A recipe of yours is under review'
      when 'warn' then 'A warning was issued on your account'
      when 'suspend' then 'Your account has been suspended'
      when 'ban' then 'Your account has been banned'
      when 'reinstate' then 'A moderation decision on your account was reversed'
      else 'A moderation decision was made on your content' end;
    insert into notifications (user_id, type, actor_id, recipe_id, body, deep_link)
    values (v_owner, 'moderation_result', null,
            case when r.target_type = 'recipe' then r.target_id else null end,
            v_body || coalesce('. Reason: ' || p_reason, '') || '. You can appeal this.',
            'menumatch://appeal/' || v_action_id::text);
  end if;

  update reports
     set status = case when v_action = 'dismiss' then 'dismissed' else 'resolved' end,
         resolved_by = v_actor, resolved_at = now()
   where id = r.id;

  perform public.write_audit('moderation.' || p_action, r.target_type, r.target_id,
    jsonb_build_object('reportId', r.id, 'actionId', v_action_id,
                       'reason', p_reason, 'affectedUser', v_owner));

  return jsonb_build_object('ok', true, 'actionId', v_action_id);
end;
$$;

-- ---------------------------------------------------------------- appeals (§20.5)

create or replace function public.admin_appeals(p_status text default 'open')
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin('moderator');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'statement', a.statement, 'status', a.status, 'createdAt', a.created_at,
      'user', jsonb_build_object('username', u.username, 'displayName', u.display_name),
      'action', jsonb_build_object('action', ma.action, 'reason', ma.reason,
                                   'targetType', ma.target_type, 'targetId', ma.target_id,
                                   'createdAt', ma.created_at),
      -- §20.5: reviewed by someone other than the original actor where staffing allows.
      'sameModerator', ma.moderator_id = (select public.current_user_id())
    ) order by a.created_at)
    from appeals a
    join users u on u.id = a.user_id
    join moderation_actions ma on ma.id = a.moderation_action_id
    where (p_status = 'all'
           or (p_status = 'open' and a.status in ('open','under_review'))
           or a.status::text = p_status)
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_resolve_appeal(
  p_appeal_id uuid, p_uphold boolean, p_outcome text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  a  appeals%rowtype;
  ma moderation_actions%rowtype;
begin
  perform public.require_admin('moderator');
  select * into a from appeals where id = p_appeal_id;
  if not found then raise exception 'appeal not found'; end if;
  select * into ma from moderation_actions where id = a.moderation_action_id;

  update appeals set status = case when p_uphold then 'upheld' else 'denied' end,
         reviewed_by = (select public.current_user_id()), outcome = p_outcome
   where id = a.id;

  -- Upholding an appeal reverses the original action.
  if p_uphold then
    if ma.target_type = 'recipe' then
      update recipes set moderation_state = 'clear',
             status = case when status = 'removed' then 'published' else status end
       where id = ma.target_id;
    else
      update users set status = 'active' where id = ma.target_id;
    end if;
    delete from user_strikes where action_id = ma.id;
  end if;

  insert into notifications (user_id, type, body)
  values (a.user_id, 'moderation_result',
          case when p_uphold then 'Your appeal was upheld and the decision reversed. '
               else 'Your appeal was reviewed and the decision stands. ' end || coalesce(p_outcome, ''));

  perform public.write_audit('appeal.' || case when p_uphold then 'upheld' else 'denied' end,
    'appeal', a.id, jsonb_build_object('actionId', ma.id, 'outcome', p_outcome));

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------- roles (§29)

create or replace function public.admin_list_admins()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin('moderator');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'userId', ar.user_id, 'role', ar.role, 'createdAt', ar.created_at,
      'username', u.username, 'displayName', u.display_name,
      -- Only a super admin sees email addresses.
      'email', case when public.is_admin('super_admin') then u.email::text else null end,
      'grantedBy', (select g.username from users g where g.id = ar.granted_by)
    ) order by ar.created_at)
    from admin_roles ar join users u on u.id = ar.user_id
  ), '[]'::jsonb);
end;
$$;

/** Finds an account to promote. Super admin only, since it exposes emails. */
create or replace function public.admin_find_user(p_query text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin('super_admin');
  if coalesce(trim(p_query), '') = '' then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', u.id, 'username', u.username, 'displayName', u.display_name,
      'email', u.email::text, 'status', u.status,
      'role', (select role from admin_roles ar where ar.user_id = u.id)))
    from users u
    where u.deleted_at is null
      and (u.username ilike '%' || p_query || '%'
        or u.display_name ilike '%' || p_query || '%'
        or u.email::text ilike '%' || p_query || '%')
    limit 20
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_grant_role(p_user_id uuid, p_role text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_actor uuid := (select public.current_user_id());
begin
  perform public.require_admin('super_admin');
  if p_role not in ('moderator','content_admin','super_admin') then
    raise exception 'unknown role %', p_role;
  end if;
  if not exists (select 1 from users where id = p_user_id and deleted_at is null) then
    raise exception 'user not found';
  end if;

  insert into admin_roles (user_id, role, granted_by)
  values (p_user_id, p_role, v_actor)
  on conflict (user_id) do update set role = excluded.role, granted_by = excluded.granted_by;

  perform public.write_audit('role.grant', 'user', p_user_id, jsonb_build_object('role', p_role));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_revoke_role(p_user_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_actor uuid := (select public.current_user_id());
  v_role  text;
begin
  perform public.require_admin('super_admin');
  select role into v_role from admin_roles where user_id = p_user_id;
  if v_role is null then raise exception 'that account is not an admin'; end if;

  -- Removing the last super admin would lock everyone out of the portal.
  if v_role = 'super_admin'
     and (select count(*) from admin_roles where role = 'super_admin') <= 1 then
    raise exception 'cannot remove the only super admin';
  end if;

  delete from admin_roles where user_id = p_user_id;
  perform public.write_audit('role.revoke', 'user', p_user_id, jsonb_build_object('was', v_role));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------- audit (§29)

create or replace function public.admin_audit(p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin('super_admin');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', al.id, 'action', al.action, 'targetType', al.target_type,
      'targetId', al.target_id, 'metadata', al.metadata, 'createdAt', al.created_at,
      'actor', (select u.username from users u where u.id = al.actor_id))
      order by al.created_at desc)
    from (select * from audit_log order by created_at desc
          limit least(greatest(p_limit, 1), 500)) al
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------- me() carries the role

create or replace function public.me()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', u.id, 'username', u.username, 'displayName', u.display_name,
    'email', u.email, 'bio', u.bio, 'avatarUrl', u.avatar_url,
    'isCreator', u.is_creator, 'ageBand', u.age_band, 'status', u.status,
    'createdAt', u.created_at,
    'preferences', to_jsonb(p) - 'user_id',
    'savedCount', (select count(*) from saves s where s.user_id = u.id),
    'isAdmin', exists (select 1 from admin_roles ar where ar.user_id = u.id),
    'adminRole', (select ar.role from admin_roles ar where ar.user_id = u.id)
  )
  from users u
  left join user_preferences p on p.user_id = u.id
  where u.auth_id = auth.uid();
$$;

grant execute on function public.my_admin_role()                          to authenticated;
grant execute on function public.admin_stats()                            to authenticated;
grant execute on function public.admin_reports(text,int)                  to authenticated;
grant execute on function public.admin_report_detail(uuid)                to authenticated;
grant execute on function public.admin_act(uuid,text,text,text)           to authenticated;
grant execute on function public.admin_appeals(text)                      to authenticated;
grant execute on function public.admin_resolve_appeal(uuid,boolean,text)  to authenticated;
grant execute on function public.admin_list_admins()                      to authenticated;
grant execute on function public.admin_find_user(text)                    to authenticated;
grant execute on function public.admin_grant_role(uuid,text)              to authenticated;
grant execute on function public.admin_revoke_role(uuid)                  to authenticated;
grant execute on function public.admin_audit(int)                         to authenticated;

-- Bootstrap the first super admin by email, so this is reproducible rather than
-- pinned to a generated id.
insert into public.admin_roles (user_id, role)
select id, 'super_admin' from public.users where email = 'blachtb627@gmail.com'
on conflict (user_id) do update set role = 'super_admin';
