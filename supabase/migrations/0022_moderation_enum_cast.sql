-- Every moderation action failed on its last statement.
--
--   ERROR: column "status" is of type report_status but expression is of type text
--
-- `case when v_action = 'dismiss' then 'dismissed' else 'resolved' end` has two
-- untyped literals and nothing else to take a type from, so Postgres resolves
-- the whole CASE as text — and there is no implicit cast from text to an enum.
-- The update is the last statement in admin_act, so the action, the strike, the
-- notification and the recipe or user status change were all written and then
-- rolled back together: remove, restrict, warn, suspend, ban and dismiss have
-- never once completed.
--
-- admin_resolve_appeal had the identical bug against appeal_status, so no
-- appeal could be resolved either.
--
-- The CASE elsewhere in these functions is fine, because one of its branches is
-- the enum column itself and that gives the expression its type. Only the two
-- all-literal cases needed the cast.

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
     set status = (case when v_action = 'dismiss' then 'dismissed'
                        else 'resolved' end)::report_status,
         resolved_by = v_actor, resolved_at = now()
   where id = r.id;

  perform public.write_audit('moderation.' || p_action, r.target_type, r.target_id,
    jsonb_build_object('reportId', r.id, 'actionId', v_action_id,
                       'reason', p_reason, 'affectedUser', v_owner));

  return jsonb_build_object('ok', true, 'actionId', v_action_id);
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

  update appeals
     set status = (case when p_uphold then 'upheld' else 'denied' end)::appeal_status,
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

-- Postgres grants EXECUTE to PUBLIC on every replaced function, so restate the
-- intended surface (0015 explains why this is per-migration housekeeping).
revoke execute on function public.admin_act(uuid,text,text,text) from public, anon;
revoke execute on function public.admin_resolve_appeal(uuid,boolean,text) from public, anon;
grant execute on function public.admin_act(uuid,text,text,text)           to authenticated;
grant execute on function public.admin_resolve_appeal(uuid,boolean,text)  to authenticated;
