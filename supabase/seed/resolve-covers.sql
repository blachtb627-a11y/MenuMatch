-- resolve-covers.sql — how the seed catalog's cover photographs were chosen.
--
-- `recipes_publish_requires_rights` refuses a published recipe with no cover, so
-- a cover has to exist before each recipe is inserted. This is the reproducible
-- form of that step: it runs entirely inside Postgres, because the database has
-- outbound internet access through the `http` extension and the machine building
-- the catalog generally does not.
--
-- Nothing here is part of the application. Create it, resolve the covers, load
-- the recipes, then run the teardown at the bottom. The `zz_` prefix is a
-- reminder that these objects are scaffolding.
--
-- Three filters decide a photograph, in order:
--
--   1. The filename must contain the dish word. Without this the search returns
--      whatever is nearest and you get a paella on a chorizo orzo — a URL that
--      resolves perfectly and shows the wrong food.
--   2. A deny-list excludes paintings, signs, shopfronts, raw ingredients and
--      process shots. Commons has a lot of them and a licence-first sort puts
--      them near the top: a still life by Clara Peeters came back for "soft
--      pretzel".
--   3. A vision model looks at the image. This is the only filter that catches
--      a photograph named exactly right and showing the wrong thing — a bubble
--      tea *sign*, a plate of moussaka *ingredients*, and, for "bruschetta",
--      a headshot of the Italian actor Ninni Bruschetta.
--
-- Then a fourth step chooses between the survivors. The first version took the
-- first photograph that passed, which is the first one Commons happened to rank,
-- not the best. Now the vision model also scores each candidate as a cover
-- (appeal, 1-10: light, focus, the food filling the frame, the whole plate in
-- view), every survivor is rated, and the highest wins — with photographs that
-- Commons reviewers have rated Quality, Featured or Valued breaking ties. A dish
-- whose best scores under 6 gets no cover and is listed in zz_needs_photo.
--
-- The vision step needs an Edge Function, because the Anthropic key must never
-- leave Edge Function secrets: supabase/functions/rate-cover. It is deployed for
-- the load and deleted immediately after, since it runs with verify_jwt
-- disabled behind a shared secret; its header has the commands.

create extension if not exists http with schema extensions;

-- ---------------------------------------------------------------------------
-- Percent-encoding. The Commons API rejects an unencoded accented filename
-- with a 400, which silently kills a whole batch, so encode byte-wise.
-- ---------------------------------------------------------------------------
create or replace function public.zz_urlencode(p text)
returns text language plpgsql immutable set search_path to 'public' as $$
declare
  v_hex text := encode(convert_to(coalesce(p,''), 'UTF8'), 'hex');
  v_out text := ''; i int; v_byte int; v_ch text;
begin
  for i in 1 .. length(v_hex) / 2 loop
    v_byte := ('x' || substr(v_hex, i*2 - 1, 2))::bit(8)::int;
    v_ch := chr(v_byte);
    if v_ch ~ '^[A-Za-z0-9._~:/-]$' then
      v_out := v_out || v_ch;
    else
      v_out := v_out || '%' || upper(substr(v_hex, i*2 - 1, 2));
    end if;
  end loop;
  return v_out;
end $$;

-- ---------------------------------------------------------------------------
-- Candidates for one dish: search Commons, apply filters 1 and 2, then fetch
-- thumbnail URLs and photographer credits for what survives.
--
-- Commons rate-limits anonymous clients hard and answers with an HTML error
-- page rather than JSON when it does, so every response is guarded on both
-- status and first byte before it is cast, and each call is retried.
-- ---------------------------------------------------------------------------
-- Each candidate also carries its original size and whether Commons reviewers
-- have rated it a Quality, Featured or Valued image — human judgments of the
-- photograph itself, which the rating step uses to break ties.
-- ---------------------------------------------------------------------------
drop function if exists public.zz_candidates(text, text);
create or replace function public.zz_candidates(p_query text, p_must text)
returns table(file_title text, url text, credit text, width int, height int, quality boolean)
language plpgsql set search_path to 'public' as $$
declare
  v_res record; v_search jsonb; v_info jsonb;
  v_titles text[]; v_try int; v_joined text;
  v_bad text := '(painting|still.life|drawing|engraving|illustration|woodcut|'
             || 'lithograph|etching|cook.?book|museum|stamp|coat.of.arms|logo|'
             || 'map|diagram|sign|menu|poster|label|packaging|advert|plaque|'
             || 'ingredient|uncooked|preparation|preparing|making|step.[0-9]|'
             || 'restaurant|shop|market|factory|portrait|building|languages)';
begin
  for v_try in 1..3 loop
    begin
      select status, content into v_res from extensions.http_get(
        'https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search'
        || '&srnamespace=6&srlimit=40&srsearch=' || public.zz_urlencode(p_query));
      if v_res.status = 200 and left(btrim(v_res.content),1) = '{' then
        v_search := v_res.content::jsonb; exit;
      end if;
    exception when others then null; end;
    perform pg_sleep(v_try * 3.0);
  end loop;
  if v_search is null then return; end if;

  -- Filters 1 and 2.
  select array_agg(x->>'title' order by ord) into v_titles
    from jsonb_array_elements(v_search#>'{query,search}') with ordinality as t(x, ord)
   where lower(x->>'title') like '%' || lower(p_must) || '%'
     and lower(x->>'title') ~ '\.(jpg|jpeg|png)$'
     and lower(x->>'title') !~ v_bad;
  if v_titles is null then return; end if;

  v_titles := v_titles[1:12];
  select string_agg(public.zz_urlencode(t), '%7C') into v_joined from unnest(v_titles) t;

  for v_try in 1..3 loop
    begin
      select status, content into v_res from extensions.http_get(
        'https://commons.wikimedia.org/w/api.php?action=query&format=json'
        || '&prop=imageinfo%7Ccategories&iiprop=url%7Cextmetadata%7Csize&iiurlwidth=1600'
        || '&clcategories=Category:Quality_images%7CCategory:Featured_pictures_on_Wikimedia_Commons'
        || '%7CCategory:Valued_images_sorted_by_promotion_date&cllimit=max&titles=' || v_joined);
      if v_res.status = 200 and left(btrim(v_res.content),1) = '{' then
        v_info := v_res.content::jsonb; exit;
      end if;
    exception when others then null; end;
    perform pg_sleep(v_try * 3.0);
  end loop;
  if v_info is null then return; end if;

  return query
    select p.value->>'title',
           split_part(p.value#>>'{imageinfo,0,thumburl}', '?', 1),
           btrim(regexp_replace(
             coalesce(p.value#>>'{imageinfo,0,extmetadata,Artist,value}',''), '<[^>]*>','','g')),
           (p.value#>>'{imageinfo,0,width}')::int,
           (p.value#>>'{imageinfo,0,height}')::int,
           jsonb_array_length(coalesce(p.value->'categories', '[]'::jsonb)) > 0
      from jsonb_each(v_info#>'{query,pages}') p
     where p.value#>>'{imageinfo,0,thumburl}' is not null
       -- Too small to fill a phone-width card without going soft.
       and least((p.value#>>'{imageinfo,0,width}')::int,
                 (p.value#>>'{imageinfo,0,height}')::int) >= 800
     order by array_position(v_titles, p.value->>'title');
end $$;

-- ---------------------------------------------------------------------------
-- Working tables. One row per dish in zz_cover, its candidates in zz_cand.
-- ---------------------------------------------------------------------------
create table if not exists public.zz_cover (
  slug text primary key,
  title text not null,
  query text not null,          -- what to search Commons for
  must  text not null,          -- the word the filename must contain
  file_title text,
  url text,
  credit text,
  license text,
  cand_done boolean not null default false,
  checked int not null default 0
);
alter table public.zz_cover add column if not exists appeal int;   -- score of the chosen photo

create table if not exists public.zz_cand (
  slug text not null,
  ord  int  not null,
  file_title text,
  url text,
  credit text,
  verdict text,                 -- null = not yet looked at, then 'yes' / 'no'
  saw text,                     -- what the vision model reported seeing
  primary key (slug, ord)
);
alter table public.zz_cand add column if not exists width int;
alter table public.zz_cand add column if not exists height int;
alter table public.zz_cand add column if not exists quality boolean not null default false;
alter table public.zz_cand add column if not exists appeal int;      -- 1-10, from rate-cover
alter table public.zz_cand add column if not exists whole boolean;   -- whole plate in frame
alter table public.zz_cand add column if not exists issues text;

-- ---------------------------------------------------------------------------
-- Filter 3: ask the vision model what is actually in the photograph, and how
-- good a cover it would make (supabase/functions/rate-cover).
--
-- The Edge Function fetches the image bytes itself and sends them as base64.
-- Anthropic's own URL fetcher cannot download from Wikimedia — it is blocked on
-- user agent — so passing the URL through returns "Unable to download the file".
--
-- Fill in the deployed function's URL and shared secret before running.
-- ---------------------------------------------------------------------------
create or replace function public.zz_verify(p_url text, p_expect text)
returns jsonb language plpgsql set search_path to 'public' as $$
declare v_res record;
begin
  select status, content into v_res from extensions.http((
    'POST',
    '<PROJECT_URL>/functions/v1/rate-cover',
    array[extensions.http_header('x-verify-secret', '<SHARED_SECRET>')],
    'application/json',
    jsonb_build_object('imageUrl', p_url, 'expect', p_expect)::text
  )::extensions.http_request);
  if v_res.status <> 200 or left(btrim(v_res.content),1) <> '{' then
    return jsonb_build_object('error', v_res.status);
  end if;
  return v_res.content::jsonb;
end $$;

-- ---------------------------------------------------------------------------
-- Drivers. Run zz_fetch_candidates until every dish has candidates, then
-- zz_rate_batch until nothing is left to rate, then zz_pick_best. All three are
-- restartable: they pick up whatever is still unfinished, so a rate-limited
-- call costs one batch and not the run.
-- ---------------------------------------------------------------------------
create or replace function public.zz_fetch_candidates(p_n int default 6)
returns text language plpgsql set search_path to 'public' as $$
declare v_row record; v_n int := 0;
begin
  for v_row in select * from public.zz_cover where not cand_done order by slug limit p_n loop
    insert into public.zz_cand (slug, ord, file_title, url, credit, width, height, quality)
    select v_row.slug, row_number() over (), c.file_title, c.url, c.credit,
           c.width, c.height, c.quality
      from public.zz_candidates(v_row.query, v_row.must) c
    on conflict do nothing;
    update public.zz_cover set cand_done = true where slug = v_row.slug;
    v_n := v_n + 1;
  end loop;
  return v_n || ' dishes; '
    || (select count(*) from public.zz_cover where cand_done) || '/'
    || (select count(*) from public.zz_cover) || ' done; '
    || (select count(*) from public.zz_cand) || ' candidates total';
end $$;

-- Rates candidates rather than stopping at the first acceptable one: the first
-- yes is the first photograph Commons happened to rank, not the best. Reviewer-
-- rated files go first, and a dish stops early once it has a 9 or better, so the
-- vision calls go where there is still a choice to make. At most p_per_dish
-- candidates are looked at per dish.
create or replace function public.zz_rate_batch(p_n int default 10, p_per_dish int default 8)
returns text language plpgsql set search_path to 'public' as $$
declare v_c record; v_ans jsonb; v_n int := 0;
begin
  for v_c in
    select c.* from public.zz_cand c
      join public.zz_cover v on v.slug = c.slug
     where c.verdict is null and v.url is null
       and c.credit <> ''
       and (select count(*) from public.zz_cand d
             where d.slug = c.slug and d.verdict is not null) < p_per_dish
       and not exists (select 1 from public.zz_cand d
                        where d.slug = c.slug and d.verdict = 'yes' and d.appeal >= 9)
     order by c.slug, c.quality desc, c.ord limit p_n
  loop
    v_ans := public.zz_verify(v_c.url, (select title from public.zz_cover where slug = v_c.slug));
    v_n := v_n + 1;

    if v_ans ? 'error' then
      continue;                                   -- leave it unrated; retry later
    end if;

    update public.zz_cand
       set verdict = case when (v_ans->>'is_the_dish')::boolean then 'yes' else 'no' end,
           saw = v_ans->>'saw',
           appeal = (v_ans->>'appeal')::int,
           whole = (v_ans->>'whole_dish_visible')::boolean,
           issues = v_ans->>'issues'
     where slug = v_c.slug and ord = v_c.ord;

    update public.zz_cover set checked = checked + 1 where slug = v_c.slug;
  end loop;

  return v_n || ' rated; '
    || (select count(*) from public.zz_cand where verdict is not null) || ' of '
    || (select count(*) from public.zz_cand where credit <> '') || ' creditable candidates rated';
end $$;

-- Picks each dish's best rated photograph: highest appeal, then a reviewer-rated
-- file, then the whole plate in frame, then resolution. Below p_min_appeal the
-- dish gets no cover at all — it is better left for someone to photograph than
-- shipped with a dull picture — and is listed by zz_needs_photo. Safe to re-run
-- after more rating; a changed choice clears the licence so zz_licenses
-- fetches the right one.
create or replace function public.zz_pick_best(p_min_appeal int default 6)
returns text language plpgsql set search_path to 'public' as $$
begin
  update public.zz_cover v
     set url = b.url, credit = b.credit, file_title = b.file_title, appeal = b.appeal,
         license = case when v.url is distinct from b.url then null else v.license end
    from (select distinct on (c.slug) c.*
            from public.zz_cand c
           where c.verdict = 'yes' and c.credit <> '' and c.appeal >= p_min_appeal
           order by c.slug, c.appeal desc, c.quality desc, c.whole desc nulls last,
                    least(c.width, c.height) desc nulls last) b
   where b.slug = v.slug;

  return (select count(*) from public.zz_cover where url is not null) || '/'
    || (select count(*) from public.zz_cover) || ' have a cover; average appeal '
    || coalesce((select round(avg(appeal), 1)::text from public.zz_cover where url is not null), '-');
end $$;

-- Dishes with no photograph good enough: the shot list for a cook-and-shoot day.
create or replace view public.zz_needs_photo as
  select v.slug, v.title,
         max(c.appeal) filter (where c.verdict = 'yes') as best_appeal,
         count(c.*) filter (where c.verdict is not null) as rated
    from public.zz_cover v
    left join public.zz_cand c on c.slug = v.slug
   where v.url is null
   group by v.slug, v.title
   order by best_appeal nulls first, v.title;

-- ---------------------------------------------------------------------------
-- Licences, for the attribution line. Every photograph used carries one, and a
-- file with no recorded author cannot be used under CC BY however good it is.
-- ---------------------------------------------------------------------------
create or replace function public.zz_licenses(p_n int default 12)
returns text language plpgsql set search_path to 'public' as $$
declare v_titles text; v_res record; v_pages jsonb; v_page jsonb; v_n int := 0;
begin
  select string_agg(public.zz_urlencode(q.file_title), '%7C') into v_titles
    from (select c.file_title from public.zz_cover v join public.zz_cand c
            on c.slug = v.slug and c.url = v.url
           where v.license is null limit p_n) q;
  if v_titles is null then return 'all licensed'; end if;

  select * into v_res from extensions.http_get(
    'https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo'
    || '&iiprop=extmetadata&iiextmetadatafilter=LicenseShortName&titles=' || v_titles);
  if v_res.status <> 200 or left(btrim(v_res.content),1) <> '{' then
    return 'http ' || v_res.status;
  end if;

  v_pages := v_res.content::jsonb -> 'query' -> 'pages';
  for v_page in select value from jsonb_each(v_pages) loop
    update public.zz_cover v
       set license = coalesce(
             v_page->'imageinfo'->0->'extmetadata'->'LicenseShortName'->>'value', 'unknown')
      from public.zz_cand c
     where c.slug = v.slug and c.url = v.url
       and c.file_title = (v_page->>'title')
       and v.license is null;
    v_n := v_n + 1;
  end loop;
  return v_n || ' pages; '
    || (select count(*) from public.zz_cover where license is null) || ' left';
end $$;

-- ---------------------------------------------------------------------------
-- Usage
-- ---------------------------------------------------------------------------
-- 1. Queue the dishes. Each creator JSON carries a `photo` object with the
--    query and the must-word for its recipe:
--
--      insert into public.zz_cover(slug, title, query, must) values
--        ('osso-buco-alla-milanese','Osso Buco alla Milanese','osso buco','osso'),
--        ...;
--
-- 2. select public.zz_fetch_candidates(6);   -- repeat until N/N done
-- 3. select public.zz_rate_batch(10);        -- repeat until it rates 0
--    select public.zz_pick_best();           -- best photo per dish, appeal 6+
--    select * from public.zz_needs_photo;    -- dishes left without one
--    Read the saw/issues columns for the picks before going on: the score is
--    advice, and so is the verdict (see the chowder note below).
-- 4. select public.zz_licenses(12);          -- repeat until 'all licensed'
--
-- 5. Load the recipes, merging each cover in by slug rather than editing the
--    JSON, so the seed files stay free of URLs that may rot:
--
--      with src as (select jsonb_array_elements('<creator json>'::jsonb) as r)
--      select public.seed_recipe(src.r || jsonb_build_object('coverUrl', v.url))
--        from src join public.zz_cover v on v.slug = src.r->>'slug';
--
-- 6. Write the credits. seed_recipe does not set attribution:
--
--      update public.recipes r
--         set attribution = 'Photo: ' || v.credit || ' (' || v.license
--                        || '), via Wikimedia Commons'
--        from public.zz_cover v, public.users u
--       where u.id = r.creator_id and u.username in (...) and r.title = v.title;
--
-- A verdict is advice, not a decision. Read what the model says it saw before
-- accepting a rejection: on this catalog it turned down five correct
-- photographs — a chowder whose clams are submerged in the cream cannot be
-- seen, and it refused every genuine one for that reason — while correctly
-- catching four wrong ones.

-- ---------------------------------------------------------------------------
-- Teardown. Run this as soon as the catalog is loaded, and delete the
-- rate-cover Edge Function and its RATE_COVER_SECRET with it.
-- ---------------------------------------------------------------------------
-- drop function if exists public.zz_licenses(int);
-- drop view if exists public.zz_needs_photo;
-- drop function if exists public.zz_pick_best(int);
-- drop function if exists public.zz_rate_batch(int, int);
-- drop function if exists public.zz_fetch_candidates(int);
-- drop function if exists public.zz_verify(text, text);
-- drop function if exists public.zz_candidates(text, text);
-- drop function if exists public.zz_urlencode(text);
-- drop table if exists public.zz_cand;
-- drop table if exists public.zz_cover;
-- drop extension if exists http;
