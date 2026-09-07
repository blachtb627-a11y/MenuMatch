-- Collections management (§12): create, rename, delete, move recipes between
-- them, and reorder within one.

-- The owner is always the caller, so the client no longer has to fetch its own
-- id before inserting. RLS still checks it on top of this.
alter table public.collections alter column user_id set default public.current_user_id();

create or replace function public.create_collection(p_name text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_user uuid := (select public.current_user_id());
  v_name text := trim(p_name);
  v_id   uuid;
begin
  if v_user is null then raise exception 'authentication required'; end if;
  if coalesce(v_name, '') = '' then raise exception 'a collection needs a name'; end if;
  if length(v_name) > 60 then v_name := left(v_name, 60); end if;

  select id into v_id from collections where user_id = v_user and name = v_name;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'existed', true);
  end if;

  insert into collections (user_id, name, position)
  values (v_user, v_name,
          coalesce((select max(position) + 1 from collections where user_id = v_user), 0))
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'existed', false);
end;
$$;

create or replace function public.rename_collection(p_id uuid, p_name text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_user uuid := (select public.current_user_id());
  v_name text := trim(p_name);
begin
  if v_user is null then raise exception 'authentication required'; end if;
  if coalesce(v_name, '') = '' then raise exception 'a collection needs a name'; end if;
  v_name := left(v_name, 60);

  if exists (select 1 from collections
              where user_id = v_user and name = v_name and id <> p_id) then
    raise exception 'you already have a collection called %', v_name;
  end if;

  update collections set name = v_name where id = p_id and user_id = v_user;
  if not found then raise exception 'collection not found'; end if;
  return jsonb_build_object('ok', true, 'name', v_name);
end;
$$;

/** Deletes the collection only. The recipes stay saved in the Cookbook. */
create or replace function public.delete_collection(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_user uuid := (select public.current_user_id());
begin
  if v_user is null then raise exception 'authentication required'; end if;
  delete from collections where id = p_id and user_id = v_user;
  if not found then raise exception 'collection not found'; end if;
  return jsonb_build_object('ok', true);
end;
$$;

/**
 * Replaces a recipe's collection membership in one call, which is what the
 * picker needs: tick some, untick others, save once. Also ensures the recipe is
 * saved, since a collection is a view onto the Cookbook.
 */
create or replace function public.set_recipe_collections(
  p_recipe_id uuid, p_collection_ids uuid[])
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_user uuid := (select public.current_user_id());
  v_id   uuid;
begin
  if v_user is null then raise exception 'authentication required'; end if;
  if not public.recipe_visible(p_recipe_id) then raise exception 'recipe not available'; end if;

  insert into saves (user_id, recipe_id, source)
  values (v_user, p_recipe_id, 'collection')
  on conflict (user_id, recipe_id) do nothing;

  -- Only ever touches collections the caller owns.
  delete from collection_items ci
   using collections c
   where ci.collection_id = c.id
     and c.user_id = v_user
     and ci.recipe_id = p_recipe_id
     and not (ci.collection_id = any (coalesce(p_collection_ids, '{}')));

  foreach v_id in array coalesce(p_collection_ids, '{}') loop
    if exists (select 1 from collections where id = v_id and user_id = v_user) then
      insert into collection_items (collection_id, recipe_id, position)
      values (v_id, p_recipe_id,
              coalesce((select max(position) + 1 from collection_items
                         where collection_id = v_id), 0))
      on conflict (collection_id, recipe_id) do nothing;
    end if;
  end loop;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.remove_from_collection(p_collection_id uuid, p_recipe_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_user uuid := (select public.current_user_id());
begin
  if v_user is null then raise exception 'authentication required'; end if;
  delete from collection_items ci
   using collections c
   where ci.collection_id = c.id and c.user_id = v_user
     and ci.collection_id = p_collection_id and ci.recipe_id = p_recipe_id;
  return jsonb_build_object('ok', true);
end;
$$;

/** §12: reordering within a collection. */
create or replace function public.reorder_collection_item(
  p_collection_id uuid, p_recipe_id uuid, p_direction int)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_user uuid := (select public.current_user_id());
  v_pos  int;
  v_swap_recipe uuid;
  v_swap_pos    int;
begin
  if v_user is null then raise exception 'authentication required'; end if;
  if not exists (select 1 from collections where id = p_collection_id and user_id = v_user) then
    raise exception 'collection not found';
  end if;

  select position into v_pos from collection_items
   where collection_id = p_collection_id and recipe_id = p_recipe_id;
  if v_pos is null then raise exception 'recipe not in that collection'; end if;

  -- Find the neighbour in the requested direction and trade places with it.
  select recipe_id, position into v_swap_recipe, v_swap_pos
    from collection_items
   where collection_id = p_collection_id
     and (case when p_direction < 0 then position < v_pos else position > v_pos end)
   order by case when p_direction < 0 then -position else position end
   limit 1;

  if v_swap_recipe is null then return jsonb_build_object('ok', true, 'moved', false); end if;

  update collection_items set position = v_pos
   where collection_id = p_collection_id and recipe_id = v_swap_recipe;
  update collection_items set position = v_swap_pos
   where collection_id = p_collection_id and recipe_id = p_recipe_id;

  return jsonb_build_object('ok', true, 'moved', true);
end;
$$;

/** Collections with their counts, plus the newest cover for a thumbnail. */
create or replace function public.my_collections()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_user uuid := (select public.current_user_id());
begin
  if v_user is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'visibility', c.visibility,
      'recipeCount', (select count(*) from collection_items ci where ci.collection_id = c.id),
      'coverImageUrl', (select r.cover_image_url from collection_items ci
                        join recipes r on r.id = ci.recipe_id
                        where ci.collection_id = c.id
                        order by ci.position limit 1)
    ) order by c.position, c.created_at)
    from collections c where c.user_id = v_user
  ), '[]'::jsonb);
end;
$$;

/** One collection with its recipes in order. */
create or replace function public.collection_detail(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_user uuid := (select public.current_user_id());
  c collections%rowtype;
begin
  if v_user is null then raise exception 'authentication required'; end if;
  select * into c from collections where id = p_id and user_id = v_user;
  if not found then raise exception 'collection not found'; end if;

  return jsonb_build_object(
    'id', c.id, 'name', c.name, 'visibility', c.visibility,
    'recipes', coalesce((
      select jsonb_agg(
        public.recipe_card(ci.recipe_id)
          || jsonb_build_object('position', ci.position,
                                'unavailable', not public.recipe_visible(ci.recipe_id))
        order by ci.position)
      from collection_items ci where ci.collection_id = c.id), '[]'::jsonb)
  );
end;
$$;

/** Which of the caller's collections already hold this recipe. */
create or replace function public.recipe_collections(p_recipe_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_user uuid := (select public.current_user_id());
begin
  if v_user is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(ci.collection_id)
    from collection_items ci join collections c on c.id = ci.collection_id
    where c.user_id = v_user and ci.recipe_id = p_recipe_id), '[]'::jsonb);
end;
$$;

grant execute on function public.create_collection(text)                     to authenticated;
grant execute on function public.rename_collection(uuid,text)                to authenticated;
grant execute on function public.delete_collection(uuid)                     to authenticated;
grant execute on function public.set_recipe_collections(uuid,uuid[])         to authenticated;
grant execute on function public.remove_from_collection(uuid,uuid)           to authenticated;
grant execute on function public.reorder_collection_item(uuid,uuid,int)      to authenticated;
grant execute on function public.my_collections()                            to authenticated;
grant execute on function public.collection_detail(uuid)                     to authenticated;
grant execute on function public.recipe_collections(uuid)                    to authenticated;
