-- The weekly board (§16, §21.2): what got saved most in the last seven days,
-- and how the caller's own week went.
--
-- Two design notes, because both are load-bearing.
--
-- Weekly, not all-time. An all-time board freezes: whoever arrives first stays
-- on top, and everyone else can see they will never catch up, which puts off
-- exactly the person a board is meant to encourage. A rolling seven days means
-- every recipe has the same shot every week.
--
-- The caller's own numbers come back whether or not they place. Rank motivates
-- the handful of people who can win it; "your recipes were saved seven times,
-- up from three" works for everybody, including the only person who posted
-- that week. The board is aspiration, the personal line is the reward.

-- Saves are counted from the saves table rather than recipe_stats, which only
-- carries a running total with no way to ask "since when".
create index if not exists saves_created_idx on public.saves(created_at desc);

/**
 * Saves per recipe inside a window, for recipes still visible.
 *
 * Self-saves are excluded. Left in, the cheapest way to the top of the board
 * is to save your own recipe, and a board that rewards that stops meaning
 * anything within a week.
 */
create or replace function public.saves_between(p_from timestamptz, p_to timestamptz)
returns table (recipe_id uuid, creator_id uuid, saves bigint)
language sql stable security definer set search_path = public as $$
  select s.recipe_id, r.creator_id, count(*)::bigint
  from saves s
  join recipes r on r.id = s.recipe_id
  where s.created_at >= p_from and s.created_at < p_to
    and r.status = 'published' and r.deleted_at is null
    and s.user_id <> r.creator_id
  group by s.recipe_id, r.creator_id;
$$;

/**
 * The board.
 *
 * `top` is the ten most-saved recipes of the last seven days. `rising` is the
 * best save rate among recipes that have not had many impressions yet — a
 * recipe saved 18 times from 40 shows is doing better than one saved 90 times
 * from 9,000, and without this the board would only ever show accounts the
 * feed already favours. The prior is the same Bayesian shape the deck ranks
 * with, so a recipe with three impressions cannot fluke its way to the top.
 *
 * `me` is the caller's own week: saves across their published recipes, the
 * week before for comparison, their best recipe, and their rank if they placed.
 */
create or replace function public.weekly_board()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_user  uuid := (select public.current_user_id());
  v_to    timestamptz := date_trunc('day', now()) + interval '1 day';
  v_from  timestamptz := v_to - interval '7 days';
  v_prev  timestamptz := v_from - interval '7 days';
  v_result jsonb;
begin
  with week as (
    select * from public.saves_between(v_from, v_to)
  ),
  prior_week as (
    select * from public.saves_between(v_prev, v_from)
  ),
  ranked as (
    select w.*, row_number() over (order by w.saves desc, w.recipe_id) as position
    from week w
  ),
  -- Impressions inside the same window, so the rate is this week's rate and
  -- not a lifetime average that a long-published recipe would always win.
  shown as (
    select sw.recipe_id, count(*)::bigint as impressions
    from swipes sw
    where sw.created_at >= v_from and sw.created_at < v_to
    group by sw.recipe_id
  ),
  rising as (
    select w.recipe_id, w.saves, coalesce(sh.impressions, 0) as impressions,
           ((w.saves + 0.12 * 20) / (coalesce(sh.impressions, 0) + 20))::real as rate
    from week w
    left join shown sh on sh.recipe_id = w.recipe_id
    where coalesce(sh.impressions, 0) < 400
  )
  select jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'top', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'title', r.title, 'coverImageUrl', r.cover_image_url,
               'cuisine', r.cuisine, 'saves', k.saves, 'position', k.position,
               'isMine', coalesce(r.creator_id = v_user, false),
               'creator', jsonb_build_object(
                 'id', u.id, 'username', u.username, 'displayName', u.display_name))
             order by k.position)
      from ranked k
      join recipes r on r.id = k.recipe_id
      join users u on u.id = r.creator_id
      where k.position <= 10
        and not public.is_blocked_with(r.creator_id)
    ), '[]'::jsonb),
    'rising', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'title', r.title, 'coverImageUrl', r.cover_image_url,
               'saves', g.saves, 'impressions', g.impressions,
               'isMine', coalesce(r.creator_id = v_user, false),
               'creator', jsonb_build_object(
                 'id', u.id, 'username', u.username, 'displayName', u.display_name))
             order by g.rate desc, g.saves desc)
      from (select * from rising order by rate desc, saves desc limit 5) g
      join recipes r on r.id = g.recipe_id
      join users u on u.id = r.creator_id
      where not public.is_blocked_with(r.creator_id)
    ), '[]'::jsonb),
    'me', case when v_user is null then null else jsonb_build_object(
      'saves', coalesce((select sum(saves) from week where creator_id = v_user), 0),
      'savesPriorWeek',
        coalesce((select sum(saves) from prior_week where creator_id = v_user), 0),
      'published', (select count(*) from recipes
                     where creator_id = v_user and status = 'published'
                       and deleted_at is null),
      'bestPosition', (select min(position) from ranked where creator_id = v_user),
      'best', (select jsonb_build_object('id', r.id, 'title', r.title,
                                         'saves', k.saves, 'position', k.position)
               from ranked k join recipes r on r.id = k.recipe_id
               where k.creator_id = v_user
               order by k.position limit 1)
    ) end
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.saves_between(timestamptz,timestamptz) from public, anon, authenticated;
revoke execute on function public.weekly_board() from public, anon;
-- Guests can look: seeing what the app rewards is part of deciding to join.
grant execute on function public.weekly_board() to anon, authenticated;
