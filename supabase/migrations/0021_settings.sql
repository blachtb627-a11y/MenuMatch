-- Dietary preferences, blocking, and data export (§20.1, §28.1, §28.4).
--
-- All three were rows in Profile that did nothing. The blocks and mutes tables
-- have existed since 0003 and get_feed has always honoured them — there was
-- simply no way for anyone to write one.

-- ---------------------------------------------------------------- preferences

/** The caller's own preferences, for the settings screen. */
create or replace function public.my_preferences()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'dietaryTags', coalesce(p.dietary_tags, '{}'),
    'favoriteCategories', coalesce(p.favorite_categories, '{}'),
    'dislikedIngredients', coalesce(p.disliked_ingredients, '{}'),
    'cuisines', coalesce(p.cuisines, '{}'),
    'skillLevel', p.skill_level,
    'unitsPreference', p.units_preference,
    'onboardingComplete', p.onboarding_complete)
  from user_preferences p
  where p.user_id = (select public.current_user_id());
$$;

/**
 * Saves preferences. Every field is optional, so the settings screen can send
 * only what changed and onboarding can keep sending everything.
 *
 * §8: dietary tags are a hard constraint on the deck and disliked ingredients
 * are checked against ingredient text, so both take effect on the next fetch.
 */
create or replace function public.save_preferences(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_user uuid := (select public.current_user_id());
begin
  if v_user is null then raise exception 'authentication required'; end if;

  insert into user_preferences (user_id) values (v_user)
  on conflict (user_id) do nothing;

  update user_preferences set
    dietary_tags = case when p ? 'dietaryTags'
      then (select coalesce(array_agg(value::text), '{}')
              from jsonb_array_elements_text(p->'dietaryTags') value)
      else dietary_tags end,
    favorite_categories = case when p ? 'favoriteCategories'
      then (select coalesce(array_agg(value::text), '{}')
              from jsonb_array_elements_text(p->'favoriteCategories') value)
      else favorite_categories end,
    disliked_ingredients = case when p ? 'dislikedIngredients'
      then (select coalesce(array_agg(lower(trim(value::text))), '{}')
              from jsonb_array_elements_text(p->'dislikedIngredients') value
             where trim(value::text) <> '')
      else disliked_ingredients end,
    cuisines = case when p ? 'cuisines'
      then (select coalesce(array_agg(value::text), '{}')
              from jsonb_array_elements_text(p->'cuisines') value)
      else cuisines end,
    skill_level = case when p ? 'skillLevel'
      then nullif(p->>'skillLevel', '')::difficulty_level else skill_level end,
    units_preference = case when p ? 'unitsPreference'
      then coalesce(nullif(p->>'unitsPreference', ''), 'original') else units_preference end,
    onboarding_complete = case when p ? 'onboardingComplete'
      then coalesce((p->>'onboardingComplete')::boolean, onboarding_complete)
      else onboarding_complete end
  where user_id = v_user;

  return public.my_preferences();
end;
$$;

-- ---------------------------------------------------------------- blocking

/**
 * §20.1: blocking is bidirectional invisibility. get_feed already filters both
 * directions; this is what finally lets someone create one.
 *
 * Blocking also drops the follow in both directions, because a block that
 * leaves a follow in place is not a block.
 */
create or replace function public.block_user(p_user_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_user uuid := (select public.current_user_id());
begin
  if v_user is null then raise exception 'authentication required'; end if;
  if p_user_id = v_user then raise exception 'you cannot block yourself'; end if;
  if not exists (select 1 from users where id = p_user_id and deleted_at is null) then
    raise exception 'account not found';
  end if;

  insert into blocks (blocker_id, blocked_id) values (v_user, p_user_id)
  on conflict do nothing;

  delete from follows
   where (follower_id = v_user and following_id = p_user_id)
      or (follower_id = p_user_id and following_id = v_user);

  return jsonb_build_object('blocked', true);
end;
$$;

create or replace function public.unblock_user(p_user_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_user uuid := (select public.current_user_id());
begin
  if v_user is null then raise exception 'authentication required'; end if;
  delete from blocks where blocker_id = v_user and blocked_id = p_user_id;
  return jsonb_build_object('blocked', false);
end;
$$;

/** Who the caller has blocked. Never who has blocked the caller (§20.1). */
create or replace function public.my_blocks()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', u.id, 'username', u.username, 'displayName', u.display_name,
    'blockedAt', b.created_at) order by b.created_at desc), '[]'::jsonb)
  from blocks b join users u on u.id = b.blocked_id
  where b.blocker_id = (select public.current_user_id());
$$;

/** Whether the caller has blocked this account, for a creator page. */
create or replace function public.is_blocked_by_me(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from blocks
                  where blocker_id = (select public.current_user_id())
                    and blocked_id = p_user_id);
$$;

-- ---------------------------------------------------------------- export (§28.1)

/**
 * Everything MenuMatch holds about the caller, as one JSON document.
 *
 * Swipes are the one thing capped: the history runs to thousands of rows and a
 * browser has to hold the whole document in memory to save it. The count is
 * exact and the most recent 1000 are included, which is what anyone reading
 * their own export is actually looking for.
 */
create or replace function public.export_my_data()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_user uuid := (select public.current_user_id());
  u      users%rowtype;
begin
  if v_user is null then raise exception 'authentication required'; end if;
  select * into u from users where id = v_user;

  return jsonb_build_object(
    'exportedAt', now(),
    'account', jsonb_build_object(
      'id', u.id, 'username', u.username, 'displayName', u.display_name,
      'email', u.email::text, 'bio', u.bio, 'ageBand', u.age_band,
      'status', u.status, 'createdAt', u.created_at),
    'preferences', public.my_preferences(),
    'recipes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'title', r.title, 'description', r.description,
        'status', r.status, 'cuisine', r.cuisine, 'category', r.category,
        'servings', r.servings, 'prepMinutes', r.prep_minutes,
        'cookMinutes', r.cook_minutes, 'nutrition', r.nutrition,
        'createdAt', r.created_at, 'publishedAt', r.published_at,
        'ingredients', (select jsonb_agg(ri.ingredient_text order by ri.position)
                          from recipe_ingredients ri where ri.recipe_id = r.id),
        'steps', (select jsonb_agg(st.instruction order by st.position)
                    from recipe_steps st where st.recipe_id = r.id))
        order by r.created_at)
      from recipes r where r.creator_id = v_user and r.deleted_at is null), '[]'::jsonb),
    'saves', coalesce((
      select jsonb_agg(jsonb_build_object(
        'recipeId', s.recipe_id, 'title', r.title, 'savedAt', s.created_at)
        order by s.created_at desc)
      from saves s left join recipes r on r.id = s.recipe_id
      where s.user_id = v_user), '[]'::jsonb),
    'collections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', c.name, 'createdAt', c.created_at,
        'recipes', (select jsonb_agg(ci.recipe_id order by ci.position)
                      from collection_items ci where ci.collection_id = c.id))
        order by c.created_at)
      from collections c where c.user_id = v_user), '[]'::jsonb),
    'cooks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'recipeId', ck.recipe_id, 'cookedAt', ck.created_at) order by ck.created_at desc)
      from cooks ck where ck.user_id = v_user), '[]'::jsonb),
    'blocked', public.my_blocks(),
    'swipes', jsonb_build_object(
      'total', (select count(*) from swipes where user_id = v_user),
      'mostRecent', coalesce((
        select jsonb_agg(jsonb_build_object(
          'recipeId', sw.recipe_id, 'action', sw.action, 'at', sw.created_at)
          order by sw.created_at desc)
        from (select * from swipes where user_id = v_user
               order by created_at desc limit 1000) sw), '[]'::jsonb)));
end;
$$;

revoke execute on function public.my_preferences()          from public, anon;
revoke execute on function public.save_preferences(jsonb)   from public, anon;
revoke execute on function public.block_user(uuid)          from public, anon;
revoke execute on function public.unblock_user(uuid)        from public, anon;
revoke execute on function public.my_blocks()               from public, anon;
revoke execute on function public.is_blocked_by_me(uuid)    from public, anon;
revoke execute on function public.export_my_data()          from public, anon;

grant execute on function public.my_preferences()           to authenticated;
grant execute on function public.save_preferences(jsonb)    to authenticated;
grant execute on function public.block_user(uuid)           to authenticated;
grant execute on function public.unblock_user(uuid)         to authenticated;
grant execute on function public.my_blocks()                to authenticated;
grant execute on function public.is_blocked_by_me(uuid)     to authenticated;
grant execute on function public.export_my_data()           to authenticated;
