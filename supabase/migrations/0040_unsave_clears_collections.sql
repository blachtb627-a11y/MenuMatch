-- Taking a recipe out of the Cookbook takes it out of the folders too.
--
-- unsave_recipe() deleted the row in `saves` and stopped there, but a
-- collection is a folder inside the Cookbook, not a separate list:
-- collection_detail() and my_collections() read collection_items with no
-- reference to saves at all. So a removed recipe stayed in every collection it
-- had been filed into, still counted in the pill on the Cookbook screen, still
-- opening from inside the folder. "Removed from your Cookbook" was not true.
--
-- Only the caller's own collections are touched. Membership is keyed through
-- collections.user_id, so there is no way for this to reach into anyone
-- else's — but the join is written explicitly rather than relying on that.
--
-- The count comes back so the screen can say what actually happened instead of
-- guessing.
create or replace function public.unsave_recipe(p_recipe_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := (select public.current_user_id());
  v_cols int;
begin
  if v_user is null then raise exception 'authentication required'; end if;

  delete from collection_items ci
   using collections c
   where ci.collection_id = c.id
     and c.user_id = v_user
     and ci.recipe_id = p_recipe_id;
  get diagnostics v_cols = row_count;

  delete from saves where user_id = v_user and recipe_id = p_recipe_id;

  return jsonb_build_object(
    'saved', false,
    'recipeId', p_recipe_id,
    'collectionsCleared', v_cols);
end;
$$;
