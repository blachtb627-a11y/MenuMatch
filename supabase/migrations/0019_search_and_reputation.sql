-- Search that finds creators as well as recipes, save counts a creator can see,
-- and a creator-level term in the deck's ranking. Spec refs: §13, §16, §21.
--
-- On vocabulary: §3's lexicon is Save, not Like. A save is already the signal
-- being counted — it is what the swipe records and what feeds the ranking — so
-- the counter is labelled Saves rather than introducing a second word for the
-- same act.

-- ---------------------------------------------------------------- creator stats

/**
 * A creator's saves and impressions, rolled up over their published recipes.
 *
 * Kept as a function rather than a view so the feed can restrict it to the
 * creators actually in the candidate pool instead of the whole table.
 */
create or replace function public.creator_stats(p_creator_ids uuid[])
returns table (creator_id uuid, recipes bigint, saves bigint,
               impressions bigint, cooks bigint)
language sql stable security definer set search_path = public as $$
  select r.creator_id,
         count(*)::bigint,
         coalesce(sum(st.save_count), 0)::bigint,
         coalesce(sum(st.impression_count), 0)::bigint,
         coalesce(sum(st.cook_count), 0)::bigint
  from recipes r
  left join recipe_stats st on st.recipe_id = r.id
  where r.creator_id = any (p_creator_ids)
    and r.status = 'published' and r.deleted_at is null
  group by r.creator_id;
$$;

-- §21.2: a creator whose recipes get saved is worth surfacing more often. The
-- weight is deliberately below dietary_match and similar_to_saved — popularity
-- informs the deck, it does not overrule what someone actually asked for.
update public.app_config
   set value = value || jsonb_build_object('creator_reputation', 1.8)
 where key = 'ranking_weights';

-- ---------------------------------------------------------------- search (§13)

/**
 * One search across recipes and creators.
 *
 * Recipes rank on text match first, then on save rate with the same Bayesian
 * prior the deck uses, so a proven recipe edges out an unproven one without a
 * single lucky save beating everything. Creators rank on total saves.
 *
 * Runs as a function rather than a client-side table query because it spans two
 * tables, needs the ranking, and has to apply the §20.1 block rules — none of
 * which belong in the client.
 */
create or replace function public.search_all(
  p_query       text,
  p_max_minutes int default null,
  p_limit       int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_user  uuid := (select public.current_user_id());
  v_q     text := coalesce(trim(p_query), '');
  v_limit int  := least(greatest(coalesce(p_limit, 30), 1), 50);
begin
  if length(v_q) < 2 then
    return jsonb_build_object('recipes', '[]'::jsonb, 'creators', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'recipes', coalesce((
      select jsonb_agg(x order by x.rank desc, x.saves desc)
      from (
        select jsonb_build_object(
                 'id', r.id, 'title', r.title,
                 'coverImageUrl', r.cover_image_url,
                 'totalMinutes', r.total_minutes, 'cuisine', r.cuisine,
                 'saveCount', coalesce(st.save_count, 0),
                 'creator', jsonb_build_object(
                   'id', u.id, 'username', u.username, 'displayName', u.display_name)
               ) as j,
               coalesce(st.save_count, 0) as saves,
               (ts_rank(r.search_vector, websearch_to_tsquery('english', v_q))
                 + case when r.title ilike '%' || v_q || '%' then 1.0 else 0 end
                 -- Same prior as the deck: proven beats unproven, but a new
                 -- recipe is not buried for having no history yet.
                 + ((coalesce(st.save_count, 0) + 0.12 * 20)
                    / (coalesce(st.impression_count, 0) + 20)))::real as rank
        from recipes r
        join users u on u.id = r.creator_id
        left join recipe_stats st on st.recipe_id = r.id
        where r.status = 'published' and r.deleted_at is null
          and r.moderation_state in ('clear','flagged')
          and (p_max_minutes is null or r.total_minutes <= p_max_minutes)
          and (r.search_vector @@ websearch_to_tsquery('english', v_q)
               or r.title ilike '%' || v_q || '%'
               or r.cuisine ilike '%' || v_q || '%'
               or u.username ilike '%' || v_q || '%'
               or u.display_name ilike '%' || v_q || '%')
          and (v_user is null or not exists (
                select 1 from blocks b
                where (b.blocker_id = v_user and b.blocked_id = r.creator_id)
                   or (b.blocked_id = v_user and b.blocker_id = r.creator_id)))
        limit v_limit
      ) x
    ), '[]'::jsonb),

    -- Creators are matched on name, not on their recipes, so searching a
    -- person finds the person even when none of their titles mention them.
    'creators', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', u.id, 'username', u.username, 'displayName', u.display_name,
               'bio', u.bio, 'avatarUrl', u.avatar_url,
               'isSeedAccount', u.is_seed_account,
               'recipes', coalesce(cs.recipes, 0),
               'saves', coalesce(cs.saves, 0))
             order by coalesce(cs.saves, 0) desc, cs.recipes desc nulls last)
      from users u
      left join lateral (
        select * from public.creator_stats(array[u.id])
      ) cs on true
      where u.deleted_at is null and u.status = 'active'
        and (u.username ilike '%' || v_q || '%'
             or u.display_name ilike '%' || v_q || '%')
        and (v_user is null or not exists (
              select 1 from blocks b
              where (b.blocker_id = v_user and b.blocked_id = u.id)
                 or (b.blocked_id = v_user and b.blocker_id = u.id)))
      limit 10
    ), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------- creator page

/** A creator's public profile and their published recipes (§14). */
create or replace function public.creator_profile(p_creator uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_user uuid := (select public.current_user_id());
  u      users%rowtype;
begin
  select * into u from users
   where id = p_creator and deleted_at is null and status = 'active';
  if not found then raise exception 'creator not found'; end if;

  if v_user is not null and exists (
       select 1 from blocks b
       where (b.blocker_id = v_user and b.blocked_id = u.id)
          or (b.blocked_id = v_user and b.blocker_id = u.id)) then
    raise exception 'creator not found';
  end if;

  return jsonb_build_object(
    'id', u.id, 'username', u.username, 'displayName', u.display_name,
    'bio', u.bio, 'avatarUrl', u.avatar_url,
    'isSeedAccount', u.is_seed_account,
    'joinedAt', u.created_at,
    'saves', coalesce((select saves from public.creator_stats(array[u.id])), 0),
    'recipes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'title', r.title,
               'coverImageUrl', r.cover_image_url,
               'totalMinutes', r.total_minutes, 'cuisine', r.cuisine,
               'saveCount', coalesce(st.save_count, 0))
             order by coalesce(st.save_count, 0) desc, r.published_at desc)
      from recipes r
      left join recipe_stats st on st.recipe_id = r.id
      where r.creator_id = u.id and r.status = 'published' and r.deleted_at is null
        and r.moderation_state in ('clear','flagged')), '[]'::jsonb));
end;
$$;

revoke execute on function public.creator_stats(uuid[])            from public, anon, authenticated;
revoke execute on function public.search_all(text,int,int)         from public;
revoke execute on function public.creator_profile(uuid)            from public;
grant  execute on function public.search_all(text,int,int)         to anon, authenticated;
grant  execute on function public.creator_profile(uuid)            to anon, authenticated;
