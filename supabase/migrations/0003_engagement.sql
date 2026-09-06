-- Engagement: swipes (partitioned), saves, cooks, collections, social graph,
-- explicit negative signals, idempotency. Spec refs: §8.2, §12, §16, §22, §23.2.

-- swipes is the highest-volume table by an order of magnitude, so it is range
-- partitioned by month from the start (§22). Raw rows older than the retention
-- window are aggregated into user_taste_profile and dropped.
create table public.swipes (
  id               uuid not null default gen_random_uuid(),
  user_id          uuid references public.users(id) on delete cascade,
  device_id        uuid references public.devices(id) on delete cascade,
  recipe_id        uuid not null references public.recipes(id) on delete cascade,
  action           swipe_action not null,
  category_context text,
  session_id       uuid,
  client_ts        timestamptz,
  created_at       timestamptz not null default now(),
  primary key (id, created_at),
  -- a swipe belongs to an account or, for guests, to a device
  constraint swipes_actor_present check (user_id is not null or device_id is not null)
) partition by range (created_at);

create index swipes_user_recipe_idx on public.swipes(user_id, recipe_id);
create index swipes_device_recipe_idx on public.swipes(device_id, recipe_id);
create index swipes_recipe_idx on public.swipes(recipe_id, action);

-- Creates the partition covering a given month; safe to call repeatedly.
create or replace function public.ensure_swipe_partition(for_month date)
returns void language plpgsql security definer set search_path = public as $$
declare
  start_at date := date_trunc('month', for_month)::date;
  end_at   date := (date_trunc('month', for_month) + interval '1 month')::date;
  part     text := 'swipes_' || to_char(start_at, 'YYYY_MM');
begin
  if to_regclass('public.' || part) is null then
    execute format(
      'create table public.%I partition of public.swipes for values from (%L) to (%L)',
      part, start_at, end_at);
  end if;
end;
$$;

select public.ensure_swipe_partition((date_trunc('month', now()) + (n || ' month')::interval)::date)
from generate_series(-1, 6) as n;

create table public.swipes_default partition of public.swipes default;

-- Aggregated taste summary that survives raw-swipe retention pruning (§22).
create table public.user_taste_profile (
  user_id          uuid primary key references public.users(id) on delete cascade,
  cuisine_scores   jsonb not null default '{}',
  tag_scores       jsonb not null default '{}',
  ingredient_scores jsonb not null default '{}',
  swipes_rolled_up bigint not null default 0,
  updated_at       timestamptz not null default now()
);

create table public.saves (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  recipe_id  uuid not null references public.recipes(id) on delete cascade,
  source     text check (source in ('deck','detail','search','profile','collection')),
  created_at timestamptz not null default now(),
  unique (user_id, recipe_id)
);
create index saves_user_created_idx on public.saves(user_id, created_at desc);
create index saves_recipe_idx on public.saves(recipe_id);

create table public.cooks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  recipe_id  uuid not null references public.recipes(id) on delete cascade,
  -- §16: behind the cook_photos flag until moderation capacity exists
  photo_url  text,
  created_at timestamptz not null default now()
);
create index cooks_user_idx on public.cooks(user_id, created_at desc);
create index cooks_recipe_idx on public.cooks(recipe_id);

-- Feeds the "recipes opened previously by this user" ranking input (§21.2).
create table public.recipe_opens (
  user_id    uuid not null references public.users(id) on delete cascade,
  recipe_id  uuid not null references public.recipes(id) on delete cascade,
  open_count int not null default 1,
  last_open_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);

create table public.collections (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  name            text not null check (length(name) between 1 and 60),
  cover_image_url text,
  -- §12: private by default; public collections are Phase 2 behind a flag
  visibility      collection_visibility not null default 'private',
  position        int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, name)
);
create trigger collections_updated_at before update on public.collections
  for each row execute function public.set_updated_at();

create table public.collection_items (
  collection_id uuid not null references public.collections(id) on delete cascade,
  recipe_id     uuid not null references public.recipes(id) on delete cascade,
  position      int not null default 0,
  added_at      timestamptz not null default now(),
  primary key (collection_id, recipe_id)
);
create index collection_items_recipe_idx on public.collection_items(recipe_id);

create table public.follows (
  follower_id  uuid not null references public.users(id) on delete cascade,
  following_id uuid not null references public.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_not_self check (follower_id <> following_id)
);
create index follows_following_idx on public.follows(following_id);

-- §20.1: blocking is bidirectional invisibility.
create table public.blocks (
  blocker_id uuid not null references public.users(id) on delete cascade,
  blocked_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks(blocked_id);

-- Softer than a block: removes a creator from the feed only.
create table public.mutes (
  muter_id  uuid not null references public.users(id) on delete cascade,
  muted_id  uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id),
  constraint mutes_not_self check (muter_id <> muted_id)
);

-- §8.2 "show me less like this" writes explicit negative signals, which rank
-- far better than inferred ones.
create table public.negative_signals (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  kind       negative_signal_kind not null,
  value      text not null,
  weight     real not null default 1.0,
  created_at timestamptz not null default now(),
  unique (user_id, kind, value)
);
create index negative_signals_user_idx on public.negative_signals(user_id, kind);

-- §23.2: the offline queue retries, so writes must be replay-safe.
create table public.idempotency_keys (
  key        text primary key,
  user_id    uuid references public.users(id) on delete cascade,
  endpoint   text not null,
  response   jsonb,
  created_at timestamptz not null default now()
);
create index idempotency_keys_created_idx on public.idempotency_keys(created_at);
