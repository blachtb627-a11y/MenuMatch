-- The tutorial was gated on an AsyncStorage flag alone, which is per device
-- rather than per person: a second device, a new browser, a reinstall or any
-- storage eviction shows it again to someone who has already been through it,
-- and someone signing in on a device where anyone else has finished it never
-- sees it at all. Whether a person has been shown the tutorial is a fact about
-- the account, so it belongs on the account.
alter table public.user_preferences
  add column if not exists tutorial_seen_at timestamptz;

comment on column public.user_preferences.tutorial_seen_at is
  'When this person finished or skipped the swipe tutorial. Null means never. '
  'me() returns the whole preferences row, so the client reads this from the '
  'session it already loads rather than asking separately.';

-- Idempotent and first-write-wins: replaying it must not move the date, or
-- "when did they first see it" stops being answerable.
create or replace function public.mark_tutorial_seen()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := public.current_user_id();
  v_at   timestamptz;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;

  insert into user_preferences (user_id, tutorial_seen_at)
  values (v_user, now())
  on conflict (user_id) do update
    set tutorial_seen_at = coalesce(user_preferences.tutorial_seen_at, now()),
        updated_at = now()
  returning tutorial_seen_at into v_at;

  return jsonb_build_object('ok', true, 'seenAt', v_at);
end $$;

-- EXECUTE on a new function goes to PUBLIC by default; anon has no
-- current_user_id() and would only ever get not_signed_in, but there is no
-- reason for the endpoint to exist for them.
revoke execute on function public.mark_tutorial_seen() from public, anon;
grant  execute on function public.mark_tutorial_seen() to authenticated;

-- my_preferences() is the settings screen's view of the same row; keep it in
-- step so the two do not disagree.
create or replace function public.my_preferences()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'dietaryTags', coalesce(p.dietary_tags, '{}'),
    'favoriteCategories', coalesce(p.favorite_categories, '{}'),
    'dislikedIngredients', coalesce(p.disliked_ingredients, '{}'),
    'cuisines', coalesce(p.cuisines, '{}'),
    'skillLevel', p.skill_level,
    'unitsPreference', p.units_preference,
    'onboardingComplete', p.onboarding_complete,
    'tutorialSeenAt', p.tutorial_seen_at)
  from user_preferences p
  where p.user_id = (select public.current_user_id());
$$;

-- Everyone already here has been through the tutorial: it is forced straight
-- after onboarding, and saving a recipe is on the other side of it. Without
-- this backfill the fix would make every existing account sit through it one
-- more time, which is the complaint it is meant to end.
--
-- Dated to the account's own creation rather than now(), so the column keeps
-- meaning "when they first saw it" instead of "when this migration ran".
insert into public.user_preferences (user_id, tutorial_seen_at)
select u.id, u.created_at
  from public.users u
 where exists (select 1 from public.saves s where s.user_id = u.id)
    or exists (select 1 from public.recipes r where r.creator_id = u.id)
    or exists (select 1 from public.user_preferences p
                where p.user_id = u.id and p.onboarding_complete)
on conflict (user_id) do update
  set tutorial_seen_at = coalesce(user_preferences.tutorial_seen_at,
                                  excluded.tutorial_seen_at);
