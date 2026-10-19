-- "Meal Prep" and "meal prep" were two collections. create_collection matched
-- an existing name exactly, so a different capital letter or a stray space made
-- a second one, and the Cookbook then showed both side by side.
--
-- Names are now stored trimmed with inner runs of whitespace collapsed, and
-- compared without case. Creating a name that already exists returns the
-- existing collection, as it always did for an exact match; renaming onto one
-- is refused, as it always was.
--
-- Existing duplicates are left alone: merging someone's collections is not a
-- migration's call, and they can delete or rename the spare.

create or replace function public.collection_name_key(p_name text)
returns text language sql immutable parallel safe
set search_path = public as $$
  select lower(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'));
$$;

create or replace function public.create_collection(p_name text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_user uuid := (select public.current_user_id());
  v_name text := left(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), 60);
  v_id   uuid;
begin
  if v_user is null then raise exception 'authentication required'; end if;
  if v_name = '' then raise exception 'a collection needs a name'; end if;

  select id into v_id from collections
   where user_id = v_user
     and public.collection_name_key(name) = public.collection_name_key(v_name)
   order by position limit 1;
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
  v_name text := left(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), 60);
begin
  if v_user is null then raise exception 'authentication required'; end if;
  if v_name = '' then raise exception 'a collection needs a name'; end if;

  if exists (select 1 from collections
              where user_id = v_user and id <> p_id
                and public.collection_name_key(name) = public.collection_name_key(v_name)) then
    raise exception 'you already have a collection called %', v_name;
  end if;

  update collections set name = v_name where id = p_id and user_id = v_user;
  if not found then raise exception 'collection not found'; end if;
  return jsonb_build_object('ok', true, 'name', v_name);
end;
$$;

revoke execute on function public.collection_name_key(text) from public, anon;
grant execute on function public.create_collection(text)       to authenticated;
grant execute on function public.rename_collection(uuid, text) to authenticated;
