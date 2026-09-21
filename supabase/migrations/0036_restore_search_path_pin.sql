-- Restore the search_path pin on food_blocking_stems.
--
-- 0032 created this function with `set search_path = public`. 0035 widened the
-- stem list with `create or replace` and, because a replace keeps only the
-- attributes the new statement restates, silently dropped the pin along with
-- it. Nothing broke — the body is a literal array and calls no other object —
-- but the function is SQL-bodied and reachable from the pantry RPCs, and a
-- mutable search_path on anything reachable is a standing invitation. The
-- linter was right to flag it.
--
-- Restated in full rather than patched, so the attribute list and the body
-- stay in one place.
create or replace function public.food_blocking_stems()
returns text[] language sql immutable parallel safe
set search_path = public as $$
  select array['stock','broth','sauce','paste','powder','vinegar',
               'syrup','extract','bean','oil',
               'coconut','cream','ice']::text[];
$$;
