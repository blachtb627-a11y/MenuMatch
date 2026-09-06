-- Recipe system: canonical ingredients, tags, recipes, structured rows, media, versions.
-- Spec refs: §10, §15, §17, §19, §22, §24, §38.

create table public.ingredients (
  id             uuid primary key default gen_random_uuid(),
  canonical_name extensions.citext not null unique,
  aliases        text[] not null default '{}',
  category       text,
  -- drives the §21.3 "no more than 3 of the same primary protein" constraint
  protein_group  text,
  created_at     timestamptz not null default now()
);
create index ingredients_name_trgm_idx on public.ingredients using gin (canonical_name extensions.gin_trgm_ops);
create index ingredients_aliases_idx on public.ingredients using gin (aliases);

create table public.tags (
  id               uuid primary key default gen_random_uuid(),
  name             extensions.citext not null,
  slug             text not null unique check (slug ~ '^[a-z0-9_-]+$'),
  type             tag_type not null,
  -- §19.2: allergen and dietary claims are creator-supplied unless the platform
  -- has verified them. The client must label them accordingly.
  is_verified_type boolean not null default false,
  created_at       timestamptz not null default now(),
  unique (name, type)
);
create index tags_type_idx on public.tags(type);

create table public.recipes (
  id                uuid primary key default gen_random_uuid(),
  creator_id        uuid not null references public.users(id) on delete cascade,
  title             text not null check (length(title) between 3 and 100),
  description       text check (length(description) <= 1000),
  cover_image_url   text,
  category          text references public.categories(slug) on update cascade,
  cuisine           text,
  prep_minutes      int not null check (prep_minutes >= 0 and prep_minutes <= 6000),
  cook_minutes      int not null check (cook_minutes >= 0 and cook_minutes <= 6000),
  total_minutes     int generated always as (prep_minutes + cook_minutes) stored,
  servings          int not null check (servings between 1 and 100),
  difficulty        difficulty_level,
  -- denormalised for the diversity pass; set from the ingredient rows on publish
  primary_protein   text,
  status            recipe_status not null default 'draft',
  moderation_state  moderation_state not null default 'clear',
  attribution       text check (length(attribution) <= 300),
  -- §18.2: stored with a timestamp against the recipe version
  rights_confirmed_at timestamptz,
  -- §28.3: excluded from the default Drinks feed unless the flag is on
  contains_alcohol  boolean not null default false,
  -- §19.3 creator-supplied estimate; never computed by the platform in v1
  nutrition         jsonb,
  protein_g         int check (protein_g >= 0),
  is_seed           boolean not null default false,
  -- §38: present from day one so paid placement is never a later migration
  sponsorship_id    uuid,
  published_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,

  -- §15/§23.2: publishing rules are enforced server-side, not by the client.
  constraint recipes_publish_requires_rights check (
    status <> 'published'
    or (rights_confirmed_at is not null and cover_image_url is not null and published_at is not null)
  )
);

create index recipes_discovery_idx on public.recipes(category, status, moderation_state)
  where deleted_at is null;
create index recipes_creator_idx on public.recipes(creator_id, status) where deleted_at is null;
create index recipes_published_at_idx on public.recipes(published_at desc) where status = 'published';
create index recipes_total_minutes_idx on public.recipes(total_minutes) where status = 'published';
create index recipes_title_trgm_idx on public.recipes using gin (title extensions.gin_trgm_ops);
create trigger recipes_updated_at before update on public.recipes
  for each row execute function public.set_updated_at();

-- Full-text search over the recipe's own prose (§13).
alter table public.recipes add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(cuisine,'')), 'B') ||
    setweight(to_tsvector('english', coalesce(description,'')), 'C')
  ) stored;
create index recipes_search_idx on public.recipes using gin (search_vector);

create table public.recipe_ingredients (
  id                   uuid primary key default gen_random_uuid(),
  recipe_id            uuid not null references public.recipes(id) on delete cascade,
  position             int not null,
  -- §22: stored as a fraction so `1/3 cup` scales and renders cleanly
  quantity_numerator   int check (quantity_numerator >= 0),
  quantity_denominator int not null default 1 check (quantity_denominator > 0),
  unit                 measurement_unit,
  ingredient_text      text not null check (length(ingredient_text) between 1 and 120),
  ingredient_id        uuid references public.ingredients(id) on delete set null,
  note                 text check (length(note) <= 120),
  unique (recipe_id, position)
);
create index recipe_ingredients_recipe_idx on public.recipe_ingredients(recipe_id, position);
create index recipe_ingredients_ingredient_idx on public.recipe_ingredients(ingredient_id);
create index recipe_ingredients_text_trgm_idx
  on public.recipe_ingredients using gin (ingredient_text extensions.gin_trgm_ops);

create table public.recipe_steps (
  id            uuid primary key default gen_random_uuid(),
  recipe_id     uuid not null references public.recipes(id) on delete cascade,
  position      int not null,
  instruction   text not null check (length(instruction) between 1 and 2000),
  image_url     text,
  -- §11: parsed from the step text at publish time, offered as a one-tap timer
  timer_seconds int check (timer_seconds > 0),
  unique (recipe_id, position)
);
create index recipe_steps_recipe_idx on public.recipe_steps(recipe_id, position);

create table public.recipe_tags (
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  tag_id    uuid not null references public.tags(id) on delete cascade,
  source    tag_source not null default 'creator',
  primary key (recipe_id, tag_id)
);
create index recipe_tags_tag_idx on public.recipe_tags(tag_id);

create table public.recipe_media (
  id        uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  url       text not null,
  width     int,
  height    int,
  -- §20.4: perceptual hash for near-duplicate detection
  phash     text,
  blurhash  text,
  position  int not null default 0,
  type      media_type not null default 'detail',
  created_at timestamptz not null default now()
);
create index recipe_media_recipe_idx on public.recipe_media(recipe_id, position);
create index recipe_media_phash_idx on public.recipe_media(phash) where phash is not null;

-- §17: before/after snapshots for moderation and dispute review.
create table public.recipe_versions (
  id         uuid primary key default gen_random_uuid(),
  recipe_id  uuid not null references public.recipes(id) on delete cascade,
  snapshot   jsonb not null,
  edited_by  uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index recipe_versions_recipe_idx on public.recipe_versions(recipe_id, created_at desc);

-- Engagement counters kept as both numerator and denominator so ranking can use
-- rates rather than raw counts (§21.2) and new recipes are not buried.
create table public.recipe_stats (
  recipe_id       uuid primary key references public.recipes(id) on delete cascade,
  impression_count bigint not null default 0,
  open_count      bigint not null default 0,
  save_count      bigint not null default 0,
  pass_count      bigint not null default 0,
  cook_count      bigint not null default 0,
  updated_at      timestamptz not null default now()
);

create or replace function public.ensure_recipe_stats()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.recipe_stats(recipe_id) values (new.id)
  on conflict (recipe_id) do nothing;
  return new;
end;
$$;
create trigger recipes_create_stats after insert on public.recipes
  for each row execute function public.ensure_recipe_stats();
