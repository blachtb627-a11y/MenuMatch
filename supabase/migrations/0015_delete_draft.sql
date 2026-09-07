-- Draft deletion (§15, §17), and a re-hardening of function grants.
--
-- 0010 revoked EXECUTE from PUBLIC and granted it back only to the intended API
-- surface. Postgres grants EXECUTE to PUBLIC on every *new* function, so every
-- function added since — the composer, collections and admin RPCs — quietly got
-- that default back. The role-gated ones still refused anon callers on their own
-- guards, but `write_audit` did not: it is SECURITY DEFINER and would have let
-- any anon caller forge rows into audit_log. The grants are re-stated in full
-- below, and the default privilege is now pinned to the owning role so later
-- migrations inherit it.

-- ---------------------------------------------------------------- delete draft

/**
 * Deletes a draft the caller owns, outright.
 *
 * Only ever a draft that has never been published: a published recipe may sit
 * in someone's Cookbook, so taking it down is unpublish_recipe's job, not this.
 * `published_at is null` is the belt-and-braces check — a recipe that was ever
 * live can never be hard-deleted here whatever its current status says.
 *
 * A draft nobody else has seen leaves nothing behind worth keeping, so this is a
 * real delete rather than a tombstone; the child rows follow on cascade. The
 * cover image goes with it, since nothing else can reference it.
 */
create or replace function public.delete_draft(p_recipe_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_user  uuid := (select public.current_user_id());
  r       recipes%rowtype;
  v_path  text;
begin
  if v_user is null then raise exception 'authentication required'; end if;

  select * into r from recipes
   where id = p_recipe_id and creator_id = v_user and deleted_at is null;
  if not found then raise exception 'draft not found'; end if;

  if r.status <> 'draft' or r.published_at is not null then
    raise exception 'only an unpublished draft can be deleted'
      using hint = 'Unpublish it first, which keeps it for anyone who saved it.';
  end if;

  -- Take the cover with it. The path is re-checked against the caller's own
  -- prefix so a hand-edited URL cannot reach another creator's file.
  if r.cover_image_url like '%/recipe-media/%' then
    v_path := split_part(r.cover_image_url, '/recipe-media/', 2);
    delete from storage.objects
     where bucket_id = 'recipe-media'
       and name = v_path
       and (storage.foldername(name))[1] = v_user::text;
  end if;

  delete from recipes where id = r.id;

  return jsonb_build_object('deleted', true, 'id', r.id);
end;
$$;

-- ---------------------------------------------------------------- grants

-- Applies to functions created by the owning role from here on, so a future
-- migration does not have to remember (0010 set this for its own role only,
-- which is why the drift happened).
alter default privileges for role postgres in schema public
  revoke execute on functions from public;

revoke execute on all functions in schema public from public, anon, authenticated;

-- Guest-reachable (§7): the deck works before there is an account.
grant execute on function public.get_feed(text,int,text,uuid[])        to anon, authenticated;
grant execute on function public.get_config()                          to anon, authenticated;
grant execute on function public.get_recipe(uuid)                      to anon, authenticated;
grant execute on function public.register_device(text,text,text)       to anon, authenticated;
grant execute on function public.record_swipes(jsonb,text)             to anon, authenticated;
grant execute on function public.undo_swipe(uuid,text)                 to anon, authenticated;
grant execute on function public.current_user_id()                     to anon, authenticated;
grant execute on function public.is_blocked_with(uuid)                 to anon, authenticated;
grant execute on function public.recipe_visible(uuid)                  to anon, authenticated;

-- Account-only.
grant execute on function public.me()                                  to authenticated;
grant execute on function public.save_recipe(uuid,text,text)           to authenticated;
grant execute on function public.unsave_recipe(uuid)                   to authenticated;
grant execute on function public.record_cook(uuid,text,text)           to authenticated;
grant execute on function public.claim_guest_history(text)             to authenticated;
grant execute on function public.less_like_this(text,text)             to authenticated;
grant execute on function public.is_admin(text)                        to authenticated;
grant execute on function public.report_priority(report_reason)        to authenticated;

-- Composer (§15).
grant execute on function public.save_draft(jsonb)                     to authenticated;
grant execute on function public.publish_recipe(uuid, boolean)         to authenticated;
grant execute on function public.unpublish_recipe(uuid)                to authenticated;
grant execute on function public.delete_draft(uuid)                    to authenticated;
grant execute on function public.my_recipes()                          to authenticated;
grant execute on function public.get_draft(uuid)                       to authenticated;

-- Collections (§12).
grant execute on function public.create_collection(text)               to authenticated;
grant execute on function public.rename_collection(uuid,text)          to authenticated;
grant execute on function public.delete_collection(uuid)               to authenticated;
grant execute on function public.set_recipe_collections(uuid,uuid[])   to authenticated;
grant execute on function public.remove_from_collection(uuid,uuid)     to authenticated;
grant execute on function public.reorder_collection_item(uuid,uuid,int) to authenticated;
grant execute on function public.my_collections()                      to authenticated;
grant execute on function public.collection_detail(uuid)               to authenticated;
grant execute on function public.recipe_collections(uuid)              to authenticated;

-- Admin (§20.3, §29). Each one gates on require_admin as well.
grant execute on function public.my_admin_role()                       to authenticated;
grant execute on function public.admin_stats()                         to authenticated;
grant execute on function public.admin_reports(text,int)               to authenticated;
grant execute on function public.admin_report_detail(uuid)             to authenticated;
grant execute on function public.admin_act(uuid,text,text,text)        to authenticated;
grant execute on function public.admin_appeals(text)                   to authenticated;
grant execute on function public.admin_resolve_appeal(uuid,boolean,text) to authenticated;
grant execute on function public.admin_list_admins()                   to authenticated;
grant execute on function public.admin_find_user(text)                 to authenticated;
grant execute on function public.admin_grant_role(uuid,text)           to authenticated;
grant execute on function public.admin_revoke_role(uuid)               to authenticated;
grant execute on function public.admin_audit(int)                      to authenticated;
grant execute on function public.admin_users(text,text,int,int)        to authenticated;
grant execute on function public.admin_user_detail(uuid)               to authenticated;
grant execute on function public.admin_set_user_status(uuid,text,text) to authenticated;
grant execute on function public.admin_delete_user(uuid,text)          to authenticated;

-- Everything not listed stays owner-only: write_audit, require_admin,
-- report_sla_hours, user_last_active, purge_deleted_users, the seed loader,
-- recipe_card, and every trigger function.
