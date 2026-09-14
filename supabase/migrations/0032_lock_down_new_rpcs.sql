-- Postgres grants EXECUTE on a new function to PUBLIC by default, so 0029 and
-- 0031 left every ad-admin and pantry verb callable by an anonymous client.
-- Each one refuses anon on its own (require_admin, or an explicit null check),
-- so nothing leaked — but that made one internal guard the only thing standing
-- between a signed-out caller and an admin write, which is not the standard the
-- rest of the project holds: 0014 revokes explicitly. Matching it here.
--
-- get_ad, record_ad_impression and record_ad_click stay open to anon on
-- purpose: guests see ads, and the impressions they generate are real.

revoke execute on function public.admin_advertisers()                              from public, anon;
revoke execute on function public.admin_save_advertiser(uuid,text,text,text,text,text) from public, anon;
revoke execute on function public.admin_delete_advertiser(uuid)                    from public, anon;
revoke execute on function public.admin_campaigns(uuid)                            from public, anon;
revoke execute on function public.admin_save_campaign(
  uuid,uuid,text,text,text,text,text,text,timestamptz,timestamptz,int,int,int,int) from public, anon;
revoke execute on function public.admin_set_campaign_status(uuid,text)             from public, anon;
revoke execute on function public.admin_delete_campaign(uuid)                      from public, anon;
revoke execute on function public.admin_campaign_daily(uuid,int)                   from public, anon;
revoke execute on function public.admin_moderate_recipe(uuid,text,text,text)       from public, anon;

revoke execute on function public.my_pantry()                        from public, anon;
revoke execute on function public.add_pantry_items(text[])           from public, anon;
revoke execute on function public.remove_pantry_item(uuid)           from public, anon;
revoke execute on function public.clear_pantry()                     from public, anon;
revoke execute on function public.cook_from_pantry(int,int,boolean)  from public, anon;
revoke execute on function public.pantry_staples()                   from public, anon;
revoke execute on function public.ad_daily_allowance(public.ad_campaigns) from public, anon;

-- The grants the app actually needs, restated so the end state is explicit.
grant execute on function public.admin_advertisers()                              to authenticated;
grant execute on function public.admin_save_advertiser(uuid,text,text,text,text,text) to authenticated;
grant execute on function public.admin_delete_advertiser(uuid)                    to authenticated;
grant execute on function public.admin_campaigns(uuid)                            to authenticated;
grant execute on function public.admin_save_campaign(
  uuid,uuid,text,text,text,text,text,text,timestamptz,timestamptz,int,int,int,int) to authenticated;
grant execute on function public.admin_set_campaign_status(uuid,text)             to authenticated;
grant execute on function public.admin_delete_campaign(uuid)                      to authenticated;
grant execute on function public.admin_campaign_daily(uuid,int)                   to authenticated;
grant execute on function public.admin_moderate_recipe(uuid,text,text,text)       to authenticated;

grant execute on function public.my_pantry()                        to authenticated;
grant execute on function public.add_pantry_items(text[])           to authenticated;
grant execute on function public.remove_pantry_item(uuid)           to authenticated;
grant execute on function public.clear_pantry()                     to authenticated;
grant execute on function public.cook_from_pantry(int,int,boolean)  to authenticated;
grant execute on function public.pantry_staples()                   to authenticated;

-- These back a stored generated column and a GIN index, so they run on every
-- insert with the writing session's search_path. Everything inside is already
-- schema-qualified; pinning the path closes the operator-hijack route.
alter function public.food_stopwords()       set search_path = '';
alter function public.food_singular(text)    set search_path = '';
alter function public.food_tokens(text)      set search_path = '';
alter function public.food_blocking_stems()  set search_path = '';

-- Also applied here: the two foreign keys the ad feature filters and cascades
-- on had no covering index.
create index if not exists ad_campaigns_advertiser on public.ad_campaigns (advertiser_id);
create index if not exists ad_events_user          on public.ad_events (user_id);
