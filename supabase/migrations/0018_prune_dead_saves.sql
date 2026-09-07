-- Clears saves and collection entries whose recipe is gone, and purges an
-- already-deleted account outright.
--
-- §17 keeps a removed recipe visible in the Cookbook as "No longer available"
-- so a save does not vanish without explanation. That is right when one recipe
-- goes; it is wrong when a whole creator does, and the Cookbook becomes a wall
-- of dead tiles with nothing to act on. The rows are removed rather than only
-- hidden, so the saved count is true and nothing lingers pointing at nothing.

/**
 * Removes the caller's own saves and collection entries for recipes that no
 * longer exist. Scoped to the caller, so it is safe to expose and cannot touch
 * anyone else's Cookbook.
 */
create or replace function public.prune_dead_saves()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_user  uuid := (select public.current_user_id());
  v_saves int;
  v_items int;
begin
  if v_user is null then raise exception 'authentication required'; end if;

  delete from collection_items ci
   using collections c, recipes r
   where ci.collection_id = c.id and c.user_id = v_user
     and r.id = ci.recipe_id and r.deleted_at is not null;
  get diagnostics v_items = row_count;

  delete from saves s
   using recipes r
   where s.user_id = v_user and r.id = s.recipe_id and r.deleted_at is not null;
  get diagnostics v_saves = row_count;

  return jsonb_build_object('saves', v_saves, 'collectionItems', v_items);
end;
$$;

revoke execute on function public.prune_dead_saves() from public, anon;
grant  execute on function public.prune_dead_saves() to authenticated;

/**
 * §28.4's purge, without the 30-day wait, for an account already deleted.
 * Requires super admin: this destroys the row rather than tombstoning it, so
 * the audit trail keeps only the moderation record of the deletion itself.
 * Intended for seed and test accounts, where there is no person to protect and
 * no reason to keep a name in the users table.
 */
create or replace function public.admin_purge_user(p_user_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  u users%rowtype;
begin
  perform public.require_admin('super_admin');

  select * into u from users where id = p_user_id;
  if not found then raise exception 'user not found'; end if;
  if u.deleted_at is null then
    raise exception 'delete the account first; purge only clears one already deleted';
  end if;

  perform public.write_audit('user.purge', 'user', u.id,
    jsonb_build_object('username', u.username, 'wasSeedAccount', u.is_seed_account));

  -- Recipes, preferences, devices, saves and collections all cascade.
  delete from users where id = u.id;

  return jsonb_build_object('purged', true, 'username', u.username);
end;
$$;

revoke execute on function public.admin_purge_user(uuid) from public, anon;
grant  execute on function public.admin_purge_user(uuid) to authenticated;

-- One-off: clear the dead saves left by the accounts deleted before this
-- existed. Runs as the migration owner, so it is not scoped to one caller.
delete from collection_items ci using recipes r
 where r.id = ci.recipe_id and r.deleted_at is not null;
delete from saves s using recipes r
 where r.id = s.recipe_id and r.deleted_at is not null;
