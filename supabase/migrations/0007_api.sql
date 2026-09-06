-- Write-side API (§23.1) as security-definer RPCs so authorization, idempotency,
-- and batching are enforced server-side rather than trusted from the client.

-- ------------------------------------------------ stats maintained by trigger

create or replace function public.bump_save_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update recipe_stats set save_count = save_count + 1, updated_at = now()
     where recipe_id = new.recipe_id;
    return new;
  else
    update recipe_stats set save_count = greatest(0, save_count - 1), updated_at = now()
     where recipe_id = old.recipe_id;
    return old;
  end if;
end;
$$;
create trigger saves_bump_stats after insert or delete on public.saves
  for each row execute function public.bump_save_count();

create or replace function public.bump_cook_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update recipe_stats set cook_count = cook_count + 1, updated_at = now()
   where recipe_id = new.recipe_id;
  return new;
end;
$$;
create trigger cooks_bump_stats after insert on public.cooks
  for each row execute function public.bump_cook_count();

-- ------------------------------------------------ account bootstrap (§7)

-- A Supabase auth signup creates the MenuMatch profile, preferences, and
-- notification defaults in one transaction.
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_base text;
  v_name text;
  v_id   uuid;
  n      int := 0;
begin
  v_base := lower(regexp_replace(split_part(coalesce(new.email, 'cook'), '@', 1),
                                 '[^a-z0-9_.]', '', 'g'));
  if length(v_base) < 3 then v_base := 'cook' || v_base; end if;
  v_base := left(v_base, 24);
  v_name := v_base;
  while exists (select 1 from users u where u.username = v_name) loop
    n := n + 1;
    v_name := left(v_base, 24) || n::text;
  end loop;

  insert into users (auth_id, username, display_name, email)
  values (new.id, v_name,
          coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), v_name),
          new.email)
  returning id into v_id;

  insert into user_preferences (user_id) values (v_id);
  insert into notification_preferences (user_id) values (v_id);
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Private fields (email, age band) are not readable through the users table;
-- a user reads their own via this function. §28.2.
create or replace function public.me()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', u.id, 'username', u.username, 'displayName', u.display_name,
    'email', u.email, 'bio', u.bio, 'avatarUrl', u.avatar_url,
    'isCreator', u.is_creator, 'ageBand', u.age_band, 'status', u.status,
    'createdAt', u.created_at,
    'preferences', to_jsonb(p) - 'user_id',
    'savedCount', (select count(*) from saves s where s.user_id = u.id),
    'isAdmin', exists (select 1 from admin_roles ar where ar.user_id = u.id)
  )
  from users u
  left join user_preferences p on p.user_id = u.id
  where u.auth_id = auth.uid();
$$;

-- ------------------------------------------------ devices & guest merge (§7)

create or replace function public.register_device(
  p_device_key text, p_platform text default null, p_app_version text default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_device_key is null or length(p_device_key) < 16 then
    raise exception 'invalid device key';
  end if;
  insert into devices (device_key, user_id, platform, app_version)
  values (p_device_key, (select public.current_user_id()), p_platform, p_app_version)
  on conflict (device_key) do update
    set last_seen_at = now(),
        platform     = coalesce(excluded.platform, devices.platform),
        app_version  = coalesce(excluded.app_version, devices.app_version),
        user_id      = coalesce(devices.user_id, excluded.user_id)
  returning id into v_id;
  return v_id;
end;
$$;

-- §7: guest swipe activity is recorded against the device and merged into the
-- account's history at signup.
create or replace function public.claim_guest_history(p_device_key text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_user   uuid := (select public.current_user_id());
  v_device uuid;
  v_moved  int := 0;
begin
  if v_user is null then raise exception 'authentication required'; end if;
  select id into v_device from devices where device_key = p_device_key;
  if v_device is null then return jsonb_build_object('merged', 0); end if;

  update devices set user_id = v_user where id = v_device and user_id is null;

  update swipes set user_id = v_user
   where device_id = v_device and user_id is null;
  get diagnostics v_moved = row_count;

  return jsonb_build_object('merged', v_moved);
end;
$$;

-- ------------------------------------------------ swipes (§8.2, §23.2)

-- Batched and idempotent: the offline queue may post up to 20 swipes per
-- request and will retry, so replays must not double-count.
create or replace function public.record_swipes(
  p_swipes jsonb, p_device_key text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_user     uuid := (select public.current_user_id());
  v_device   uuid;
  v_item     jsonb;
  v_key      text;
  v_accepted int := 0;
  v_replayed int := 0;
begin
  if jsonb_typeof(p_swipes) <> 'array' then
    raise exception 'p_swipes must be a JSON array';
  end if;
  if jsonb_array_length(p_swipes) > 20 then
    raise exception 'at most 20 swipes per request';
  end if;
  if p_device_key is not null then
    select id into v_device from devices where device_key = p_device_key;
  end if;
  if v_user is null and v_device is null then
    raise exception 'a user or a registered device is required';
  end if;

  perform public.ensure_swipe_partition(current_date);

  for v_item in select * from jsonb_array_elements(p_swipes) loop
    v_key := v_item->>'idempotencyKey';
    if v_key is not null then
      insert into idempotency_keys (key, user_id, endpoint)
      values (v_key, v_user, 'record_swipes')
      on conflict (key) do nothing;
      if not found then
        v_replayed := v_replayed + 1;
        continue;
      end if;
    end if;

    insert into swipes (user_id, device_id, recipe_id, action, category_context,
                        session_id, client_ts)
    values (v_user, v_device, (v_item->>'recipeId')::uuid,
            (v_item->>'action')::swipe_action, v_item->>'categoryContext',
            nullif(v_item->>'sessionId','')::uuid,
            nullif(v_item->>'clientTs','')::timestamptz);

    update recipe_stats
       set pass_count = pass_count + case when v_item->>'action' = 'pass' then 1 else 0 end,
           updated_at = now()
     where recipe_id = (v_item->>'recipeId')::uuid;

    v_accepted := v_accepted + 1;
  end loop;

  return jsonb_build_object('accepted', v_accepted, 'replayed', v_replayed);
end;
$$;

-- §8.2: undo returns a passed card to the deck and removes a save.
create or replace function public.undo_swipe(p_recipe_id uuid, p_device_key text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_user   uuid := (select public.current_user_id());
  v_device uuid;
begin
  if p_device_key is not null then
    select id into v_device from devices where device_key = p_device_key;
  end if;

  delete from swipes
   where recipe_id = p_recipe_id
     and ((v_user is not null and user_id = v_user)
       or (v_user is null and v_device is not null and device_id = v_device));

  if v_user is not null then
    delete from saves where user_id = v_user and recipe_id = p_recipe_id;
  end if;

  return jsonb_build_object('undone', true);
end;
$$;

-- ------------------------------------------------ saves & cooks

create or replace function public.save_recipe(
  p_recipe_id uuid, p_source text default 'deck', p_idempotency_key text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_user uuid := (select public.current_user_id());
begin
  if v_user is null then raise exception 'authentication required'; end if;
  if not public.recipe_visible(p_recipe_id) then raise exception 'recipe not available'; end if;

  if p_idempotency_key is not null then
    insert into idempotency_keys (key, user_id, endpoint)
    values (p_idempotency_key, v_user, 'save_recipe')
    on conflict (key) do nothing;
  end if;

  insert into saves (user_id, recipe_id, source)
  values (v_user, p_recipe_id, p_source)
  on conflict (user_id, recipe_id) do nothing;

  return jsonb_build_object('saved', true, 'recipeId', p_recipe_id);
end;
$$;

create or replace function public.unsave_recipe(p_recipe_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_user uuid := (select public.current_user_id());
begin
  if v_user is null then raise exception 'authentication required'; end if;
  delete from saves where user_id = v_user and recipe_id = p_recipe_id;
  return jsonb_build_object('saved', false, 'recipeId', p_recipe_id);
end;
$$;

create or replace function public.record_cook(
  p_recipe_id uuid, p_photo_url text default null, p_idempotency_key text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_user uuid := (select public.current_user_id());
  v_flags jsonb := (select value from app_config where key = 'feature_flags');
begin
  if v_user is null then raise exception 'authentication required'; end if;
  if not public.recipe_visible(p_recipe_id) then raise exception 'recipe not available'; end if;

  if p_idempotency_key is not null then
    insert into idempotency_keys (key, user_id, endpoint)
    values (p_idempotency_key, v_user, 'record_cook')
    on conflict (key) do nothing;
    if not found then
      return jsonb_build_object('recorded', false, 'replayed', true);
    end if;
  end if;

  -- §16: cook photos stay dark until moderation capacity exists
  insert into cooks (user_id, recipe_id, photo_url)
  values (v_user, p_recipe_id,
          case when coalesce((v_flags->>'cook_photos')::boolean, false)
               then p_photo_url else null end);

  return jsonb_build_object('recorded', true);
end;
$$;

-- ------------------------------------------------ reads

create or replace function public.get_recipe(p_recipe_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_user uuid := (select public.current_user_id());
  v_out  jsonb;
begin
  if not public.recipe_visible(p_recipe_id) then
    -- §17: a saved recipe that was removed shows a clear state, never a crash.
    return jsonb_build_object('id', p_recipe_id, 'unavailable', true);
  end if;

  if v_user is not null then
    insert into recipe_opens (user_id, recipe_id)
    values (v_user, p_recipe_id)
    on conflict (user_id, recipe_id)
      do update set open_count = recipe_opens.open_count + 1, last_open_at = now();
    update recipe_stats set open_count = open_count + 1 where recipe_id = p_recipe_id;
  end if;

  select public.recipe_card(r.id)
      || jsonb_build_object(
        'description', r.description,
        'prepMinutes', r.prep_minutes,
        'cookMinutes', r.cook_minutes,
        'attribution', r.attribution,
        'nutrition', r.nutrition,
        'containsAlcohol', r.contains_alcohol,
        'publishedAt', r.published_at,
        'isSaved', v_user is not null and exists (
          select 1 from saves s where s.user_id = v_user and s.recipe_id = r.id),
        'isFollowingCreator', v_user is not null and exists (
          select 1 from follows f where f.follower_id = v_user and f.following_id = r.creator_id),
        'ingredients', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', ri.id, 'position', ri.position,
            'quantity', case when ri.quantity_numerator is null then null
                        else jsonb_build_object('numerator', ri.quantity_numerator,
                                                'denominator', ri.quantity_denominator) end,
            'unit', ri.unit,
            'unitIsImprecise', ri.unit is not null and public.unit_is_imprecise(ri.unit),
            'ingredient', ri.ingredient_text, 'note', ri.note)
            order by ri.position)
          from recipe_ingredients ri where ri.recipe_id = r.id), '[]'::jsonb),
        'steps', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', st.id, 'position', st.position, 'instruction', st.instruction,
            'imageUrl', st.image_url, 'timerSeconds', st.timer_seconds)
            order by st.position)
          from recipe_steps st where st.recipe_id = r.id), '[]'::jsonb),
        'media', coalesce((
          select jsonb_agg(jsonb_build_object('url', m.url, 'width', m.width,
                                              'height', m.height, 'blurhash', m.blurhash)
                 order by m.position)
          from recipe_media m where m.recipe_id = r.id), '[]'::jsonb))
    into v_out
  from recipes r where r.id = p_recipe_id;

  return v_out;
end;
$$;

-- §6/§23.1: the client renders whatever this returns.
create or replace function public.get_config()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('slug', slug, 'label', label,
                                          'description', description)
                       order by position, label)
      from categories where is_enabled), '[]'::jsonb),
    'flags', coalesce((select value from app_config where key = 'feature_flags'), '{}'::jsonb),
    'quickThresholdMinutes',
      coalesce((select value from app_config where key = 'quick_threshold_minutes'), '30'::jsonb)
  );
$$;

-- §8.2 "show me less like this": explicit negative signals.
create or replace function public.less_like_this(p_kind text, p_value text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_user uuid := (select public.current_user_id());
begin
  if v_user is null then raise exception 'authentication required'; end if;
  insert into negative_signals (user_id, kind, value)
  values (v_user, p_kind::negative_signal_kind, p_value)
  on conflict (user_id, kind, value)
    do update set weight = least(3.0, negative_signals.weight + 1.0);
  return jsonb_build_object('recorded', true);
end;
$$;

revoke all on function public.get_feed(text,int,text,uuid[]) from public;
grant execute on function public.get_feed(text,int,text,uuid[]) to anon, authenticated;
grant execute on function public.get_config() to anon, authenticated;
grant execute on function public.get_recipe(uuid) to anon, authenticated;
grant execute on function public.register_device(text,text,text) to anon, authenticated;
grant execute on function public.record_swipes(jsonb,text) to anon, authenticated;
grant execute on function public.undo_swipe(uuid,text) to anon, authenticated;
grant execute on function public.me() to authenticated;
grant execute on function public.save_recipe(uuid,text,text) to authenticated;
grant execute on function public.unsave_recipe(uuid) to authenticated;
grant execute on function public.record_cook(uuid,text,text) to authenticated;
grant execute on function public.claim_guest_history(text) to authenticated;
grant execute on function public.less_like_this(text,text) to authenticated;
