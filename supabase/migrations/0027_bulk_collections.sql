-- Filing several saved recipes at once (§12).
--
-- set_recipe_collections is the wrong shape for this: it replaces one recipe's
-- entire membership, which is right for a picker showing that recipe's ticks
-- and wrong for a multi-select, where every selected recipe has its own
-- memberships and none of them should be disturbed. This only ever adds.

create or replace function public.add_recipes_to_collection(
  p_collection_id uuid, p_recipe_ids uuid[])
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_user    uuid := (select public.current_user_id());
  v_name    text;
  v_ids     uuid[];
  v_sent    int  := coalesce(array_length(p_recipe_ids, 1), 0);
  v_base    int;
  v_already int;
  v_added   int;
begin
  if v_user is null then raise exception 'authentication required'; end if;

  -- Bounded before anything is unnested, so a huge array costs nothing.
  if v_sent > 200 then
    raise exception 'that is more than 200 recipes at once';
  end if;

  select name into v_name
    from collections where id = p_collection_id and user_id = v_user;
  if v_name is null then raise exception 'collection not found'; end if;

  -- Deduplicated, and only recipes the caller can actually see. A recipe that
  -- has since been removed is dropped rather than failing the whole batch:
  -- one dead entry should not cost someone the other nineteen.
  select array_agg(distinct id) into v_ids
    from unnest(coalesce(p_recipe_ids, '{}'::uuid[])) as id
   where public.recipe_visible(id);
  v_ids := coalesce(v_ids, '{}'::uuid[]);

  -- A collection is a view onto the Cookbook, so filing something saves it.
  insert into saves (user_id, recipe_id, source)
  select v_user, id, 'collection' from unnest(v_ids) as id
  on conflict (user_id, recipe_id) do nothing;

  select count(*) into v_already
    from collection_items
   where collection_id = p_collection_id and recipe_id = any (v_ids);

  select coalesce(max(position), -1) into v_base
    from collection_items where collection_id = p_collection_id;

  insert into collection_items (collection_id, recipe_id, position)
  select p_collection_id, r.id, v_base + r.ord
    from (select id, row_number() over () as ord
            from unnest(v_ids) as id) r
  on conflict (collection_id, recipe_id) do nothing;

  get diagnostics v_added = row_count;

  -- The client says what happened, so it needs the three cases apart: newly
  -- filed, already there, and gone.
  return jsonb_build_object(
    'ok', true,
    'name', v_name,
    'added', v_added,
    'already', v_already,
    'skipped', v_sent - coalesce(array_length(v_ids, 1), 0)
  );
end;
$$;

grant execute on function public.add_recipes_to_collection(uuid,uuid[]) to authenticated;
