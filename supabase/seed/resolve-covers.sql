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
-- Layer 3 needs an Edge Function, because the Anthropic key must never leave
-- Edge Function secrets. See `supabase/functions/verify-cover/` in the history
-- of this file's accompanying commit; it is deployed for the load and deleted
-- immediately after, since it runs with verify_jwt disabled.

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
create or replace function public.zz_candidates(p_query text, p_must text)
returns table(file_title text, url text, credit text)
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

  v_titles := v_titles[1:8];
  select string_agg(public.zz_urlencode(t), '%7C') into v_joined from unnest(v_titles) t;

  for v_try in 1..3 loop
    begin
      select status, content into v_res from extensions.http_get(
        'https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo'
        || '&iiprop=url%7Cextmetadata&iiurlwidth=1200&titles=' || v_joined);
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
             coalesce(p.value#>>'{imageinfo,0,extmetadata,Artist,value}',''), '<[^>]*>','','g'))
      from jsonb_each(v_info#>'{query,pages}') p
     where p.value#>>'{imageinfo,0,thumburl}' is not null
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

-- ---------------------------------------------------------------------------
-- Filter 3: ask the vision model what is actually in the photograph.
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
    '<PROJECT_URL>/functions/v1/verify-cover',
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
-- zz_verify_batch until every dish has a cover. Both are restartable: they pick
-- up whatever is still unfinished, so a rate-limited call costs one batch and
-- not the run.
-- ---------------------------------------------------------------------------
create or replace function public.zz_fetch_candidates(p_n int default 6)
returns text language plpgsql set search_path to 'public' as $$
declare v_row record; v_i int; v_n int := 0;
begin
  for v_row in select * from public.zz_cover where not cand_done order by slug limit p_n loop
    v_i := 0;
    for v_i in
      (select row_number() over () from public.zz_candidates(v_row.query, v_row.must))
    loop null; end loop;
    insert into public.zz_cand (slug, ord, file_title, url, credit)
    select v_row.slug, row_number() over (), c.file_title, c.url, c.credit
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

create or replace function public.zz_verify_batch(p_n int default 10)
returns text language plpgsql set search_path to 'public' as $$
declare v_c record; v_ans jsonb; v_n int := 0;
begin
  for v_c in
    select c.* from public.zz_cand c
      join public.zz_cover v on v.slug = c.slug
     where c.verdict is null and v.url is null
     order by c.slug, c.ord limit p_n
  loop
    -- Stop as soon as this dish has an answer; without the in-loop guard every
    -- remaining candidate is still checked, at a vision call each.
    if exists (select 1 from public.zz_cand d
                where d.slug = v_c.slug and d.verdict = 'yes') then
      continue;
    end if;

    v_ans := public.zz_verify(v_c.url, (select title from public.zz_cover where slug = v_c.slug));
    v_n := v_n + 1;

    if v_ans ? 'error' then
      continue;                                   -- leave it untried; retry later
    end if;

    update public.zz_cand
       set verdict = case when (v_ans->>'is_the_dish')::boolean then 'yes' else 'no' end,
           saw = v_ans->>'saw'
     where slug = v_c.slug and ord = v_c.ord;

    if (v_ans->>'is_the_dish')::boolean then
      update public.zz_cover
         set url = v_c.url, credit = v_c.credit, file_title = v_c.file_title
       where slug = v_c.slug;
    end if;

    update public.zz_cover set checked = checked + 1 where slug = v_c.slug;
  end loop;

  return v_n || ' checked; '
    || (select count(*) from public.zz_cover where url is not null) || '/'
    || (select count(*) from public.zz_cover) || ' covered; '
    || (select count(distinct c.slug) from public.zz_cand c
          join public.zz_cover v on v.slug = c.slug
         where c.verdict is null and v.url is null) || ' still have untried candidates';
end $$;

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
-- 2. select public.zz_fetch_candidates(6);   -- repeat until 60/60 done
-- 3. select public.zz_verify_batch(10);      -- repeat until 60/60 covered
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
-- verify-cover Edge Function with it.
-- ---------------------------------------------------------------------------
-- drop function if exists public.zz_licenses(int);
-- drop function if exists public.zz_verify_batch(int);
-- drop function if exists public.zz_fetch_candidates(int);
-- drop function if exists public.zz_verify(text, text);
-- drop function if exists public.zz_candidates(text, text);
-- drop function if exists public.zz_urlencode(text);
-- drop table if exists public.zz_cand;
-- drop table if exists public.zz_cover;
-- drop extension if exists http;
