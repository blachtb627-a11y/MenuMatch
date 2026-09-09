-- Paid placement (§38): advertisers, campaigns, and honest delivery.
--
-- The deck is the only real inventory, so an ad is a card in it — same shape as
-- a recipe, labelled SPONSORED, swiped away like anything else. §38 requires
-- paid placement to be visually distinguishable, which the card already does.
--
-- Two levers decide whether a campaign runs, which is what "views and time"
-- means together:
--   time  — a start and an end, and nothing serves outside them
--   views — a total impression goal, spread evenly across the days remaining
--           rather than burned through on the first morning
--
-- An impression is counted when the ad actually reaches the top of someone's
-- deck, not when the deck is fetched. That distinction is the whole difference
-- between a number an advertiser can be billed for and one that is a guess:
-- a deck of twenty cards that someone abandons after three did not deliver
-- twenty views.

-- ------------------------------------------------------------------ tables

create table if not exists public.advertisers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(trim(name)) between 1 and 120),
  contact_name  text,
  contact_email text,
  website_url   text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

do $$ begin
  create type public.ad_status as enum
    ('draft', 'scheduled', 'active', 'paused', 'completed', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ad_event_kind as enum ('impression', 'click');
exception when duplicate_object then null; end $$;

create table if not exists public.ad_campaigns (
  id             uuid primary key default gen_random_uuid(),
  advertiser_id  uuid not null references public.advertisers (id) on delete cascade,
  name           text not null check (length(trim(name)) between 1 and 120),

  -- the creative
  headline   text not null check (length(trim(headline)) between 1 and 80),
  body       text check (length(body) <= 200),
  image_url  text not null,
  cta_label  text not null default 'Learn more' check (length(trim(cta_label)) between 1 and 24),
  click_url  text not null,

  -- time
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,

  -- views. A null goal means "as often as the caps allow, until the end date".
  impression_goal       int check (impression_goal is null or impression_goal > 0),
  daily_impression_cap  int check (daily_impression_cap is null or daily_impression_cap > 0),
  -- Nobody should meet the same ad ten times before lunch.
  frequency_cap_per_day int not null default 3 check (frequency_cap_per_day between 1 and 50),
  -- One ad every N recipe cards.
  deck_interval         int not null default 12 check (deck_interval between 3 and 100),

  status ad_status not null default 'draft',

  -- Denormalised so serving never counts a growing event table to decide
  -- whether a campaign is finished.
  impression_count int not null default 0,
  click_count      int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id) on delete set null,

  constraint ad_campaign_window check (ends_at > starts_at)
);

create index if not exists ad_campaigns_serving
  on public.ad_campaigns (status, starts_at, ends_at) where status = 'active';

create table if not exists public.ad_events (
  id          bigserial primary key,
  campaign_id uuid not null references public.ad_campaigns (id) on delete cascade,
  kind        ad_event_kind not null,
  -- Kept so the same person is not shown one ad all day. Null for a signed-out
  -- viewer, where the device key is the only handle there is.
  user_id     uuid references public.users (id) on delete set null,
  device_key  uuid,
  created_at  timestamptz not null default now()
);

-- The two questions serving asks: how much has this campaign delivered today,
-- and how often has this person seen it today.
create index if not exists ad_events_campaign_day
  on public.ad_events (campaign_id, kind, created_at desc);
create index if not exists ad_events_viewer_day
  on public.ad_events (campaign_id, user_id, device_key, created_at desc);

alter table public.advertisers   enable row level security;
alter table public.ad_campaigns  enable row level security;
alter table public.ad_events     enable row level security;

-- No policies at all: every path in and out is a SECURITY DEFINER function
-- below, so the client can neither read an advertiser's contact details nor
-- write its own impressions.

-- ------------------------------------------------------------------ serving

/**
 * How many impressions this campaign may still serve today.
 *
 * Null means uncapped. An explicit daily cap wins; otherwise the remaining
 * goal is spread across the days left, recomputed each day so a slow day is
 * made up later rather than lost.
 */
create or replace function public.ad_daily_allowance(c public.ad_campaigns)
returns int language sql stable set search_path = public as $$
  select case
    when c.daily_impression_cap is not null then c.daily_impression_cap
    when c.impression_goal is null then null
    else greatest(
      ceil((c.impression_goal - c.impression_count)::numeric
           / greatest(date_part('day', date_trunc('day', c.ends_at)
                                      - date_trunc('day', now()))::int + 1, 1)
      )::int, 1)
  end;
$$;

/**
 * The next ad to show, or null when nothing is eligible.
 *
 * Picks the campaign furthest behind its own pace, so several running at once
 * share the inventory instead of the oldest one taking all of it.
 */
create or replace function public.get_ad(p_device_key uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_user uuid := (select public.current_user_id());
  v_row  jsonb;
begin
  select jsonb_build_object(
           'id', c.id,
           'headline', c.headline,
           'body', c.body,
           'imageUrl', c.image_url,
           'ctaLabel', c.cta_label,
           'clickUrl', c.click_url,
           'advertiser', a.name,
           'deckInterval', c.deck_interval)
    into v_row
    from ad_campaigns c
    join advertisers a on a.id = c.advertiser_id
   cross join lateral (
     select public.ad_daily_allowance(c) as allowance,
            (select count(*) from ad_events e
              where e.campaign_id = c.id and e.kind = 'impression'
                and e.created_at >= date_trunc('day', now())) as today,
            (select count(*) from ad_events e
              where e.campaign_id = c.id and e.kind = 'impression'
                and e.created_at >= date_trunc('day', now())
                and ((v_user is not null and e.user_id = v_user)
                  or (v_user is null and p_device_key is not null
                      and e.device_key = p_device_key))) as seen_by_viewer
   ) d
   where c.status = 'active'
     and now() between c.starts_at and c.ends_at
     and (c.impression_goal is null or c.impression_count < c.impression_goal)
     and (d.allowance is null or d.today < d.allowance)
     and d.seen_by_viewer < c.frequency_cap_per_day
   -- Furthest behind pace first; a campaign with no goal sorts last so a paid
   -- goal is never starved by an open-ended one.
   order by case when d.allowance is null then 1 else 0 end,
            case when d.allowance is null then 0
                 else d.today::numeric / d.allowance end,
            c.ends_at
   limit 1;

  return coalesce(v_row, 'null'::jsonb);
end;
$$;

/**
 * Counts a view. Called when the card actually reaches the top of the deck.
 *
 * Returns quietly on a campaign that has since stopped: a client holding a
 * stale ad should not error, it should simply not be billed for it.
 */
create or replace function public.record_ad_impression(
  p_campaign_id uuid, p_device_key uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_user uuid := (select public.current_user_id());
  v_c    public.ad_campaigns%rowtype;
begin
  select * into v_c from ad_campaigns where id = p_campaign_id;
  if v_c.id is null or v_c.status <> 'active'
     or now() not between v_c.starts_at and v_c.ends_at then
    return jsonb_build_object('ok', false, 'counted', false);
  end if;

  insert into ad_events (campaign_id, kind, user_id, device_key)
  values (p_campaign_id, 'impression', v_user, p_device_key);

  update ad_campaigns
     set impression_count = impression_count + 1,
         -- A campaign that has delivered its goal stops itself, so nobody has
         -- to remember to switch it off.
         status = case
           when impression_goal is not null and impression_count + 1 >= impression_goal
             then 'completed'::ad_status
           else status end,
         updated_at = now()
   where id = p_campaign_id;

  return jsonb_build_object('ok', true, 'counted', true);
end;
$$;

/** Counts a tap on the call to action. */
create or replace function public.record_ad_click(
  p_campaign_id uuid, p_device_key uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_user uuid := (select public.current_user_id());
begin
  if not exists (select 1 from ad_campaigns where id = p_campaign_id) then
    return jsonb_build_object('ok', false);
  end if;

  insert into ad_events (campaign_id, kind, user_id, device_key)
  values (p_campaign_id, 'click', v_user, p_device_key);

  update ad_campaigns set click_count = click_count + 1, updated_at = now()
   where id = p_campaign_id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.get_ad(uuid)                        to anon, authenticated;
grant execute on function public.record_ad_impression(uuid,uuid)     to anon, authenticated;
grant execute on function public.record_ad_click(uuid,uuid)          to anon, authenticated;
