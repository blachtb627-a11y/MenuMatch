-- Security hardening.
--
-- Two real holes closed here:
--
-- 1. Enabling RLS on a partitioned parent does not enable it on the partitions.
--    Policies on `swipes` apply to reads through the parent, but every partition
--    is its own table in the public schema and PostgREST exposes it, so
--    `swipes_2026_09` was directly readable. RLS on each partition with no
--    policy denies direct access while parent-routed queries keep working.
--
-- 2. Postgres grants EXECUTE on new functions to PUBLIC by default, which made
--    every helper callable with the anon key, including the SECURITY DEFINER
--    seed loader. Revoke the lot, then grant back only the API surface.

-- ---------------------------------------------------------------- partitions

do $$
declare p record;
begin
  for p in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_inherits i on i.inhrelid = c.oid
    where n.nspname = 'public' and i.inhparent = 'public.swipes'::regclass
  loop
    execute format('alter table public.%I enable row level security', p.relname);
    execute format('revoke all on public.%I from anon, authenticated', p.relname);
  end loop;
end;
$$;

-- Future partitions must be created locked down too.
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
    -- a partition is its own table: it needs its own lockdown
    execute format('alter table public.%I enable row level security', part);
    execute format('revoke all on public.%I from anon, authenticated', part);
  end if;
end;
$$;

-- ---------------------------------------------------------------- functions

revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public;

-- Read surface, available to guests (§7 guest mode).
grant execute on function public.get_feed(text,int,text,uuid[])        to anon, authenticated;
grant execute on function public.get_config()                          to anon, authenticated;
grant execute on function public.get_recipe(uuid)                      to anon, authenticated;
grant execute on function public.register_device(text,text,text)       to anon, authenticated;
grant execute on function public.record_swipes(jsonb,text)             to anon, authenticated;
grant execute on function public.undo_swipe(uuid,text)                 to anon, authenticated;

-- Account-only actions (§7 hard gate).
grant execute on function public.me()                                  to authenticated;
grant execute on function public.save_recipe(uuid,text,text)           to authenticated;
grant execute on function public.unsave_recipe(uuid)                   to authenticated;
grant execute on function public.record_cook(uuid,text,text)           to authenticated;
grant execute on function public.claim_guest_history(text)             to authenticated;
grant execute on function public.less_like_this(text,text)             to authenticated;

-- Called from inside RLS policy expressions and a generated column, so they are
-- evaluated as the querying role and need EXECUTE. They leak nothing on their
-- own: each answers a question about the caller.
grant execute on function public.current_user_id()                     to anon, authenticated;
grant execute on function public.is_blocked_with(uuid)                 to anon, authenticated;
grant execute on function public.recipe_visible(uuid)                  to anon, authenticated;
grant execute on function public.is_admin(text)                        to authenticated;
grant execute on function public.report_priority(report_reason)        to authenticated;

-- Everything else (seed_recipe, seed_recipes, ensure_swipe_partition, the
-- trigger functions) stays owner-only and is reachable through service_role.

-- ---------------------------------------------------------------- search_path

alter function public.unit_is_imprecise(measurement_unit) set search_path = public;
alter function public.set_updated_at() set search_path = public;
alter function public.report_priority(report_reason) set search_path = public;
alter function public.parse_timer_seconds(text) set search_path = public;
