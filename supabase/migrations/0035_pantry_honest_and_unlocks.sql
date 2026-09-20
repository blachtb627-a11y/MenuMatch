-- Two things about "What can I make?": stop it lying, then make it answer the
-- question people actually came with.

-- ------------------------------------------------------------------ lying
--
-- Matching is by stem subset: a pantry entry satisfies an ingredient when its
-- stems are contained in the ingredient's. That is what usefully lets
-- "chicken" cover "chicken thighs" — and it is also what let the staple
-- `pepper` cover `padron peppers`, so Padrón Peppers showed as ready to cook
-- in a kitchen holding nothing but black pepper. Same shape: `ice` covered
-- `vanilla ice cream`, `oil` covered `sesame oil` and `chilli oil`, `water`
-- covered `coconut water`.
--
-- The generic staples were redundant: `black pepper`, `olive oil` and
-- `vegetable oil` were already on the list and cover every honest case. So the
-- fix removes the three that can only over-reach rather than adding machinery.
--
-- Measured on a thirteen-item kitchen, before and after: ready-to-cook went
-- from 2 to 1 and one-short from 13 to 11. The recipe that left the
-- ready-to-cook list was Padrón Peppers.
update public.app_config
   set value = '["salt","black pepper","white pepper","water","olive oil",
                 "vegetable oil","sugar"]'::jsonb,
       updated_at = now()
 where key = 'pantry_staples';

-- Words that name a different food when they qualify another one, so having
-- the plain thing is not having the qualified thing. The rule reads: if the
-- ingredient carries one of these stems, the pantry entry has to carry it too.
--
-- `coconut` keeps `water` off `coconut water` and `milk` off `coconut milk`;
-- `cream` and `ice` together keep both off `ice cream`, while `cream` alone
-- still lets a pantry `cream` satisfy `double cream`.
create or replace function public.food_blocking_stems()
returns text[] language sql immutable parallel safe as $$
  select array['stock','broth','sauce','paste','powder','vinegar',
               'syrup','extract','bean','oil',
               'coconut','cream','ice']::text[];
$$;

-- --------------------------------------------------------------- unlocks
--
-- "One more thing and you could make these."
--
-- The screen already knew which recipes were a single ingredient short; it
-- just made the cook work that out by reading down a list and noticing the
-- same word three times. This turns that into the answer.
--
-- Grouped by stems rather than printed text, so "(3 fl oz/80 ml) olive oil"
-- and "olive oil" are one suggestion rather than two.
create or replace function public.pantry_unlocks(
  p_limit       int     default 5,
  p_use_staples boolean default true)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_user  uuid := (select public.current_user_id());
  v_limit int  := least(greatest(coalesce(p_limit, 5), 1), 20);
begin
  if v_user is null then raise exception 'authentication required'; end if;

  return coalesce((
    with have as materialized (
      select p.tokens as tokens
        from pantry_items p
       where p.user_id = v_user and cardinality(p.tokens) > 0
      union all
      select public.food_tokens(s)
        from unnest(case when coalesce(p_use_staples, true)
                         then public.pantry_staples()
                         else '{}'::text[] end) as s
    ),
    block as materialized (select public.food_blocking_stems() as b),
    need as materialized (
      select ri.recipe_id, ri.ingredient_text, ri.food_tokens as toks,
             array(select unnest(ri.food_tokens) intersect select unnest(bb.b)) as blocked
        from recipe_ingredients ri
        join recipes r on r.id = ri.recipe_id
        cross join block bb
       where r.status = 'published'
         and r.deleted_at is null
         and r.moderation_state = 'clear'
    ),
    marked as materialized (
      select n.recipe_id, n.ingredient_text, n.toks,
             cardinality(n.toks) = 0
             or exists (select 1 from have h
                         where h.tokens <@ n.toks and n.blocked <@ h.tokens) as satisfied
        from need n
    ),
    -- Only recipes short by exactly one: those are the ones a single purchase
    -- actually finishes. Two-short would need the pair bought together, which
    -- is a different and much weaker promise.
    --
    -- The row is taken directly rather than aggregated: array_agg over the
    -- token arrays throws "cannot accumulate arrays of different
    -- dimensionality" as soon as two recipes are short of ingredients with
    -- different word counts, which is to say almost immediately.
    one_short as (
      select m.recipe_id, m.ingredient_text, array_to_string(m.toks, ' ') as key
        from marked m
       where not m.satisfied
         and m.recipe_id in (select recipe_id from marked
                              group by recipe_id
                             having count(*) filter (where not satisfied) = 1)
    )
    select jsonb_agg(row order by unlocks desc, name)
      from (
        select jsonb_build_object('name', name, 'unlocks', unlocks,
                                  'recipes', titles) as row,
               unlocks, name
          from (
            select
              -- The shortest printed form reads like a shopping list; the
              -- longest tends to carry a measurement from the recipe line.
              (array_agg(o.ingredient_text order by length(o.ingredient_text),
                         o.ingredient_text))[1] as name,
              count(*) as unlocks,
              to_jsonb((array_agg(r.title order by r.title))[1:3]) as titles
            from one_short o
            join recipes r on r.id = o.recipe_id
           group by o.key
        ) g
         order by unlocks desc, name
         limit v_limit
      ) ranked), '[]'::jsonb);
end;
$$;

revoke execute on function public.pantry_unlocks(int, boolean) from public, anon;
grant  execute on function public.pantry_unlocks(int, boolean) to authenticated;
