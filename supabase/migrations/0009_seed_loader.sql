-- §11: durations are parsed from step text once, at publish time, so Cook Mode
-- reads a stored value instead of re-parsing prose on every render.
create or replace function public.parse_timer_seconds(p_text text)
returns int language plpgsql immutable parallel safe as $$
declare m text[]; n int; u text;
begin
  m := regexp_match(lower(coalesce(p_text,'')),
                    '(\d+)\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)');
  if m is null then return null; end if;
  n := m[1]::int;
  u := m[2];
  if n <= 0 then return null; end if;
  if u like 'h%' then return n * 3600;
  elsif u like 'm%' then return n * 60;
  else return n; end if;
end;
$$;

-- Admin bulk seed tool (§29 "seed-content bulk tools"). Idempotent on
-- (creator, title) so the catalog can be reloaded safely.
--
-- Load the catalog with:
--   select public.seed_recipes(<contents of supabase/seed/recipes-part1.json>::jsonb);
--   select public.seed_recipes(<contents of supabase/seed/recipes-part2.json>::jsonb);
-- Run as service_role; 0010 revokes execute from anon and authenticated.
create or replace function public.seed_recipe(p jsonb)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_creator uuid;
  v_id      uuid;
  v_item    jsonb;
  v_pos     int := 0;
  v_slug    text;
begin
  select id into v_creator from users where username = (p->>'creator');
  if v_creator is null then raise exception 'unknown seed creator %', p->>'creator'; end if;

  select id into v_id from recipes
   where creator_id = v_creator and title = (p->>'title');

  if v_id is null then
    insert into recipes (creator_id, title, description, cover_image_url, category,
                         cuisine, prep_minutes, cook_minutes, servings, difficulty,
                         contains_alcohol, nutrition, protein_g, is_seed,
                         status, moderation_state, rights_confirmed_at, published_at)
    values (v_creator, p->>'title', p->>'description',
            'https://cdn.menumatch.app/seed/' || (p->>'slug') || '/card.webp',
            p->>'category', p->>'cuisine',
            (p->>'prep')::int, (p->>'cook')::int, (p->>'servings')::int,
            nullif(p->>'difficulty','')::difficulty_level,
            coalesce((p->>'alcohol')::boolean, false),
            p->'nutrition', (p->'nutrition'->>'proteinG')::int, true,
            'published', 'clear', now(),
            now() - make_interval(days => coalesce((p->>'ageDays')::int, 0)))
    returning id into v_id;
  else
    delete from recipe_ingredients where recipe_id = v_id;
    delete from recipe_steps where recipe_id = v_id;
    delete from recipe_tags where recipe_id = v_id;
    delete from recipe_media where recipe_id = v_id;
  end if;

  -- ingredients: [numerator, denominator, unit, text, note]
  v_pos := 0;
  for v_item in select * from jsonb_array_elements(p->'ingredients') loop
    insert into recipe_ingredients (recipe_id, position, quantity_numerator,
                                    quantity_denominator, unit, ingredient_text,
                                    ingredient_id, note)
    values (v_id, v_pos,
            nullif(v_item->>0,'')::int,
            coalesce(nullif(v_item->>1,'')::int, 1),
            nullif(v_item->>2,'')::measurement_unit,
            v_item->>3,
            (select i.id from ingredients i
              where lower(v_item->>3) like '%' || lower(i.canonical_name) || '%'
                 or exists (select 1 from unnest(i.aliases) a
                            where lower(v_item->>3) like '%' || lower(a) || '%')
              order by length(i.canonical_name) desc limit 1),
            nullif(v_item->>4,''));
    v_pos := v_pos + 1;
  end loop;

  -- steps: plain strings; timers derived from the text
  v_pos := 0;
  for v_item in select * from jsonb_array_elements(p->'steps') loop
    insert into recipe_steps (recipe_id, position, instruction, timer_seconds)
    values (v_id, v_pos, v_item#>>'{}', public.parse_timer_seconds(v_item#>>'{}'));
    v_pos := v_pos + 1;
  end loop;

  for v_slug in select jsonb_array_elements_text(p->'tags') loop
    insert into recipe_tags (recipe_id, tag_id, source)
    select v_id, t.id, 'creator' from tags t where t.slug = v_slug
    on conflict do nothing;
  end loop;

  insert into recipe_media (recipe_id, url, width, height, position, type)
  values (v_id, 'https://cdn.menumatch.app/seed/' || (p->>'slug') || '/detail.webp',
          1600, 1200, 0, 'cover');

  -- §21.3 diversity needs a protein group; take it from the ingredient rows.
  update recipes r set primary_protein = (
    select i.protein_group from recipe_ingredients ri
    join ingredients i on i.id = ri.ingredient_id
    where ri.recipe_id = v_id and i.protein_group is not null
    order by ri.position limit 1)
  where r.id = v_id;

  return v_id;
end;
$$;

create or replace function public.seed_recipes(p jsonb)
returns int language plpgsql volatile security definer set search_path = public as $$
declare v_item jsonb; n int := 0;
begin
  for v_item in select * from jsonb_array_elements(p) loop
    perform public.seed_recipe(v_item);
    n := n + 1;
  end loop;
  return n;
end;
$$;
