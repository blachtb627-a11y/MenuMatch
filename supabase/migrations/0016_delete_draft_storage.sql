-- Fixes delete_draft: it cannot remove the cover image itself.
--
-- storage.objects carries a `protect_objects_delete` trigger that rejects any
-- direct DELETE ("direct delete from storage table is not allowed") — files go
-- through the storage API, not SQL. 0015 deleted from that table inside the RPC,
-- so deleting any draft that had a cover photo failed outright. The row delete
-- is the part that has to be transactional; the file is cleaned up by the client
-- afterwards through the storage API, which the recipe_media_delete policy
-- already scopes to the creator's own prefix. A file left behind if that second
-- call fails is a much smaller problem than a delete that will not go through.

create or replace function public.delete_draft(p_recipe_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_user uuid := (select public.current_user_id());
  r      recipes%rowtype;
begin
  if v_user is null then raise exception 'authentication required'; end if;

  select * into r from recipes
   where id = p_recipe_id and creator_id = v_user and deleted_at is null;
  if not found then raise exception 'draft not found'; end if;

  if r.status <> 'draft' or r.published_at is not null then
    raise exception 'only an unpublished draft can be deleted'
      using hint = 'Unpublish it first, which keeps it for anyone who saved it.';
  end if;

  delete from recipes where id = r.id;

  -- Handed back so the caller can clear the cover from storage.
  return jsonb_build_object('deleted', true, 'id', r.id,
                            'coverImageUrl', r.cover_image_url);
end;
$$;

revoke execute on function public.delete_draft(uuid) from public, anon;
grant  execute on function public.delete_draft(uuid) to authenticated;
