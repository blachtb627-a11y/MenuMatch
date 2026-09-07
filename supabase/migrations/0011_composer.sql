-- Composer support: image storage, draft persistence, server-side publish.
-- Spec refs: §15, §17, §18.2, §24.

-- ---------------------------------------------------------------- storage (§24)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recipe-media', 'recipe-media', true, 10485760,
        array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Objects are laid out as <user_id>/<recipe_id>/<file>, so ownership is the
-- first path segment and a creator can only write inside their own prefix.
create policy recipe_media_read on storage.objects for select
  to anon, authenticated using (bucket_id = 'recipe-media');

create policy recipe_media_insert on storage.objects for insert
  to authenticated with check (
    bucket_id = 'recipe-media'
    and (storage.foldername(name))[1] = (select public.current_user_id())::text
  );

create policy recipe_media_update on storage.objects for update
  to authenticated using (
    bucket_id = 'recipe-media'
    and (storage.foldername(name))[1] = (select public.current_user_id())::text
  );

create policy recipe_media_delete on storage.objects for delete
  to authenticated using (
    bucket_id = 'recipe-media'
    and (storage.foldername(name))[1] = (select public.current_user_id())::text
  );

-- ---------------------------------------------------------------- drafts (§15)

-- Saves a whole draft in one statement: the recipe row plus its structured
-- ingredient and step rows and tags. Autosave fires often, so this replaces the
-- child rows wholesale rather than diffing them.
create or replace function public.save_draft(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_user uuid := (select public.current_user_id());
  v_id   uuid := nullif(p->>'id','')::uuid;
  v_item jsonb;
  v_pos  int := 0;
  v_slug text;
begin
  if v_user is null then raise exception 'authentication required'; end if;

  if v_id is null then
    insert into recipes (creator_id, title, description, cover_image_url, category,
                         cuisine, prep_minutes, cook_minutes, servings, difficulty,
                         attribution, nutrition, protein_g, status)
    values (v_user,
            coalesce(nullif(p->>'title',''), 'Untitled recipe'),
            nullif(p->>'description',''),
            nullif(p->>'coverImageUrl',''),
            nullif(p->>'category',''),
            nullif(p->>'cuisine',''),
            coalesce((p->>'prepMinutes')::int, 0),
            coalesce((p->>'cookMinutes')::int, 0),
            coalesce((p->>'servings')::int, 2),
            nullif(p->>'difficulty','')::difficulty_level,
            nullif(p->>'attribution',''),
            case when p->'nutrition' = 'null'::jsonb then null else p->'nutrition' end,
            (p->'nutrition'->>'proteinG')::int,
            'draft')
    returning id into v_id;
  else
    update recipes set
      title           = coalesce(nullif(p->>'title',''), title),
      description     = nullif(p->>'description',''),
      cover_image_url = nullif(p->>'coverImageUrl',''),
      category        = nullif(p->>'category',''),
      cuisine         = nullif(p->>'cuisine',''),
      prep_minutes    = coalesce((p->>'prepMinutes')::int, prep_minutes),
      cook_minutes    = coalesce((p->>'cookMinutes')::int, cook_minutes),
      servings        = coalesce((p->>'servings')::int, servings),
      difficulty      = nullif(p->>'difficulty','')::difficulty_level,
      attribution     = nullif(p->>'attribution',''),
      nutrition       = case when p->'nutrition' = 'null'::jsonb then null else p->'nutrition' end,
      protein_g       = (p->'nutrition'->>'proteinG')::int
    where id = v_id and creator_id = v_user;
    if not found then raise exception 'draft not found'; end if;
  end if;

  delete from recipe_ingredients where recipe_id = v_id;
  v_pos := 0;
  for v_item in select * from jsonb_array_elements(coalesce(p->'ingredients','[]'::jsonb)) loop
    if coalesce(trim(v_item->>'ingredient'), '') <> '' then
      insert into recipe_ingredients (recipe_id, position, quantity_numerator,
                                      quantity_denominator, unit, ingredient_text,
                                      ingredient_id, note)
      values (v_id, v_pos,
              nullif(v_item#>>'{quantity,numerator}','')::int,
              coalesce(nullif(v_item#>>'{quantity,denominator}','')::int, 1),
              nullif(v_item->>'unit','')::measurement_unit,
              left(trim(v_item->>'ingredient'), 120),
              (select i.id from ingredients i
                where lower(v_item->>'ingredient') like '%' || lower(i.canonical_name) || '%'
                order by length(i.canonical_name) desc limit 1),
              nullif(left(trim(coalesce(v_item->>'note','')), 120), ''));
      v_pos := v_pos + 1;
    end if;
  end loop;

  delete from recipe_steps where recipe_id = v_id;
  v_pos := 0;
  for v_item in select * from jsonb_array_elements(coalesce(p->'steps','[]'::jsonb)) loop
    if coalesce(trim(v_item#>>'{}'), '') <> '' then
      insert into recipe_steps (recipe_id, position, instruction, timer_seconds)
      values (v_id, v_pos, left(trim(v_item#>>'{}'), 2000),
              public.parse_timer_seconds(v_item#>>'{}'));
      v_pos := v_pos + 1;
    end if;
  end loop;

  delete from recipe_tags where recipe_id = v_id;
  for v_slug in select jsonb_array_elements_text(coalesce(p->'tags','[]'::jsonb)) loop
    insert into recipe_tags (recipe_id, tag_id, source)
    select v_id, t.id, 'creator' from tags t where t.slug = v_slug
    on conflict do nothing;
  end loop;

  return jsonb_build_object('id', v_id, 'savedAt', now());
end;
$$;

-- §15/§17: publishing is validated server-side. The client cannot talk its way
-- past a missing cover photo or an unticked rights confirmation.
create or replace function public.publish_recipe(
  p_recipe_id uuid, p_rights_confirmed boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_user uuid := (select public.current_user_id());
  r      recipes%rowtype;
  v_missing text[] := '{}';
  v_ing  int;
  v_step int;
begin
  if v_user is null then raise exception 'authentication required'; end if;
  select * into r from recipes where id = p_recipe_id and creator_id = v_user;
  if not found then raise exception 'recipe not found'; end if;

  select count(*) into v_ing from recipe_ingredients where recipe_id = r.id;
  select count(*) into v_step from recipe_steps where recipe_id = r.id;

  if coalesce(trim(r.title),'') = '' or r.title = 'Untitled recipe'
     or length(trim(r.title)) < 3 then
    v_missing := v_missing || 'title';
  end if;
  if coalesce(r.cover_image_url,'') = '' then v_missing := v_missing || 'cover photo'; end if;
  if r.category is null then v_missing := v_missing || 'meal category'; end if;
  if coalesce(r.cuisine,'') = '' then v_missing := v_missing || 'cuisine'; end if;
  if v_ing < 2 then v_missing := v_missing || 'at least 2 ingredients'; end if;
  if v_step < 2 then v_missing := v_missing || 'at least 2 steps'; end if;
  -- §18.2: the rights confirmation is required, stored with a timestamp.
  if not p_rights_confirmed and r.rights_confirmed_at is null then
    v_missing := v_missing || 'rights confirmation';
  end if;

  if array_length(v_missing, 1) > 0 then
    return jsonb_build_object('published', false, 'missing', to_jsonb(v_missing));
  end if;

  update recipes set
    status = 'published',
    published_at = coalesce(published_at, now()),
    rights_confirmed_at = case when p_rights_confirmed then now()
                               else rights_confirmed_at end,
    primary_protein = (
      select i.protein_group from recipe_ingredients ri
      join ingredients i on i.id = ri.ingredient_id
      where ri.recipe_id = r.id and i.protein_group is not null
      order by ri.position limit 1)
  where id = r.id;

  -- §17: keep a snapshot so moderation and disputes have an edit history.
  insert into recipe_versions (recipe_id, snapshot, edited_by)
  values (r.id, public.get_recipe(r.id), v_user);

  return jsonb_build_object('published', true, 'id', r.id);
end;
$$;

create or replace function public.unpublish_recipe(p_recipe_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_user uuid := (select public.current_user_id());
begin
  if v_user is null then raise exception 'authentication required'; end if;
  update recipes set status = 'unpublished'
   where id = p_recipe_id and creator_id = v_user and status = 'published';
  if not found then raise exception 'recipe not found'; end if;
  return jsonb_build_object('published', false);
end;
$$;

-- The creator's own drafts and published recipes, for the Create tab.
create or replace function public.my_recipes()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'title', r.title, 'status', r.status,
    'coverImageUrl', r.cover_image_url, 'totalMinutes', r.total_minutes,
    'updatedAt', r.updated_at,
    'ingredientCount', (select count(*) from recipe_ingredients ri where ri.recipe_id = r.id),
    'stepCount', (select count(*) from recipe_steps st where st.recipe_id = r.id)
  ) order by r.updated_at desc), '[]'::jsonb)
  from recipes r
  where r.creator_id = (select public.current_user_id()) and r.deleted_at is null;
$$;

-- Full draft payload for reopening the composer.
create or replace function public.get_draft(p_recipe_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.id, 'title', r.title, 'description', r.description,
    'coverImageUrl', r.cover_image_url, 'category', r.category, 'cuisine', r.cuisine,
    'prepMinutes', r.prep_minutes, 'cookMinutes', r.cook_minutes,
    'servings', r.servings, 'difficulty', r.difficulty,
    'attribution', r.attribution, 'nutrition', r.nutrition,
    'status', r.status, 'rightsConfirmedAt', r.rights_confirmed_at,
    'ingredients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'quantity', case when ri.quantity_numerator is null then null
                    else jsonb_build_object('numerator', ri.quantity_numerator,
                                            'denominator', ri.quantity_denominator) end,
        'unit', ri.unit, 'ingredient', ri.ingredient_text, 'note', ri.note)
        order by ri.position)
      from recipe_ingredients ri where ri.recipe_id = r.id), '[]'::jsonb),
    'steps', coalesce((
      select jsonb_agg(st.instruction order by st.position)
      from recipe_steps st where st.recipe_id = r.id), '[]'::jsonb),
    'tags', coalesce((
      select jsonb_agg(t.slug) from recipe_tags rt
      join tags t on t.id = rt.tag_id where rt.recipe_id = r.id), '[]'::jsonb)
  )
  from recipes r
  where r.id = p_recipe_id and r.creator_id = (select public.current_user_id());
$$;

grant execute on function public.save_draft(jsonb)             to authenticated;
grant execute on function public.publish_recipe(uuid, boolean) to authenticated;
grant execute on function public.unpublish_recipe(uuid)        to authenticated;
grant execute on function public.my_recipes()                  to authenticated;
grant execute on function public.get_draft(uuid)               to authenticated;
