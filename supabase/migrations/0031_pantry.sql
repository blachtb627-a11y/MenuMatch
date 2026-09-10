-- Cook from what you have: a pantry, and recipes ranked by what it is missing.
--
-- The whole feature turns on one question — does "chicken" in someone's pantry
-- satisfy "1 1/2 lb bone-in chicken thighs" in a recipe — and the answer has to
-- be good enough to be useful without being so loose it sends someone to the
-- kitchen for a dish they cannot finish.
--
-- The rule: reduce both sides to a set of significant word stems, and count a
-- pantry entry as covering an ingredient when *every* stem of the entry appears
-- among the ingredient's stems.
--
--   pantry "chicken"    -> {chicken}     ⊆ {bone,chicken,thigh}       yes
--   pantry "olive oil"  -> {olive,oil}   ⊆ {extra,virgin,olive,oil}   yes
--   pantry "olive"      -> {olive}       ⊆ {extra,virgin,olive,oil}   yes
--   pantry "oil"        -> {oil}         ⊆ {chicken,stock}            no
--
-- It is deliberately generous rather than exact — "chicken" will also cover
-- "chicken stock", which is wrong — so the client never claims certainty. It
-- shows what is missing and lets the cook check, the same bargain the recipe
-- scanner makes.

-- ---------------------------------------------------------------- vocabulary

/**
 * Words that describe how an ingredient was bought or prepared rather than what
 * it is. Dropping them is what makes "2 cups finely chopped fresh flat-leaf
 * parsley" and "parsley" the same thing.
 */
create or replace function public.food_stopwords()
returns text[] language sql immutable parallel safe as $$
  select array[
    'fresh','freshly','dried','frozen','canned','jarred','packed','plain',
    'chopped','minced','sliced','diced','shredded','grated','crushed','ground',
    'halved','quartered','peeled','seeded','trimmed','rinsed','drained','cubed',
    'large','small','medium','extra','jumbo','baby','thin','thick','thinly',
    'thickly','finely','roughly','coarsely','lightly','well',
    'ripe','room','temperature','warm','cold','hot','softened','melted','beaten',
    'divided','optional','taste','needed','serving','garnish','plus','more',
    'about','approximately','preferably','best','quality','good','any',
    'whole','half','low','fat','free','reduced','light','lean',
    'boneless','skinless','unsalted','salted','virgin','pure','raw','cooked',
    'and','the','for','into','with','without','from','your','their',
    'cut','store','bought','homemade','leftover','such','like'
  ]::text[];
$$;

/**
 * A crude singular. Not linguistics — just enough that "tomatoes", "tomato"
 * and "tomatos" land on the same stem, which is what matching needs.
 */
create or replace function public.food_singular(p_word text)
returns text language sql immutable parallel safe as $$
  select case
    when p_word ~ 'ies$' and length(p_word) > 4 then left(p_word, -3) || 'y'
    when p_word ~ '(ch|sh|ss|x|z)es$'           then left(p_word, -2)
    when p_word ~ 'oes$' and length(p_word) > 4 then left(p_word, -2)
    when p_word ~ '[^s]s$' and length(p_word) > 3 then left(p_word, -1)
    else p_word
  end;
$$;

/**
 * The stems of a food phrase, deduplicated. Immutable so it can back a stored
 * generated column — matching a thousand ingredient rows per query is not
 * something to recompute from text every time.
 */
create or replace function public.food_tokens(p_text text)
returns text[] language sql immutable parallel safe as $$
  select coalesce(array_agg(distinct stem order by stem), '{}'::text[])
  from (
    select public.food_singular(w) as stem
    from unnest(regexp_split_to_array(lower(coalesce(p_text, '')), '[^a-z]+')) as w
    where length(w) >= 3
      and not (w = any (public.food_stopwords()))
  ) x
  where stem <> '' and not (stem = any (public.food_stopwords()));
$$;

/**
 * Stems that make an ingredient a different product from the thing they modify.
 *
 * Without this, pantry "butter" covers "butter beans" and "chicken" covers
 * "chicken stock" — the recipe comes back makeable and the cook finds out in
 * the kitchen. The rule: any of these in the ingredient must also be in the
 * pantry entry, so "olive oil" still covers "extra virgin olive oil" while
 * "olive" no longer does.
 *
 * Kept short on purpose. 'cheese', 'butter' and 'milk' are deliberately absent:
 * blocking those breaks "parmesan" covering "parmesan cheese", which is the
 * ordinary case and matters more than the rare miss.
 */
create or replace function public.food_blocking_stems()
returns text[] language sql immutable parallel safe as $$
  select array['stock','broth','sauce','paste','powder','vinegar',
               'syrup','extract','bean','oil']::text[];
$$;

/**
 * Things nobody writes down but everybody has. Without these almost no recipe
 * would ever come back complete, because salt is in all of them.
 *
 * Read from app_config so the list can be tuned without a deploy, and the
 * client can turn the whole assumption off for someone who would rather be
 * asked.
 */
insert into public.app_config (key, value, description) values
  ('pantry_staples',
   jsonb_build_array('salt','pepper','black pepper','water','oil','olive oil',
                     'vegetable oil','sugar','ice'),
   'Assumed present when matching a pantry against recipes, unless the caller opts out.')
on conflict (key) do nothing;

create or replace function public.pantry_staples()
returns text[] language sql stable set search_path = public as $$
  select coalesce(
    (select array_agg(s.item #>> '{}')
       from app_config c, jsonb_array_elements(c.value) as s(item)
      where c.key = 'pantry_staples'),
    array['salt','pepper','water','oil']::text[]);
$$;

-- ------------------------------------------------------------------- pantry

create table if not exists public.pantry_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade
               default public.current_user_id(),
  name       text not null check (length(trim(name)) between 1 and 60),
  tokens     text[] generated always as (public.food_tokens(name)) stored,
  created_at timestamptz not null default now()
);

-- One entry per thing. Adding "Tomatoes" when "tomato" is already there should
-- be a no-op, not a second row that looks like more food.
create unique index if not exists pantry_items_unique
  on public.pantry_items (user_id, lower(trim(name)));
create index if not exists pantry_items_user on public.pantry_items (user_id, created_at desc);

alter table public.pantry_items enable row level security;

drop policy if exists pantry_own on public.pantry_items;
create policy pantry_own on public.pantry_items
  for all using (user_id = (select public.current_user_id()))
  with check (user_id = (select public.current_user_id()));

-- The stems of every recipe ingredient, stored rather than derived per query.
--
-- Note: this freezes today's stopword list into every row. Editing
-- food_stopwords later needs a rewrite to take effect:
--   alter table public.recipe_ingredients
--     alter column food_tokens type text[] using public.food_tokens(ingredient_text);
alter table public.recipe_ingredients
  add column if not exists food_tokens text[]
  generated always as (public.food_tokens(ingredient_text)) stored;

create index if not exists recipe_ingredients_food_tokens
  on public.recipe_ingredients using gin (food_tokens);

-- --------------------------------------------------------------------- RPCs

create or replace function public.my_pantry()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_user uuid := (select public.current_user_id());
begin
  if v_user is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name,
                                        'createdAt', p.created_at)
                     order by p.created_at desc)
    from pantry_items p where p.user_id = v_user), '[]'::jsonb);
end;
$$;

/** Adds several at once, which is what a scan returns and what typing feels like. */
create or replace function public.add_pantry_items(p_names text[])
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_user  uuid := (select public.current_user_id());
  v_added int;
  v_sent  int := coalesce(array_length(p_names, 1), 0);
begin
  if v_user is null then raise exception 'authentication required'; end if;
  if v_sent > 100 then raise exception 'that is more than 100 items at once'; end if;

  insert into pantry_items (user_id, name)
  select v_user, left(trim(n), 60)
    from unnest(coalesce(p_names, '{}'::text[])) as n
   where length(trim(n)) between 1 and 60
     -- Something that reduces to no stems cannot be matched against anything,
     -- so it would sit in the list doing nothing.
     and cardinality(public.food_tokens(n)) > 0
  on conflict do nothing;

  get diagnostics v_added = row_count;
  return jsonb_build_object('ok', true, 'added', v_added,
                            'skipped', v_sent - v_added);
end;
$$;

create or replace function public.remove_pantry_item(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_user uuid := (select public.current_user_id());
begin
  if v_user is null then raise exception 'authentication required'; end if;
  delete from pantry_items where id = p_id and user_id = v_user;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.clear_pantry()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_user uuid := (select public.current_user_id()); v_n int;
begin
  if v_user is null then raise exception 'authentication required'; end if;
  delete from pantry_items where user_id = v_user;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'removed', v_n);
end;
$$;

/**
 * What you could cook, best first.
 *
 * "Best" is fewest missing ingredients, then the largest share of the recipe
 * already covered, then how well it does generally — a recipe you have
 * everything for beats one you have more of but cannot finish.
 *
 * Every row carries what is missing by name, because "you can nearly make this"
 * is only useful alongside "you need parmesan".
 */
create or replace function public.cook_from_pantry(
  p_max_missing  int     default 3,
  p_limit        int     default 30,
  p_use_staples  boolean default true)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_user  uuid := (select public.current_user_id());
  v_max   int  := least(greatest(coalesce(p_max_missing, 3), 0), 10);
  v_limit int  := least(greatest(coalesce(p_limit, 30), 1), 60);
begin
  if v_user is null then raise exception 'authentication required'; end if;

  return coalesce((
    -- Everything the cook counts as available: their own pantry, plus the
    -- staples unless they asked to be asked about those too.
    with have as (
      select p.tokens as tokens from pantry_items p where p.user_id = v_user
      union all
      select public.food_tokens(s)
        from unnest(case when coalesce(p_use_staples, true)
                         then public.pantry_staples()
                         else '{}'::text[] end) as s
    )
    select jsonb_agg(row order by ord)
    from (
      select jsonb_build_object(
               'card', public.recipe_card(s.recipe_id),
               'total', s.total,
               'have', s.have,
               'missing', s.missing) as row,
             row_number() over (
               order by s.total - s.have,
               (s.have::numeric / greatest(s.total, 1)) desc,
               coalesce(st.save_count, 0) desc,
               s.recipe_id) as ord
      from (
        select n.recipe_id,
               count(*) as total,
               count(*) filter (where n.satisfied) as have,
               coalesce(
                 array_agg(n.ingredient_text order by n.position)
                   filter (where not n.satisfied), '{}'::text[]) as missing
        from (
          select ri.recipe_id, ri.ingredient_text, ri.position,
                 -- An ingredient with no stems at all cannot be matched either
                 -- way, so it is not held against the recipe.
                 cardinality(ri.food_tokens) = 0
                 or exists (
                   select 1 from have h
                    where cardinality(h.tokens) > 0
                      and h.tokens <@ ri.food_tokens
                      -- every identity-changing stem in the ingredient has to
                      -- be in the pantry entry too
                      and (array(select unnest(ri.food_tokens)
                                 intersect
                                 select unnest(public.food_blocking_stems())))
                          <@ h.tokens
                 ) as satisfied
          from recipe_ingredients ri
          join recipes r on r.id = ri.recipe_id
          where r.status = 'published'
            and r.deleted_at is null
            and r.moderation_state = 'clear'
        ) n
        group by n.recipe_id
      ) s
      left join recipe_stats st on st.recipe_id = s.recipe_id
      where s.total - s.have <= v_max
      order by ord
      limit v_limit
    ) ranked), '[]'::jsonb);
end;
$$;

grant execute on function public.my_pantry()                        to authenticated;
grant execute on function public.add_pantry_items(text[])           to authenticated;
grant execute on function public.remove_pantry_item(uuid)           to authenticated;
grant execute on function public.clear_pantry()                     to authenticated;
grant execute on function public.cook_from_pantry(int,int,boolean)  to authenticated;
