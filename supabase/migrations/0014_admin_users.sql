-- Admin user management: list, inspect, suspend, ban, delete.
-- Spec refs: §20.3, §28.4 (deletion), §29 (roles, PII limits, audit).

-- "Last active" has no single source, so take the most recent of the signals we
-- actually have. GREATEST ignores nulls, so a user with only one of them still
-- reports correctly. Deliberately does not touch `swipes`: it is the largest
-- table by an order of magnitude and has no (user_id, created_at) index, so
-- scanning it per row would make the list quadratically slow as it grows.
create or replace function public.user_last_active(p_user_id uuid, p_auth_id uuid)
returns timestamptz language sql stable security definer set search_path = public as $$
  select greatest(
    (select max(d.last_seen_at) from devices d where d.user_id = p_user_id),
    (select max(s.created_at)   from saves s   where s.user_id = p_user_id),
    (select au.last_sign_in_at  from auth.users au where au.id = p_auth_id)
  );
$$;

create or replace function public.admin_users(
  p_query  text default '',
  p_status text default 'all',
  p_limit  int  default 50,
  p_offset int  default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_super boolean;
begin
  perform public.require_admin('moderator');
  v_super := public.is_admin('super_admin');

  return jsonb_build_object(
    'total', (select count(*) from users u
               where (p_status = 'all' or u.status::text = p_status)
                 and (coalesce(trim(p_query), '') = ''
                      or u.username ilike '%' || p_query || '%'
                      or u.display_name ilike '%' || p_query || '%'
                      or (v_super and u.email::text ilike '%' || p_query || '%'))),
    'users', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', u.id,
        'username', u.username,
        'displayName', u.display_name,
        -- §29: a moderator does not get user PII beyond what a report requires.
        'email', case when v_super then u.email::text else null end,
        'status', u.status,
        'isCreator', u.is_creator,
        'isSeedAccount', u.is_seed_account,
        'deletedAt', u.deleted_at,
        'createdAt', u.created_at,
        'lastActiveAt', q.sort_key,
        'adminRole', (select ar.role from admin_roles ar where ar.user_id = u.id),
        'recipeCount', (select count(*) from recipes r
                         where r.creator_id = u.id and r.deleted_at is null),
        'saveCount', (select count(*) from saves s where s.user_id = u.id),
        'strikes', (select count(*) from user_strikes st where st.user_id = u.id),
        'reportsAgainst', (select count(*) from reports rp
                            where rp.target_type = 'user' and rp.target_id = u.id)
      ) order by q.sort_key desc nulls last)
      from (
        select u.*, public.user_last_active(u.id, u.auth_id) as sort_key
        from users u
        where (p_status = 'all' or u.status::text = p_status)
          and (coalesce(trim(p_query), '') = ''
               or u.username ilike '%' || p_query || '%'
               or u.display_name ilike '%' || p_query || '%'
               or (v_super and u.email::text ilike '%' || p_query || '%'))
        order by public.user_last_active(u.id, u.auth_id) desc nulls last,
                 u.created_at desc
        limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)
      ) q
      join users u on u.id = q.id
    ), '[]'::jsonb));
end;
$$;

create or replace function public.admin_user_detail(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  u users%rowtype;
  v_super boolean;
begin
  perform public.require_admin('moderator');
  v_super := public.is_admin('super_admin');
  select * into u from users where id = p_user_id;
  if not found then raise exception 'user not found'; end if;

  return jsonb_build_object(
    'id', u.id, 'username', u.username, 'displayName', u.display_name,
    'email', case when v_super then u.email::text else null end,
    'bio', u.bio, 'status', u.status, 'isCreator', u.is_creator,
    'isSeedAccount', u.is_seed_account, 'ageBand', u.age_band,
    'createdAt', u.created_at, 'deletedAt', u.deleted_at,
    'lastActiveAt', public.user_last_active(u.id, u.auth_id),
    'adminRole', (select ar.role from admin_roles ar where ar.user_id = u.id),
    'counts', jsonb_build_object(
      'recipes', (select count(*) from recipes r where r.creator_id = u.id and r.deleted_at is null),
      'published', (select count(*) from recipes r
                     where r.creator_id = u.id and r.status = 'published'),
      'saves', (select count(*) from saves s where s.user_id = u.id),
      'cooks', (select count(*) from cooks c where c.user_id = u.id),
      'collections', (select count(*) from collections c where c.user_id = u.id),
      'reportsFiled', (select count(*) from reports rp where rp.reporter_id = u.id),
      'reportsAgainst', (select count(*) from reports rp
                          where rp.target_type = 'user' and rp.target_id = u.id)),
    'recipes', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title,
        'status', r.status, 'moderationState', r.moderation_state,
        'coverImageUrl', r.cover_image_url, 'createdAt', r.created_at)
        order by r.created_at desc)
      from recipes r where r.creator_id = u.id and r.deleted_at is null), '[]'::jsonb),
    'strikes', coalesce((
      select jsonb_agg(jsonb_build_object('reason', st.reason, 'createdAt', st.created_at)
        order by st.created_at desc)
      from user_strikes st where st.user_id = u.id), '[]'::jsonb),
    -- Reports naming this account, and reports about recipes they published.
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object('id', rp.id, 'reason', rp.reason,
        'status', rp.status, 'details', rp.details, 'createdAt', rp.created_at,
        'targetType', rp.target_type) order by rp.created_at desc)
      from reports rp
      where (rp.target_type = 'user' and rp.target_id = u.id)
         or (rp.target_type = 'recipe' and rp.target_id in
              (select r.id from recipes r where r.creator_id = u.id))), '[]'::jsonb),
    'moderationHistory', coalesce((
      select jsonb_agg(jsonb_build_object('action', ma.action, 'reason', ma.reason,
        'targetType', ma.target_type, 'createdAt', ma.created_at,
        'moderator', (select m.username from users m where m.id = ma.moderator_id))
        order by ma.created_at desc)
      from moderation_actions ma
      where (ma.target_type = 'user' and ma.target_id = u.id)
         or (ma.target_type = 'recipe' and ma.target_id in
              (select r.id from recipes r where r.creator_id = u.id))), '[]'::jsonb)
  );
end;
$$;

/** Suspend, ban or reactivate. Notifies the account and leaves an appeal path. */
create or replace function public.admin_set_user_status(
  p_user_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_actor uuid := (select public.current_user_id());
  u       users%rowtype;
  v_action moderation_action_type;
  v_action_id uuid;
begin
  perform public.require_admin('moderator');
  if p_status not in ('active','suspended','banned') then
    raise exception 'unknown status %', p_status;
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required';
  end if;

  select * into u from users where id = p_user_id;
  if not found then raise exception 'user not found'; end if;
  if u.id = v_actor then raise exception 'you cannot change your own status'; end if;
  -- Moderators must not be able to act on the people who supervise them.
  if exists (select 1 from admin_roles ar
              where ar.user_id = u.id and ar.role = 'super_admin') then
    raise exception 'that account is a super admin; revoke the role first';
  end if;

  v_action := case p_status when 'suspended' then 'suspend'
                            when 'banned' then 'ban' else 'reinstate' end;

  update users set status = p_status::user_status where id = u.id;

  insert into moderation_actions (moderator_id, target_type, target_id, action, reason)
  values (v_actor, 'user', u.id, v_action, p_reason)
  returning id into v_action_id;

  if v_action in ('suspend','ban') then
    insert into user_strikes (user_id, reason, action_id) values (u.id, 'other', v_action_id);
  end if;

  insert into notifications (user_id, type, body, deep_link)
  values (u.id, 'moderation_result',
          case p_status
            when 'suspended' then 'Your account has been suspended'
            when 'banned' then 'Your account has been banned'
            else 'Your account has been reinstated' end
          || '. Reason: ' || p_reason
          || case when p_status = 'active' then '' else '. You can appeal this.' end,
          'menumatch://appeal/' || v_action_id::text);

  perform public.write_audit('user.status.' || p_status, 'user', u.id,
    jsonb_build_object('reason', p_reason, 'from', u.status, 'actionId', v_action_id));

  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

/**
 * §28.4 deletion. Removes the account from every public surface immediately and
 * takes its recipes with it, which is the documented recommendation rather than
 * orphaning them to an anonymous author. Moderation records, reports and the
 * audit trail are deliberately retained per the legal retention schedule; the
 * remaining personal data is cleared by purge_deleted_users() after 30 days.
 */
create or replace function public.admin_delete_user(p_user_id uuid, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_actor uuid := (select public.current_user_id());
  u       users%rowtype;
  v_recipes int;
begin
  perform public.require_admin('content_admin');
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;

  select * into u from users where id = p_user_id;
  if not found then raise exception 'user not found'; end if;
  if u.id = v_actor then raise exception 'you cannot delete your own account from here'; end if;
  if exists (select 1 from admin_roles ar where ar.user_id = u.id) then
    raise exception 'that account holds an admin role; revoke it first';
  end if;
  if u.deleted_at is not null then raise exception 'that account is already deleted'; end if;

  update recipes set deleted_at = now(), status = 'deleted'
   where creator_id = u.id and deleted_at is null;
  get diagnostics v_recipes = row_count;

  -- Off every public surface at once: RLS filters on deleted_at and status.
  update users
     set deleted_at = now(), status = 'deleted', bio = null, avatar_url = null
   where id = u.id;

  -- Revoke the ability to sign back in. The users row survives for the
  -- retention window; auth_id is set null by the foreign key.
  if u.auth_id is not null then
    delete from auth.users where id = u.auth_id;
  end if;

  insert into moderation_actions (moderator_id, target_type, target_id, action, reason)
  values (v_actor, 'user', u.id, 'ban', 'Account deleted: ' || p_reason);

  perform public.write_audit('user.delete', 'user', u.id,
    jsonb_build_object('reason', p_reason, 'username', u.username,
                       'recipesDeleted', v_recipes));

  return jsonb_build_object('ok', true, 'recipesDeleted', v_recipes);
end;
$$;

/**
 * §28.4: purge personal data 30 days after deletion, keeping the moderation
 * record. Intended for a scheduled job; safe to run repeatedly.
 */
create or replace function public.purge_deleted_users()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_count int;
begin
  update users
     set email = null, username = 'deleted_' || left(replace(id::text, '-', ''), 12),
         display_name = 'Deleted account', bio = null, avatar_url = null, age_band = null
   where deleted_at is not null
     and deleted_at < now() - interval '30 days'
     and email is not null;
  get diagnostics v_count = row_count;

  delete from user_preferences up
   using users u where up.user_id = u.id
     and u.deleted_at is not null and u.deleted_at < now() - interval '30 days';

  -- §28.2: a guest device id must not outlive the account it was merged into.
  delete from devices d
   using users u where d.user_id = u.id
     and u.deleted_at is not null and u.deleted_at < now() - interval '30 days';

  return jsonb_build_object('purged', v_count);
end;
$$;

-- 0010 revoked EXECUTE wholesale; new functions default to PUBLIC again, so each
-- one is locked down explicitly before the intended grant.
revoke execute on function public.user_last_active(uuid,uuid) from public, anon, authenticated;
revoke execute on function public.purge_deleted_users() from public, anon, authenticated;
revoke execute on function public.admin_users(text,text,int,int) from public, anon;
revoke execute on function public.admin_user_detail(uuid) from public, anon;
revoke execute on function public.admin_set_user_status(uuid,text,text) from public, anon;
revoke execute on function public.admin_delete_user(uuid,text) from public, anon;

grant execute on function public.admin_users(text,text,int,int)        to authenticated;
grant execute on function public.admin_user_detail(uuid)               to authenticated;
grant execute on function public.admin_set_user_status(uuid,text,text) to authenticated;
grant execute on function public.admin_delete_user(uuid,text)          to authenticated;
-- user_last_active and purge_deleted_users stay owner-only (service role / cron).
