-- MenuMatch foundation: extensions, enums, helpers, identity, backend-driven config.
-- Spec refs: §6 (categories are backend-configured), §22 (data model), §28 (privacy/age).

create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------- enums

create type user_status        as enum ('active','suspended','banned','deleted');
create type recipe_status      as enum ('draft','pending_review','published','unpublished','under_review','removed','deleted');
create type moderation_state   as enum ('clear','flagged','under_review','removed');
create type difficulty_level   as enum ('easy','medium','hard');
create type swipe_action       as enum ('save','pass');
create type tag_type           as enum ('dietary','cuisine','meal','equipment','occasion','allergen');
create type tag_source         as enum ('creator','admin','system');
create type collection_visibility as enum ('private','public');
create type media_type         as enum ('cover','detail','step','cook_photo');
create type actor_type         as enum ('user','admin','system');
create type negative_signal_kind as enum ('creator','ingredient','cuisine');

-- Appendix C. Imprecise units never scale.
create type measurement_unit as enum (
  'tsp','tbsp','fl_oz','cup','pint','quart','gallon','ml','l',
  'oz','lb','g','kg',
  'piece','clove','slice','bunch','can','package','sprig','head','stalk',
  'pinch','dash','to_taste','handful'
);

create or replace function public.unit_is_imprecise(u measurement_unit)
returns boolean language sql immutable parallel safe as $$
  select u in ('pinch','dash','to_taste','handful');
$$;

-- ---------------------------------------------------------------- helpers

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- identity

create table public.users (
  id             uuid primary key default gen_random_uuid(),
  auth_id        uuid unique references auth.users(id) on delete set null,
  username       extensions.citext not null unique
                   check (length(username) between 3 and 30
                          and username ~ '^[a-z0-9_.]+$'),
  display_name   text not null check (length(display_name) between 1 and 60),
  email          extensions.citext,
  bio            text check (length(bio) <= 300),
  avatar_url     text,
  status         user_status not null default 'active',
  is_creator     boolean not null default false,
  -- §5.3: company-operated accounts must be visibly labeled.
  is_seed_account boolean not null default false,
  -- §28.3: store the derived age band, not the raw date of birth.
  age_band       text check (age_band in ('under_13','13_15','16_17','18_plus')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index users_status_idx on public.users(status) where deleted_at is null;
create index users_username_trgm_idx on public.users using gin (username extensions.gin_trgm_ops);
create index users_display_name_trgm_idx on public.users using gin (display_name extensions.gin_trgm_ops);
create trigger users_updated_at before update on public.users
  for each row execute function public.set_updated_at();

-- Resolves the calling auth user to a MenuMatch user id. Wrapped in (select ...)
-- at call sites so Postgres treats it as an initplan instead of a per-row call.
create or replace function public.current_user_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.users where auth_id = auth.uid() and deleted_at is null;
$$;

create table public.user_preferences (
  user_id             uuid primary key references public.users(id) on delete cascade,
  dietary_tags        text[] not null default '{}',
  favorite_categories text[] not null default '{}',
  disliked_ingredients text[] not null default '{}',
  cuisines            text[] not null default '{}',
  skill_level         difficulty_level,
  goals               text[] not null default '{}',
  units_preference    text not null default 'original'
                        check (units_preference in ('original','metric','imperial')),
  onboarding_complete boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger user_preferences_updated_at before update on public.user_preferences
  for each row execute function public.set_updated_at();

-- §7: guests swipe against a device id, merged into the account at signup.
create table public.devices (
  id           uuid primary key default gen_random_uuid(),
  device_key   text not null unique,
  user_id      uuid references public.users(id) on delete cascade,
  push_token   text,
  platform     text check (platform in ('ios','android','web')),
  app_version  text,
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index devices_user_idx on public.devices(user_id);

-- ---------------------------------------------------------------- config (§6)

create table public.categories (
  slug         text primary key check (slug ~ '^[a-z0-9_]+$'),
  label        text not null,
  description  text,
  position     int not null default 0,
  is_enabled   boolean not null default true,
  -- feed strategy the backend applies; the client never hard-codes these.
  feed_kind    text not null default 'tag_filtered'
                 check (feed_kind in ('for_you','following','tag_filtered','time_capped','nutrition_gated','curated')),
  filter_tag   text,
  max_total_minutes int,
  min_protein_g     int,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index categories_enabled_position_idx on public.categories(is_enabled, position);
create trigger categories_updated_at before update on public.categories
  for each row execute function public.set_updated_at();

-- Ranking weights and feature flags, tunable without a deploy (§21.2, §29).
create table public.app_config (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now()
);
create trigger app_config_updated_at before update on public.app_config
  for each row execute function public.set_updated_at();

insert into public.app_config (key, value, description) values
  ('ranking_weights', jsonb_build_object(
      'category_match', 2.0, 'cuisine_match', 1.5, 'dietary_match', 2.5,
      'similar_to_saved', 2.0, 'creator_followed', 3.0, 'previously_opened', 0.8,
      'save_rate', 4.0, 'cook_rate', 3.0, 'recency', 1.2,
      'negative_creator', -6.0, 'negative_ingredient', -5.0, 'negative_cuisine', -4.0),
    'Weighted feed score inputs, §21.2'),
  ('feed', jsonb_build_object(
      'page_size', 20, 'candidate_pool', 300, 'exploration_share', 0.12,
      'pass_cooldown_days', 90, 'max_per_creator_per_window', 2,
      'max_per_cuisine_per_window', 4, 'max_per_protein_per_window', 3,
      'diversity_window', 20),
    'Deck supply and diversity constraints, §21.3 / §8.3'),
  ('feature_flags', jsonb_build_object(
      'cook_photos', false, 'alcohol_recipes', false, 'public_collections', false,
      'star_ratings', false, 'comments', false),
    '§16 engagement decisions and §28.3 alcohol policy'),
  ('quick_threshold_minutes', to_jsonb(30), 'Quick category cap, §9');
