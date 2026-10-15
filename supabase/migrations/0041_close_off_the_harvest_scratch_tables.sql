-- The two scratch tables left over from the Commons image harvest were
-- readable by anyone holding the publishable key.
--
-- They live in `public`, so PostgREST exposes them, and neither had RLS on.
-- Nothing in them is personal — file names, categories and licence metadata
-- scraped from Wikimedia Commons — which is why this was the only finding of
-- its kind rather than an incident. But "nothing sensitive today" is not a
-- property that survives someone adding a column, and an anonymous reader
-- could enumerate both tables in full.
--
-- Enabled rather than dropped. The harvest is paused, not abandoned on
-- purpose: 639 candidate files with their metadata is the expensive part of
-- that job, and throwing it away to silence a linter would mean doing it
-- again. RLS with no policy denies every request from `anon` and
-- `authenticated` outright, while the table owner still reaches them, so the
-- data stays available to resume from and unavailable to everyone else.
alter table public.zz_cat  enable row level security;
alter table public.zz_file enable row level security;

-- Belt and braces: RLS governs row visibility, but a stray GRANT would still
-- let the API see the table exists and count its rows.
revoke all on public.zz_cat  from anon, authenticated;
revoke all on public.zz_file from anon, authenticated;
