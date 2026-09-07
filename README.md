# MenuMatch

Swipe-first recipe discovery. Built to the v2.0 product specification.

**Live: https://menumatch.store**

An Expo (React Native) client on a Supabase Postgres backend. This build covers
the discovery loop end to end — **discover, save, cook** — plus the trust and
safety controls the spec treats as day-one requirements rather than post-launch
work.

---

## What runs today

**Backend** — live on Supabase project `rtgbwglwufceubapwsnc`.

| Area | State |
|---|---|
| Schema (§22) | 35 tables. Structured ingredient and step rows, fraction quantities, monthly-partitioned `swipes`, moderation, appeals, copyright complaints, audit log |
| Row level security (§23.2) | On every table. Blocked users and unpublished content filtered in the query, not after retrieval |
| Feed ranking (§21) | `get_feed()` — weighted scoring from tunable config, mandatory diversity pass, reserved exploration slots, fallback ladder |
| API (§23.1) | RPCs for feed, config, recipe, batched swipes, save/unsave, cooks, undo, guest merge, negative signals |
| Catalog | 32 recipes, 8 labelled seed creators, 43 tags, 74 canonical ingredients |

**Client** — Expo Router, TypeScript, Reanimated.

Onboarding with guest mode · Discover deck · recipe detail with serving scaling ·
Cook Mode with timers · Cookbook and collections · search · report flow ·
profile and settings.

## Not built yet

- **The composer (§15).** The largest remaining MVP surface. Schema and RLS are
  in place; the UI is not. It needs real depth of its own: drag reordering,
  paste-a-list parsing, and autosave every 10 seconds and on every field blur.
- **Admin dashboard (§29).** Tables, roles, and the audit log exist; there is no
  UI over them, so moderation currently means SQL.
- **Sharing and web landing pages (§31), notifications (§25), follow graph UI.**

## The three things that gate a launch, none of them code

1. **Photography.** The card is 80% image and there are no photographs yet. Seed
   covers point at `cdn.menumatch.app` paths that do not resolve, and the client
   falls back to a deterministic branded gradient so nothing looks broken. This
   is the §5 content problem, and it decides the launch date more than any
   remaining engineering task.
2. **Catalog depth.** 32 recipes is a development seed. The §5.1 gate is 400
   moderated recipes with 50 per launch category.
3. **Legal documents (§39).** Counsel writes them; the technical controls they
   require are already built. Do not ship placeholder text — both stores check.

---

## The website

The Expo web build is published to GitHub Pages by `.github/workflows/deploy-web.yml`
on every push to the default branch. It typechecks and runs the tests before it
publishes, so a broken commit does not reach the site.

Two things an Expo app on Pages needs, both easy to lose in a rewrite:
`.nojekyll`, because Jekyll drops the `_expo/` directory Expo emits; and
`404.html` as a copy of the SPA shell, because Pages serves it on a miss, which
is what lets a shared recipe link resolve client-side.

The site is served from `menumatch.store`, set by the `CNAME` file at the repo
root. The workflow reads that file, switches the build from the `/MenuMatch`
subpath to the site root, and copies it into the published output so the domain
survives every deploy. Removing the file reverts to the github.io subpath.

## Running it

```bash
npm install
cp .env.example .env      # already points at the live project
npx expo start            # press i, a, or w
```

The publishable key in `.env` is designed to ship in a client bundle. Row level
security, not key secrecy, protects the data. The service role key must never
go in this file.

### Working without network access

`tools/devserver` replays real payloads captured from the live database at the
same RPC paths, so the client can be developed and driven offline:

```bash
node tools/devserver/server.mjs
# then point EXPO_PUBLIC_SUPABASE_URL at http://localhost:8787
```

### Checks

```bash
npm run typecheck   # tsc, clean
npm test            # serving-scale and timer-parsing unit tests
```

---

## Notes on the design

**Serving scaling** multiplies exact fractions rather than floats, so `1/3 cup`
doubles to `2/3` and halves to `1/6`, never `0.3333`. Imprecise units (`pinch`,
`to taste`) never show a scaled value. Metric measures render as numbers.

**Timers** are parsed from step text once, server-side at publish, so Cook Mode
reads a stored value. `parse_timer_seconds` ignores the oven temperature and
takes the upper bound of a range: "Roast for 20-25 minutes" gives 25:00.

**Gated categories never widen.** The §8.3 fallback ladder may take a Dessert
deck out to popular-overall — labelled by the response's `fallback` field — but
crossing a dietary or nutrition gate would put meat under Vegetarian. Those
categories run short and report `category_exhausted` instead.

**On original identity (§18.3).** Gesture discovery is a functional concept; the
trade dress is not. Drag feedback here is a colour wash plus a growing edge
indicator, with no stamp overlay and no rotation-and-fling. The pass control is
a warm clay, not a red X. There is no match moment. Terminology follows the §3
lexicon throughout code, UI, and analytics: Deck, Card, Save, Pass, Cookbook,
Collection, Creator, Cook Mode, Cooked it.

**Three security fixes worth remembering**, because they are easy to
reintroduce:

- Enabling RLS on a partitioned parent does *not* enable it on the partitions.
  Each `swipes_YYYY_MM` is its own table in the public schema and PostgREST
  exposes it. `ensure_swipe_partition` now locks down every partition it makes.
- Postgres grants `EXECUTE` on new functions to `PUBLIC`. That made the
  `SECURITY DEFINER` seed loader callable with the anon key. Execute is now
  revoked wholesale and granted back only to the intended API surface.
- That revoke does not stick on its own: every function added *after* it got
  the `PUBLIC` default straight back, so the composer, collection and admin
  RPCs were all anon-callable again. Most refused on their own role checks, but
  `write_audit` did not — an anon caller could have forged audit rows. `0015`
  re-states the whole grant list and pins the default privilege to the owning
  role. **When you add a function, add its grant to that list.**

---

## Layout

```
app/            expo-router screens
  (tabs)/       Discover, Search, Create, Cookbook, Profile
  recipe/[id]   detail with the serving scaler
  cook/[id]     Cook Mode
  report/[id]   §20.6 in-app reporting
  compose/[id]  §15 composer, with AI recipe scan
  collection/   §12 collection detail and management
  admin/        §20.3 report queue, appeals, accounts, team, audit log
src/
  lib/          supabase client, API, offline queue, quantity + timer logic
  state/        session (guest, pending save) and deck controller
  components/   card, cover, sheets, primitives
  theme/        colours, spacing, type
supabase/
  migrations/   schema, RLS, feed ranking, API, hardening
  seed/         catalog as JSON
tools/devserver offline stand-in for the RPC surface
tests/          unit tests
```
