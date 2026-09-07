-- Adds a creator-reputation term to the deck's ranking (§21.2).
--
-- The scoring already rewarded a recipe that gets saved. It had nothing that
-- rewarded a creator who consistently gets saved, so a good creator's newest
-- recipe started from the same place as anyone's. This closes that: their
-- catalogue's save rate lifts every recipe they publish.
--
-- Deliberately weighted below dietary_match and similar_to_saved. Popularity
-- informs the deck; it does not overrule what someone actually asked for, and a
-- deck that only shows the already-popular is how a catalogue stops growing.

create or replace function public.get_feed(
  p_category  text    default 'for_you',
  p_limit     int     default 20,
  p_device_key text   default null,
  p_exclude   uuid[]  default '{}'
) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_user      uuid := (select public.current_user_id());
  v_device    uuid;
  w           jsonb := (select value from app_config where key = 'ranking_weights');
  f           jsonb := (select value from app_config where key = 'feed');
  flags       jsonb := (select value from app_config where key = 'feature_flags');
  v_cat       categories%rowtype;
  v_pool      int  := coalesce((f->>'candidate_pool')::int, 300);
  v_win       int  := coalesce((f->>'diversity_window')::int, 20);
  v_max_creator int := coalesce((f->>'max_per_creator_per_window')::int, 2);
  v_max_cuisine int := coalesce((f->>'max_per_cuisine_per_window')::int, 4);
  v_max_protein int := coalesce((f->>'max_per_protein_per_window')::int, 3);
  v_cooldown  int  := coalesce((f->>'pass_cooldown_days')::int, 90);
  v_explore_share real := coalesce((f->>'exploration_share')::real, 0.12);

  v_relax     int  := 0;
  v_fallback  text := 'personalized';
  -- A dietary or nutrition gate is a promise about the content, not a
  -- preference. Personalization relaxes when the pool runs dry; these never do.
  v_strict    boolean := false;
  v_limit     int  := least(greatest(coalesce(p_limit, 20), 1), 50);

  -- candidate arrays, ordered by score desc
  c_id        uuid[];
  c_creator   uuid[];
  c_cuisine   text[];
  c_protein   text[];
  c_explore   boolean[];
  c_used      boolean[];
  n_cand      int := 0;

  p_id        uuid[] := '{}';
  p_creator   uuid[] := '{}';
  p_cuisine   text[] := '{}';
  p_protein   text[] := '{}';

  v_explore_target int;
  v_explore_taken  int := 0;
  v_stride    int;
  i           int;
  j           int;
  v_from      int;
  v_want_explore boolean;
  v_ok        boolean;
begin
  select * into v_cat from categories where slug = p_category and is_enabled;
  if not found then
    -- §6: the client renders whatever config returns and must degrade gracefully
    -- on an unknown category rather than showing a blank deck.
    select * into v_cat from categories where slug = 'for_you';
  end if;

  v_strict := v_cat.feed_kind = 'nutrition_gated' or v_cat.filter_tag is not null;

  if p_device_key is not null then
    select id into v_device from devices where device_key = p_device_key;
  end if;

  -- Relaxation ladder (Appendix B): personalized -> relaxed -> popular in
  -- category -> popular overall. Stops as soon as a level yields enough cards.
  for v_relax in 0..3 loop
    with prefs as (
      select coalesce(dietary_tags, '{}') as dietary_tags,
             coalesce(disliked_ingredients, '{}') as disliked,
             coalesce(favorite_categories, '{}') as fav_cats,
             coalesce(cuisines, '{}') as fav_cuisines
      from user_preferences where user_id = v_user
    ),
    -- explicit "show me less like this" signals (§8.2)
    neg as (
      select kind, value, weight from negative_signals where user_id = v_user
    ),
    saved_tags as (
      select t.slug, count(*)::real as n
      from saves s
      join recipe_tags rt on rt.recipe_id = s.recipe_id
      join tags t on t.id = rt.tag_id
      where s.user_id = v_user
      group by t.slug
    ),
    saved_cuisines as (
      select r.cuisine, count(*)::real as n
      from saves s join recipes r on r.id = s.recipe_id
      where s.user_id = v_user and r.cuisine is not null
      group by r.cuisine
    ),
    -- the exclusion set, read once (Appendix B step 1)
    excl as (
      select recipe_id from saves where user_id = v_user
      union
      select recipe_id from swipes
        where action = 'pass'
          and created_at > now() - make_interval(days => v_cooldown)
          and ((v_user is not null and user_id = v_user)
            or (v_device is not null and device_id = v_device))
      union
      select recipe_id from swipes
        where action = 'save'
          and ((v_user is not null and user_id = v_user)
            or (v_device is not null and device_id = v_device))
      union
      select unnest(p_exclude)
    ),
    base as (
      select r.*, coalesce(st.impression_count, 0) as impressions,
             coalesce(st.save_count, 0) as saves_n,
             coalesce(st.cook_count, 0) as cooks_n
      from recipes r
      left join recipe_stats st on st.recipe_id = r.id
      where r.deleted_at is null
        and r.status = 'published'
        and r.moderation_state in ('clear','flagged')
        -- §28.3: alcoholic drinks stay out unless the flag is explicitly on
        and (not r.contains_alcohol or coalesce((flags->>'alcohol_recipes')::boolean, false))
        and r.id not in (select recipe_id from excl)
        -- §20.1 bidirectional invisibility, applied at the query level
        and (v_user is null or not exists (
              select 1 from blocks b
              where (b.blocker_id = v_user and b.blocked_id = r.creator_id)
                 or (b.blocked_id = v_user and b.blocker_id = r.creator_id)))
        and (v_user is null or not exists (
              select 1 from mutes m where m.muter_id = v_user and m.muted_id = r.creator_id))
        -- category shape, from backend config rather than a hard-coded client list
        and (
          v_cat.feed_kind in ('for_you','curated')
          or (v_cat.feed_kind = 'following'
              and exists (select 1 from follows fo
                          where fo.follower_id = v_user and fo.following_id = r.creator_id))
          or (v_cat.feed_kind = 'tag_filtered' and (
                r.category = v_cat.slug
                or (v_cat.filter_tag is not null and exists (
                      select 1 from recipe_tags rt join tags t on t.id = rt.tag_id
                      where rt.recipe_id = r.id and t.slug = v_cat.filter_tag))))
          or (v_cat.feed_kind = 'time_capped'
              and r.total_minutes <= coalesce(v_cat.max_total_minutes, 30))
          -- §9: High Protein requires nutrition data; recipes without it are excluded
          or (v_cat.feed_kind = 'nutrition_gated'
              and r.protein_g is not null
              and r.protein_g >= coalesce(v_cat.min_protein_g, 20))
        )
        -- hard personalization constraints, dropped once we start relaxing
        and (v_relax > 0 or v_user is null or not exists (
              select 1 from prefs, unnest(prefs.dietary_tags) dt
              where not exists (
                select 1 from recipe_tags rt join tags t on t.id = rt.tag_id
                where rt.recipe_id = r.id and t.slug = dt)))
        and (v_relax > 0 or v_user is null or not exists (
              select 1 from prefs, unnest(prefs.disliked) di
              join recipe_ingredients ri on ri.recipe_id = r.id
              where ri.ingredient_text ilike '%' || di || '%'))
    ),
    -- §21.2 creator reputation: a creator whose recipes get saved is worth
    -- surfacing more often than one whose do not. A rate rather than a raw
    -- count, on the same prior shape as the recipe-level terms but with a
    -- heavier prior — a creator's aggregate is one number standing in for their
    -- whole catalogue, so it should take more evidence to move the deck than a
    -- single recipe's record does. A new creator sits at the prior, not at zero.
    crep as (
      select r.creator_id,
             ((coalesce(sum(st.save_count), 0) + 0.12 * 100)
              / (coalesce(sum(st.impression_count), 0) + 100))::real as rate
      from recipes r
      left join recipe_stats st on st.recipe_id = r.id
      where r.status = 'published' and r.deleted_at is null
        and r.creator_id in (select creator_id from base)
      group by r.creator_id
    ),
    scored as (
      select b.id, b.creator_id, b.cuisine, b.primary_protein, b.impressions,
        (
          -- stated preferences
          coalesce((w->>'category_match')::real, 0)
            * (case when v_relax >= 2 then 0
                    when exists (select 1 from prefs pr where b.category = any (pr.fav_cats))
                      then 1 else 0 end)
          + coalesce((w->>'cuisine_match')::real, 0)
            * (case when v_relax >= 2 then 0
                    when exists (select 1 from prefs pr where b.cuisine = any (pr.fav_cuisines))
                      then 1 else 0 end)
          -- similarity to what this user has already saved
          + coalesce((w->>'similar_to_saved')::real, 0)
            * (case when v_relax >= 2 then 0 else least(1.0, coalesce((
                select sum(sat.n) from recipe_tags rt
                join tags t on t.id = rt.tag_id
                join saved_tags sat on sat.slug = t.slug
                where rt.recipe_id = b.id), 0) / 10.0) end)
          + coalesce((w->>'cuisine_match')::real, 0) * 0.5
            * (case when v_relax >= 2 then 0 else least(1.0, coalesce((
                select sc.n from saved_cuisines sc where sc.cuisine = b.cuisine), 0) / 5.0) end)
          + coalesce((w->>'creator_followed')::real, 0)
            * (case when exists (select 1 from follows fo
                                 where fo.follower_id = v_user
                                   and fo.following_id = b.creator_id) then 1 else 0 end)
          + coalesce((w->>'previously_opened')::real, 0)
            * (case when exists (select 1 from recipe_opens ro
                                 where ro.user_id = v_user and ro.recipe_id = b.id) then 1 else 0 end)
          -- §21.2: rates, not raw counts, with a Bayesian prior so a 1-of-1
          -- recipe does not outrank a proven one and new recipes are not buried
          + coalesce((w->>'save_rate')::real, 0)
            * ((b.saves_n + 0.12 * 20) / (b.impressions + 20))
          + coalesce((w->>'cook_rate')::real, 0)
            * ((b.cooks_n + 0.03 * 20) / (b.impressions + 20))
          + coalesce((w->>'creator_reputation')::real, 0)
            * coalesce((select cr.rate from crep cr
                        where cr.creator_id = b.creator_id), 0.12)
          + coalesce((w->>'recency')::real, 0)
            * exp(-1 * extract(epoch from (now() - coalesce(b.published_at, b.created_at)))
                     / (60 * 60 * 24 * 45.0))
          -- explicit negative signals
          + coalesce((w->>'negative_creator')::real, 0)
            * coalesce((select n.weight from neg n
                        where n.kind = 'creator' and n.value = b.creator_id::text), 0)
          + coalesce((w->>'negative_cuisine')::real, 0)
            * coalesce((select n.weight from neg n
                        where n.kind = 'cuisine' and n.value = b.cuisine), 0)
          + coalesce((w->>'negative_ingredient')::real, 0)
            * coalesce((select max(n.weight) from neg n
                        where n.kind = 'ingredient'
                          and exists (select 1 from recipe_ingredients ri
                                      where ri.recipe_id = b.id
                                        and ri.ingredient_text ilike '%' || n.value || '%')), 0)
        )::real as score
      from base b
    )
    select array_agg(id order by score desc, impressions asc),
           array_agg(creator_id order by score desc, impressions asc),
           array_agg(coalesce(cuisine,'') order by score desc, impressions asc),
           array_agg(coalesce(primary_protein,'') order by score desc, impressions asc),
           array_agg(impressions < 50 order by score desc, impressions asc)
      into c_id, c_creator, c_cuisine, c_protein, c_explore
    from (select * from scored order by score desc, impressions asc limit v_pool) s;

    n_cand := coalesce(array_length(c_id, 1), 0);
    v_fallback := case v_relax when 0 then 'personalized' when 1 then 'relaxed'
                               when 2 then 'popular_in_category' else 'popular_overall' end;
    exit when n_cand >= v_limit;
    -- Level 3 widens past the category entirely, which §8.3 permits for a meal
    -- category but must never do for a gated one: showing a dessert in the High
    -- Protein deck, or meat under Vegetarian, breaks the category's promise.
    -- A strict category runs short and lets the client show the caught-up state.
    if v_relax = 2 then
      if v_strict then
        v_fallback := 'category_exhausted';
        exit;
      end if;
      v_cat.feed_kind := 'for_you';
    end if;
  end loop;

  if n_cand = 0 then
    return jsonb_build_object('cards', '[]'::jsonb, 'fallback', 'exhausted',
                              'category', v_cat.slug);
  end if;

  c_used := array_fill(false, array[n_cand]);
  v_explore_target := floor(v_limit * v_explore_share)::int;
  v_stride := case when v_explore_target > 0 then greatest(1, v_limit / v_explore_target) else 0 end;

  -- Post-ranking diversity pass (§21.3). Saving one pasta dish must not produce
  -- a deck of thirty pastas.
  for i in 1..v_limit loop
    v_want_explore := v_stride > 0 and v_explore_taken < v_explore_target
                      and i % v_stride = 0;
    j := null;

    -- phase 1: the reserved exploration slot, constraints honoured
    -- phase 2: best remaining candidate, constraints honoured
    -- phase 3: constraints relaxed, because a short deck is worse than a
    --          slightly repetitive one (§2 "never an empty deck")
    for phase in 1..3 loop
      for k in 1..n_cand loop
        if c_used[k] then continue; end if;
        if phase = 1 and not (v_want_explore and c_explore[k]) then continue; end if;

        if phase < 3 then
          v_from := greatest(1, coalesce(array_length(p_id, 1), 0) - v_win + 2);
          v_ok := (select count(*) from unnest(p_creator[v_from:]) x
                   where x = c_creator[k]) < v_max_creator
              and (c_cuisine[k] = '' or (select count(*) from unnest(p_cuisine[v_from:]) x
                   where x = c_cuisine[k]) < v_max_cuisine)
              and (c_protein[k] = '' or (select count(*) from unnest(p_protein[v_from:]) x
                   where x = c_protein[k]) < v_max_protein);
          if not v_ok then continue; end if;
        end if;

        j := k;
        exit;
      end loop;
      exit when j is not null;
    end loop;

    exit when j is null;
    c_used[j] := true;
    if c_explore[j] then v_explore_taken := v_explore_taken + 1; end if;
    p_id := p_id || c_id[j];
    p_creator := p_creator || c_creator[j];
    p_cuisine := p_cuisine || c_cuisine[j];
    p_protein := p_protein || c_protein[j];
  end loop;

  -- impressions are the denominator for every rate in §21.2 and §26
  update recipe_stats set impression_count = impression_count + 1, updated_at = now()
   where recipe_id = any (p_id);

  return jsonb_build_object(
    'category', v_cat.slug,
    'fallback', v_fallback,
    'cards', coalesce((
      select jsonb_agg(public.recipe_card(x) order by array_position(p_id, x))
      from unnest(p_id) x), '[]'::jsonb)
  );
end;
$$;

-- A creator could not see how their own published recipes were doing without
-- opening each one. The count is already maintained on recipe_stats.
create or replace function public.my_recipes()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'title', r.title, 'status', r.status,
    'coverImageUrl', r.cover_image_url, 'totalMinutes', r.total_minutes,
    'updatedAt', r.updated_at,
    'saveCount', coalesce(st.save_count, 0),
    'ingredientCount', (select count(*) from recipe_ingredients ri where ri.recipe_id = r.id),
    'stepCount', (select count(*) from recipe_steps s where s.recipe_id = r.id)
  ) order by r.updated_at desc), '[]'::jsonb)
  from recipes r
  left join recipe_stats st on st.recipe_id = r.id
  where r.creator_id = (select public.current_user_id()) and r.deleted_at is null;
$$;

revoke execute on function public.my_recipes() from public, anon;
grant  execute on function public.my_recipes() to authenticated;
