-- A category tab must never quietly become the global feed.
--
-- get_feed relaxes in three levels when it cannot fill a page. Levels 0 and 1
-- relax personalisation, which is right. Level 2 replaced the category itself
-- with 'for_you' — abandoning the filter and returning the global ranking
-- under the category's name.
--
-- v_strict decided who was exempt from that, and it covered only
-- nutrition_gated and categories with an explicit filter_tag: two of eleven.
-- Everything else widened as soon as it ran short. At the page size the app
-- actually requests (20) that meant, measured:
--
--   drinks     20 of 20 cards were not drinks   (no drinks recipes existed)
--   breakfast  20 of 20 were not breakfast
--   following  20 of 20 from people you do not follow
--   lunch      19 of 20 were not lunch
--   dessert    19 of 20 were not dessert
--
-- dinner, snacks, quick, vegetarian and high_protein looked correct only
-- because each happens to have twenty matching recipes. They were one quiet
-- week away from behaving the same way.
--
-- Every category now holds its own boundary and runs short instead. The deck
-- already handles that: "The last of Lunch for now" over a short deck, and a
-- caught-up state with somewhere to go when there is nothing left. A short
-- honest deck beats a full misleading one.
--
-- Applied to the live function by patching its own source, so the other ~300
-- lines of ranking could not be altered by transcription:
--
--   select pg_get_functiondef(oid) ... ; replace(src, <old line>, <new line>);
--   execute the result, raising if the old line was not found.
--
-- The one line that changed:
--
--   - v_strict := v_cat.feed_kind = 'nutrition_gated' or v_cat.filter_tag is not null;
--   + v_strict := v_cat.feed_kind not in ('for_you', 'curated');

do $$
declare src text; patched text;
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'get_feed';

  patched := replace(src,
    'v_strict := v_cat.feed_kind = ''nutrition_gated'' or v_cat.filter_tag is not null;',
    'v_strict := v_cat.feed_kind not in (''for_you'', ''curated'');');

  -- Already patched, or the line moved: either way, do not guess.
  if patched = src then
    if src ~ 'v_strict := v_cat\.feed_kind not in' then return; end if;
    raise exception 'get_feed: the v_strict line was not found';
  end if;

  execute patched;
end $$;

-- Following has no way to be populated: there is no follow control anywhere in
-- the app, so the tab could only ever be empty or (before the fix above) full
-- of people you do not follow. Hidden until follow ships.
update public.categories set is_enabled = false where slug = 'following';
