-- A house account with a starter catalog, and a cover URL the loader honours.
--
-- Two fixes and one addition.
--
-- seed_recipe hardcoded every cover to
-- https://cdn.menumatch.app/seed/<slug>/card.webp — a domain that does not
-- exist, so every seeded recipe pointed at a broken image. Covers now come
-- from the JSON, and a recipe without one gets null, which RecipeCover already
-- renders as its dominant-colour placeholder rather than a broken frame.
--
-- The account is a house account, not an invented person. It is flagged
-- is_seed_account, which the creator page and the admin screens already
-- surface, so nothing here is passing itself off as somebody's real cooking —
-- which is what §18.2 and the Community Guidelines ask of everyone else.

create or replace function public.seed_recipe(p jsonb)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_creator uuid;
  v_id      uuid;
  v_item    jsonb;
  v_pos     int := 0;
  v_slug    text;
  v_cover   text := nullif(p->>'coverUrl', '');
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
    values (v_creator, p->>'title', p->>'description', v_cover,
            p->>'category', p->>'cuisine',
            (p->>'prep')::int, (p->>'cook')::int, (p->>'servings')::int,
            nullif(p->>'difficulty','')::difficulty_level,
            coalesce((p->>'alcohol')::boolean, false),
            p->'nutrition', (p->'nutrition'->>'proteinG')::int, true,
            'published', 'clear', now(),
            now() - make_interval(days => coalesce((p->>'ageDays')::int, 0)))
    returning id into v_id;
  else
    -- Re-running is how covers get filled in later, so the URL is updated too.
    update recipes set
      description = p->>'description',
      cover_image_url = coalesce(v_cover, cover_image_url),
      cuisine = p->>'cuisine',
      prep_minutes = (p->>'prep')::int,
      cook_minutes = (p->>'cook')::int,
      servings = (p->>'servings')::int,
      nutrition = p->'nutrition',
      protein_g = (p->'nutrition'->>'proteinG')::int
    where id = v_id;
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

  -- Only when there is an image; a media row pointing nowhere is worse than none.
  if v_cover is not null then
    insert into recipe_media (recipe_id, url, width, height, position, type)
    values (v_id, v_cover, 1600, 1200, 0, 'cover');
  end if;

  update recipes r set primary_protein = (
    select i.protein_group from recipe_ingredients ri
    join ingredients i on i.id = ri.ingredient_id
    where ri.recipe_id = v_id and i.protein_group is not null
    order by ri.position limit 1)
  where r.id = v_id;

  return v_id;
end;
$$;

-- The house account. No auth_id: it cannot be signed into, which is the point.
insert into public.users (username, display_name, bio, is_creator, is_seed_account, status)
values ('menumatch.kitchen', 'The MenuMatch Kitchen',
        'The house account. Starter recipes from around the world, so the deck '
        || 'has something in it while the real cooks arrive.',
        true, true, 'active')
on conflict (username) do update
  set display_name = excluded.display_name,
      bio = excluded.bio,
      is_creator = true,
      is_seed_account = true,
      status = 'active',
      deleted_at = null;
