-- "Report a problem" (§20.2, §20.6): a reporting path that is not a recipe.
--
-- Until now the only way to file anything was the control on a recipe, so
-- target_type was always 'recipe' in practice even though the column allowed
-- 'user'. There was no way to report an account, and no way to raise a problem
-- with MenuMatch itself. Both now have one.
--
-- A report about the app has no target, so target_id becomes nullable and the
-- check constraint ties the two together: a recipe/user/cook_photo report must
-- name its target, an app report must not.

alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports alter column target_id drop not null;

alter table public.reports add constraint reports_target_shape check (
  (target_type in ('recipe','user','cook_photo') and target_id is not null)
  or (target_type = 'app' and target_id is null)
);

-- The queue counts sibling reports on the same target. With a nullable
-- target_id, `=` yields null and every app report would claim a count of zero;
-- `is not distinct from` groups them the way a moderator expects.
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
        'reportCount', (select count(*) from reports r2
                         where r2.target_type = r.target_type
                           and r2.target_id is not distinct from r.target_id),
        'targetTitle', case r.target_type
          when 'recipe' then (select title from recipes where id = r.target_id)
          when 'app' then 'MenuMatch itself'
          else (select display_name from users where id = r.target_id) end,
        'targetCreator', case r.target_type
          when 'recipe' then (select u.username from recipes rr
                              join users u on u.id = rr.creator_id where rr.id = r.target_id)
          when 'app' then null
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

/**
 * Files a report the caller could not file from a recipe card.
 *
 * Goes through an RPC rather than a table insert so the shape is checked in one
 * place: an account report has to name a real, live account, and an app report
 * has to name nothing at all. The client cannot get that pairing wrong.
 *
 * Reporting yourself is refused — it is always either a mistake or an attempt
 * to put noise in the queue.
 */
create or replace function public.report_problem(
  p_target_type text,
  p_target_id   uuid,
  p_reason      text,
  p_details     text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_user uuid := (select public.current_user_id());
  v_id   uuid;
begin
  if v_user is null then raise exception 'authentication required'; end if;
  if p_target_type not in ('user','app') then
    raise exception 'report_problem handles account and app reports only'
      using hint = 'Recipes are reported from the recipe itself.';
  end if;

  if p_target_type = 'user' then
    if p_target_id is null then raise exception 'no account named'; end if;
    if p_target_id = v_user then raise exception 'you cannot report your own account'; end if;
    if not exists (select 1 from users
                    where id = p_target_id and deleted_at is null) then
      raise exception 'account not found';
    end if;
  else
    p_target_id := null;
  end if;

  -- One open report per person per target: a second one adds nothing to the
  -- queue and a frustrated user will press send more than once.
  select id into v_id from reports
   where reporter_id = v_user
     and target_type = p_target_type
     and target_id is not distinct from p_target_id
     and status in ('open','triaged')
   limit 1;
  if found then
    return jsonb_build_object('ok', true, 'id', v_id, 'duplicate', true);
  end if;

  insert into reports (reporter_id, target_type, target_id, reason, details)
  values (v_user, p_target_type, p_target_id, p_reason::report_reason,
          nullif(btrim(coalesce(p_details, '')), ''))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'duplicate', false);
end;
$$;

revoke execute on function public.report_problem(text,uuid,text,text) from public, anon;
grant execute on function public.report_problem(text,uuid,text,text) to authenticated;
