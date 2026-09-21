-- Deleting your own account, from inside the app.
--
-- App Store guideline 5.1.1(v) requires an app that lets you create an account
-- to let you delete it, in the app, without writing to anyone. The Profile
-- screen has had the row since the first build; it had no handler behind it,
-- and the Privacy Policy pointed people at an email address instead. Both are
-- fixed here and in the same change.
--
-- The behaviour is not invented: the Privacy Policy already describes it under
-- "How long we keep it", and this implements that paragraph literally.
--
--   Immediately: sign-in stops working, the profile disappears, the account's
--   recipes come out of discovery, and drafts nobody ever saw are deleted
--   outright.
--
--   After 30 days: the personal details are erased — email, username, display
--   name, bio, avatar, age band, saved preferences — leaving a pseudonymous
--   shell so other people's cookbooks and the moderation record do not break.
--
--   Kept either way: recipes other people saved, as `removed` rather than
--   erased, and the moderation and audit record, which is the one thing that
--   has to outlive the account it concerns.

-- --------------------------------------------------------------- immediate
create or replace function public.delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user   uuid := (select public.current_user_id());
  v_auth   uuid;
  v_seed   boolean;
  v_drafts int;
  v_kept   int;
begin
  if v_user is null then raise exception 'authentication required'; end if;

  select auth_id, is_seed_account into v_auth, v_seed
    from users where id = v_user;

  -- The house account is the catalog, not a person. Deleting it from a phone
  -- would empty the deck for everybody.
  if coalesce(v_seed, false) then
    raise exception 'this account cannot be deleted from the app';
  end if;

  -- A draft was never published, so nobody else holds a copy and nothing
  -- points at it.
  delete from recipes
   where creator_id = v_user and status in ('draft', 'pending_review');
  get diagnostics v_drafts = row_count;

  -- Everything published comes out of discovery but stays where it already
  -- sits in other people's cookbooks.
  --
  -- `deleted_at` is deliberately left null. prune_dead_saves() deletes a save
  -- whose recipe has it set, so writing it here would reach into other
  -- people's cookbooks and empty them — the exact thing the policy promises
  -- not to do. Coming out of the deck is `status`, which get_feed filters on.
  update recipes
     set status = 'removed', updated_at = now()
   where creator_id = v_user and status <> 'removed';
  get diagnostics v_kept = row_count;

  -- creator_profile() already refuses anything that is not `active` with a
  -- null deleted_at, so this is what makes the profile disappear.
  update users
     set status = 'deleted', deleted_at = now(), updated_at = now()
   where id = v_user;

  -- Written before the auth row goes, while there is still a session to
  -- attribute it to. The metadata is counts, not content.
  insert into audit_log (actor_id, actor_type, action, target_type, target_id, metadata)
  values (v_user, 'user', 'account.delete_self', 'user', v_user,
          jsonb_build_object('draftsDeleted', v_drafts, 'recipesRemoved', v_kept));

  -- And this is what stops sign-in: the credential is gone, every refresh
  -- token with it. users.auth_id is ON DELETE SET NULL, so the shell survives.
  if v_auth is not null then
    delete from auth.users where id = v_auth;
  end if;

  return jsonb_build_object(
    'draftsDeleted',  v_drafts,
    'recipesRemoved', v_kept,
    'purgeAfter',     (now() + interval '30 days'));
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

comment on function public.delete_my_account() is
  'Deletes the calling account: drafts erased, published recipes removed from '
  'discovery, profile tombstoned, credential destroyed. The pseudonymous shell '
  'is erased by purge_deleted_accounts() 30 days later.';

-- ------------------------------------------------------------- the 30 days
--
-- Not reachable from the app: no client needs it, and a function that erases
-- people in bulk should not be one RPC name away from anyone's access token.
create or replace function public.purge_deleted_accounts(p_grace interval default '30 days')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids   uuid[];
  v_count int;
begin
  select coalesce(array_agg(id), '{}')
    into v_ids
    from users
   where status = 'deleted'
     and deleted_at is not null
     and deleted_at < now() - p_grace;

  v_count := cardinality(v_ids);
  if v_count = 0 then
    return jsonb_build_object('purged', 0);
  end if;

  -- Their own rows, none of which anyone else reads. Saves and collections
  -- here are the departing account's *own* cookbook; other people's saves are
  -- keyed by their own user_id and are untouched.
  delete from collection_items ci using collections c
   where ci.collection_id = c.id and c.user_id = any(v_ids);
  delete from collections        where user_id  = any(v_ids);
  delete from saves              where user_id  = any(v_ids);
  delete from swipes             where user_id  = any(v_ids);
  delete from recipe_opens       where user_id  = any(v_ids);
  delete from cooks              where user_id  = any(v_ids);
  delete from pantry_items       where user_id  = any(v_ids);
  delete from negative_signals   where user_id  = any(v_ids);
  delete from user_taste_profile where user_id  = any(v_ids);
  delete from user_preferences   where user_id  = any(v_ids);
  delete from notification_preferences where user_id = any(v_ids);
  delete from notifications      where user_id  = any(v_ids);
  delete from devices            where user_id  = any(v_ids);
  delete from follows  where follower_id = any(v_ids) or following_id = any(v_ids);
  delete from mutes    where muter_id    = any(v_ids) or muted_id     = any(v_ids);
  delete from blocks   where blocker_id  = any(v_ids) or blocked_id   = any(v_ids);

  -- What is left is the shell. The username has to stay unique and stay
  -- non-null, so it becomes something that cannot collide and cannot be
  -- mistaken for a handle someone chose.
  update users
     set email        = null,
         -- No ::citext cast. The type lives in the `extensions` schema, and
         -- this function pins search_path to `public`, so the cast does not
         -- resolve at runtime. Assigning text to a citext column coerces on
         -- its own.
         username     = 'deleted.' || left(replace(id::text, '-', ''), 12),
         display_name = 'Deleted account',
         bio          = null,
         avatar_url   = null,
         age_band     = null,
         updated_at   = now()
   where id = any(v_ids);

  insert into audit_log (actor_id, actor_type, action, target_type, metadata)
  values (null, 'system', 'account.purge', 'user',
          jsonb_build_object('count', v_count));

  return jsonb_build_object('purged', v_count);
end;
$$;

revoke all on function public.purge_deleted_accounts(interval) from public, anon, authenticated;

comment on function public.purge_deleted_accounts(interval) is
  'Erases the personal details of accounts deleted more than the grace period '
  'ago, leaving a pseudonymous shell. Scheduled nightly; not client-callable.';
