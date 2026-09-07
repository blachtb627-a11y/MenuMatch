-- Lets a creator take their own recipe down (§17, §28.4).
--
-- Replaces delete_draft, which only ever handled a recipe nobody had seen. The
-- two cases are genuinely different and the difference is not the creator's to
-- guess at, so one function decides it from the recipe's own history:
--
--   never published  -> a real delete. Nothing references it, nothing is lost.
--   published before -> a tombstone. Saves, collection entries, cook records
--                       and moderation history all point at this row, and RLS
--                       filters on deleted_at, so it leaves every surface at
--                       once without orphaning what other people did with it.
--
-- Unpublishing is the gentler option and stays separate: unpublish_recipe takes
-- a recipe out of discovery but leaves it readable for anyone who saved it.

drop function if exists public.delete_draft(uuid);

create or replace function public.delete_recipe(p_recipe_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_user   uuid := (select public.current_user_id());
  r        recipes%rowtype;
  v_saves  int;
  v_hard   boolean;
begin
  if v_user is null then raise exception 'authentication required'; end if;

  select * into r from recipes
   where id = p_recipe_id and creator_id = v_user and deleted_at is null;
  if not found then raise exception 'recipe not found'; end if;

  select count(*) into v_saves from saves s
   where s.recipe_id = r.id and s.user_id <> v_user;

  v_hard := r.published_at is null and r.status = 'draft';

  if v_hard then
    delete from recipes where id = r.id;
  else
    update recipes set deleted_at = now(), status = 'deleted' where id = r.id;
  end if;

  -- The caller clears the cover through the storage API; storage.objects
  -- rejects a direct delete from SQL.
  return jsonb_build_object(
    'deleted', true, 'id', r.id, 'hard', v_hard,
    'coverImageUrl', case when v_hard then r.cover_image_url else null end,
    'savedByOthers', v_saves);
end;
$$;

revoke execute on function public.delete_recipe(uuid) from public, anon;
grant  execute on function public.delete_recipe(uuid) to authenticated;
