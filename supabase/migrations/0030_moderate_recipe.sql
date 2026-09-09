-- Acting on one recipe without waiting for someone to report it (§20.3).
--
-- admin_act is the report queue's verb: it takes a report id, decides it, and
-- closes it. That leaves no way to touch a recipe an admin found themselves —
-- browsing an account, or reading the deck — short of reporting it first and
-- then resolving your own report, which pollutes the queue and the SLA numbers
-- with paperwork.
--
-- This is deliberately the same enforcement, not a delete. The row survives,
-- the creator is told why, the action is appealable (§20.5) and reinstate puts
-- it back. A hard delete would destroy both the evidence and the appeal, and a
-- moderator who is wrong needs to be able to be wrong reversibly.

create or replace function public.admin_moderate_recipe(
  p_recipe_id uuid,
  p_action    text,
  p_reason    text default null,
  p_notes     text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_actor     uuid := (select public.current_user_id());
  v_action    moderation_action_type;
  v_reason    report_reason;
  v_owner     uuid;
  v_title     text;
  v_state     text;
  v_action_id uuid;
  v_body      text;
begin
  perform public.require_admin('moderator');

  if p_action not in ('remove', 'restrict', 'reinstate') then
    raise exception 'this only removes, restricts or reinstates a recipe';
  end if;
  v_action := p_action::moderation_action_type;

  select r.creator_id, r.title, r.moderation_state::text
    into v_owner, v_title, v_state
    from recipes r where r.id = p_recipe_id and r.deleted_at is null;
  if v_owner is null then raise exception 'recipe not found'; end if;

  -- Taking something down is a promise to explain it: §20.5 gives the creator
  -- a notification with the reason and an appeal, and neither works empty.
  if p_action in ('remove', 'restrict') then
    if coalesce(trim(p_reason), '') = '' then
      raise exception 'a reason is required so the creator can be told why';
    end if;
    begin
      v_reason := trim(p_reason)::report_reason;
    exception when invalid_text_representation then
      raise exception 'unknown reason %', p_reason;
    end;
  end if;

  -- Same rule as account actions: a moderator must not be able to act on the
  -- people who supervise them, so a super admin's work is off limits until the
  -- role is revoked.
  if v_owner <> v_actor
     and exists (select 1 from admin_roles ar
                  where ar.user_id = v_owner and ar.role = 'super_admin')
     and not public.is_admin('super_admin') then
    raise exception 'that recipe belongs to a super admin';
  end if;

  if v_action = 'remove' then
    update recipes set moderation_state = 'removed', status = 'removed'
     where id = p_recipe_id;
  elsif v_action = 'restrict' then
    update recipes set moderation_state = 'under_review' where id = p_recipe_id;
  else
    update recipes
       set moderation_state = 'clear',
           status = case when status = 'removed' then 'published' else status end
     where id = p_recipe_id;
  end if;

  insert into moderation_actions
    (moderator_id, target_type, target_id, action, reason, notes, report_id)
  values (v_actor, 'recipe', p_recipe_id, v_action, nullif(trim(p_reason), ''), p_notes, null)
  returning id into v_action_id;

  -- §18.2: the same three reasons that earn a strike through the queue earn
  -- one here. Where an action lands should not change what it costs.
  if v_action = 'remove'
     and v_reason in ('copyright', 'unsafe_food', 'impersonation') then
    insert into user_strikes (user_id, reason, action_id)
    values (v_owner, v_reason, v_action_id);
  end if;

  -- §20.5: every enforcement action tells the creator, with the reason and a
  -- way to appeal. Reinstating is good news and says so.
  v_body := case v_action
    when 'remove'    then 'A recipe of yours was removed'
    when 'restrict'  then 'A recipe of yours is under review'
    else 'A recipe of yours has been reinstated' end;

  insert into notifications (user_id, type, actor_id, recipe_id, body, deep_link)
  values (v_owner, 'moderation_result', null, p_recipe_id,
          v_body || ': ' || coalesce(v_title, 'Untitled')
            || coalesce('. Reason: ' || nullif(trim(p_reason), ''), '')
            || case when v_action = 'reinstate' then '.' else '. You can appeal this.' end,
          'menumatch://appeal/' || v_action_id::text);

  perform public.write_audit('moderation.' || p_action, 'recipe', p_recipe_id,
    jsonb_build_object('actionId', v_action_id, 'reason', p_reason,
                       'affectedUser', v_owner, 'fromState', v_state,
                       'source', 'account_page'));

  return jsonb_build_object('ok', true, 'actionId', v_action_id, 'action', p_action);
end;
$$;

revoke execute on function public.admin_moderate_recipe(uuid,text,text,text) from public, anon;
grant  execute on function public.admin_moderate_recipe(uuid,text,text,text) to authenticated;
