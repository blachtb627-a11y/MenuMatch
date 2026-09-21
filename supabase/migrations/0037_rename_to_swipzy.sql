-- MenuMatch is now Swipzy. This is the part of the rename that lives in the
-- database rather than in the client bundle.
--
-- Three things carry the old name here:
--
--   1. The `menumatch://` deep link that moderation notifications are built
--      with. The client's URL scheme changed with the rename, so a link
--      written with the old scheme no longer opens anything — and the notice
--      it is attached to is the one telling someone their recipe was removed
--      and that they may appeal, which is the worst link in the app to have
--      go dead.
--   2. `admin_reports`, which prints "MenuMatch itself" as the label for a
--      report filed against the service rather than against a recipe or a
--      person. That string is shown in the moderation queue.
--   3. The house account: @menumatch.kitchen, "The MenuMatch Kitchen".
--
-- The functions are patched from their own source rather than restated, so
-- this migration cannot silently revert an intervening change to their bodies,
-- and `create or replace` keeps the existing grants. Earlier migrations are
-- left exactly as they were applied; on a rebuild from scratch they create the
-- old spellings and this migration, running after them, renames them — which
-- is why the update below is written to be a no-op when it has already run.
do $rename$
declare
  targets oid[];
  target  oid;
  src     text;
  patched text;
  n       int := 0;
begin
  -- Collected first: replacing a function while scanning pg_proc means
  -- rewriting the rows the scan is walking.
  select coalesce(array_agg(p.oid), '{}')
    into targets
    from pg_proc p
    join pg_namespace nsp on nsp.oid = p.pronamespace
   where nsp.nspname = 'public'
     and p.prokind = 'f'
     and (pg_get_functiondef(p.oid) like '%menumatch://%'
          or pg_get_functiondef(p.oid) like '%MenuMatch%');

  foreach target in array targets loop
    src := pg_get_functiondef(target);
    patched := replace(replace(src, 'menumatch://', 'swipzy://'), 'MenuMatch', 'Swipzy');
    if patched = src then
      raise exception 'matched % but replaced nothing in it', target::regprocedure;
    end if;
    execute patched;
    n := n + 1;
  end loop;

  raise notice 'renamed the app in % function(s)', n;
end
$rename$;

-- The house account. `is_seed` is what the client reads to print the
-- "· Swipzy account" badge, so only the two names need to move.
update users
   set username     = 'swipzy.kitchen',
       display_name = 'The Swipzy Kitchen'
 where username = 'menumatch.kitchen';

-- Appeal links already sitting in people's notification lists.
update notifications
   set deep_link = replace(deep_link, 'menumatch://', 'swipzy://')
 where deep_link like 'menumatch://%';
