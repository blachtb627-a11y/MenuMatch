-- Running the ad business from the admin portal (§38, §29).
--
-- content_admin and above. A moderator triages reports; selling placement is a
-- different job. Every write lands in the audit log like any other admin action.

/** Advertisers, newest first, with how many campaigns each has. */
create or replace function public.admin_advertisers()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin('content_admin');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', a.id, 'name', a.name,
             'contactName', a.contact_name, 'contactEmail', a.contact_email,
             'websiteUrl', a.website_url, 'notes', a.notes,
             'campaignCount', (select count(*) from ad_campaigns c
                                where c.advertiser_id = a.id),
             'createdAt', a.created_at)
           order by a.name)
    from advertisers a), '[]'::jsonb);
end;
$$;

create or replace function public.admin_save_advertiser(
  p_id uuid, p_name text, p_contact_name text, p_contact_email text,
  p_website_url text, p_notes text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_id   uuid;
  v_name text := trim(p_name);
begin
  perform public.require_admin('content_admin');
  if coalesce(v_name, '') = '' then raise exception 'a company needs a name'; end if;

  if p_id is null then
    insert into advertisers (name, contact_name, contact_email, website_url, notes)
    values (v_name, nullif(trim(p_contact_name), ''), nullif(trim(p_contact_email), ''),
            nullif(trim(p_website_url), ''), nullif(trim(p_notes), ''))
    returning id into v_id;
  else
    update advertisers
       set name = v_name,
           contact_name = nullif(trim(p_contact_name), ''),
           contact_email = nullif(trim(p_contact_email), ''),
           website_url = nullif(trim(p_website_url), ''),
           notes = nullif(trim(p_notes), ''),
           updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'advertiser not found'; end if;
  end if;

  perform public.write_audit(
    case when p_id is null then 'advertiser_create' else 'advertiser_update' end,
    'advertiser', v_id, jsonb_build_object('name', v_name));
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

/**
 * Deleting an advertiser takes its campaigns and their events with it, so it
 * is refused once anything has run — the delivery record is what an invoice is
 * argued from. Archive the campaigns instead.
 */
create or replace function public.admin_delete_advertiser(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_delivered int;
begin
  perform public.require_admin('content_admin');
  select coalesce(sum(impression_count), 0) into v_delivered
    from ad_campaigns where advertiser_id = p_id;
  if v_delivered > 0 then
    raise exception 'this company has campaigns that have already run; archive them instead';
  end if;

  delete from advertisers where id = p_id;
  if not found then raise exception 'advertiser not found'; end if;
  perform public.write_audit('advertiser_delete', 'advertiser', p_id, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

/** Campaigns with live delivery, ready to render as a list of cards. */
create or replace function public.admin_campaigns(p_advertiser_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin('content_admin');
  return coalesce((
    select jsonb_agg(row order by row->>'createdAt' desc) from (
      select jsonb_build_object(
        'id', c.id,
        'advertiserId', c.advertiser_id,
        'advertiser', a.name,
        'name', c.name,
        'headline', c.headline,
        'body', c.body,
        'imageUrl', c.image_url,
        'ctaLabel', c.cta_label,
        'clickUrl', c.click_url,
        'startsAt', c.starts_at,
        'endsAt', c.ends_at,
        'impressionGoal', c.impression_goal,
        'dailyImpressionCap', c.daily_impression_cap,
        'frequencyCapPerDay', c.frequency_cap_per_day,
        'deckInterval', c.deck_interval,
        'status', c.status,
        'impressions', c.impression_count,
        'clicks', c.click_count,
        'impressionsToday', (select count(*) from ad_events e
                              where e.campaign_id = c.id and e.kind = 'impression'
                                and e.created_at >= date_trunc('day', now())),
        'dailyAllowance', public.ad_daily_allowance(c),
        'createdAt', c.created_at) as row
      from ad_campaigns c
      join advertisers a on a.id = c.advertiser_id
      where p_advertiser_id is null or c.advertiser_id = p_advertiser_id
    ) x), '[]'::jsonb);
end;
$$;

create or replace function public.admin_save_campaign(
  p_id uuid, p_advertiser_id uuid, p_name text,
  p_headline text, p_body text, p_image_url text, p_cta_label text, p_click_url text,
  p_starts_at timestamptz, p_ends_at timestamptz,
  p_impression_goal int, p_daily_impression_cap int,
  p_frequency_cap_per_day int, p_deck_interval int)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_id  uuid;
  v_cta text := coalesce(nullif(trim(p_cta_label), ''), 'Learn more');
begin
  perform public.require_admin('content_admin');

  if coalesce(trim(p_name), '') = '' then raise exception 'the campaign needs a name'; end if;
  if coalesce(trim(p_headline), '') = '' then raise exception 'the ad needs a headline'; end if;
  if coalesce(trim(p_image_url), '') = '' then raise exception 'the ad needs an image'; end if;
  -- A tap has to go somewhere, and only somewhere the operating system will
  -- actually open. Anything but http(s) is a way to reach places a link should
  -- not: file paths, other apps, javascript: on the web build.
  if p_click_url !~* '^https?://[^\s]+$' then
    raise exception 'the link must start with http:// or https://';
  end if;
  if p_ends_at <= p_starts_at then raise exception 'the end date must be after the start'; end if;

  if p_id is null then
    insert into ad_campaigns (
      advertiser_id, name, headline, body, image_url, cta_label, click_url,
      starts_at, ends_at, impression_goal, daily_impression_cap,
      frequency_cap_per_day, deck_interval, created_by)
    values (
      p_advertiser_id, trim(p_name), trim(p_headline), nullif(trim(p_body), ''),
      trim(p_image_url), v_cta, trim(p_click_url),
      p_starts_at, p_ends_at, p_impression_goal, p_daily_impression_cap,
      coalesce(p_frequency_cap_per_day, 3), coalesce(p_deck_interval, 12),
      (select public.current_user_id()))
    returning id into v_id;
  else
    update ad_campaigns
       set advertiser_id = p_advertiser_id,
           name = trim(p_name),
           headline = trim(p_headline),
           body = nullif(trim(p_body), ''),
           image_url = trim(p_image_url),
           cta_label = v_cta,
           click_url = trim(p_click_url),
           starts_at = p_starts_at,
           ends_at = p_ends_at,
           impression_goal = p_impression_goal,
           daily_impression_cap = p_daily_impression_cap,
           frequency_cap_per_day = coalesce(p_frequency_cap_per_day, 3),
           deck_interval = coalesce(p_deck_interval, 12),
           updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'campaign not found'; end if;
  end if;

  perform public.write_audit(
    case when p_id is null then 'campaign_create' else 'campaign_update' end,
    'ad_campaign', v_id, jsonb_build_object('name', trim(p_name)));
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

/**
 * Status changes are their own call, because they are the ones done in a hurry:
 * an advertiser rings up and the ad has to stop now.
 */
create or replace function public.admin_set_campaign_status(p_id uuid, p_status text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_c public.ad_campaigns%rowtype;
begin
  perform public.require_admin('content_admin');
  if p_status not in ('draft','scheduled','active','paused','completed','archived') then
    raise exception 'unknown status %', p_status;
  end if;

  select * into v_c from ad_campaigns where id = p_id;
  if v_c.id is null then raise exception 'campaign not found'; end if;

  -- Going live is the one change worth guarding: an ad with no creative or a
  -- window that has already closed would simply never appear, silently.
  if p_status = 'active' then
    if v_c.ends_at <= now() then
      raise exception 'this campaign''s end date has passed; change the dates first';
    end if;
    if v_c.impression_goal is not null and v_c.impression_count >= v_c.impression_goal then
      raise exception 'this campaign has already delivered its goal; raise the goal first';
    end if;
  end if;

  update ad_campaigns set status = p_status::ad_status, updated_at = now() where id = p_id;
  perform public.write_audit('campaign_status', 'ad_campaign', p_id,
    jsonb_build_object('from', v_c.status, 'to', p_status));
  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

create or replace function public.admin_delete_campaign(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_delivered int;
begin
  perform public.require_admin('content_admin');
  select impression_count into v_delivered from ad_campaigns where id = p_id;
  if v_delivered is null then raise exception 'campaign not found'; end if;
  if v_delivered > 0 then
    raise exception 'this campaign has already run; archive it instead of deleting it';
  end if;

  delete from ad_campaigns where id = p_id;
  perform public.write_audit('campaign_delete', 'ad_campaign', p_id, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

/** Day-by-day delivery for one campaign, for the little chart on its page. */
create or replace function public.admin_campaign_daily(p_id uuid, p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin('content_admin');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'day', d.day, 'impressions', d.impressions, 'clicks', d.clicks)
           order by d.day)
    from (
      select date_trunc('day', e.created_at)::date as day,
             count(*) filter (where e.kind = 'impression') as impressions,
             count(*) filter (where e.kind = 'click') as clicks
        from ad_events e
       where e.campaign_id = p_id
         and e.created_at >= now() - make_interval(days => greatest(least(p_days, 365), 1))
       group by 1
    ) d), '[]'::jsonb);
end;
$$;

grant execute on function public.admin_advertisers()                              to authenticated;
grant execute on function public.admin_save_advertiser(uuid,text,text,text,text,text) to authenticated;
grant execute on function public.admin_delete_advertiser(uuid)                    to authenticated;
grant execute on function public.admin_campaigns(uuid)                            to authenticated;
grant execute on function public.admin_save_campaign(
  uuid,uuid,text,text,text,text,text,text,timestamptz,timestamptz,int,int,int,int) to authenticated;
grant execute on function public.admin_set_campaign_status(uuid,text)             to authenticated;
grant execute on function public.admin_delete_campaign(uuid)                      to authenticated;
grant execute on function public.admin_campaign_daily(uuid,int)                   to authenticated;

-- Storage for ad creative, applied to the live project alongside this file.
-- Advertiser artwork is not user content: it must not fall under the
-- recipe-media policies, which key on the uploader's own folder.
--
--   insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
--   values ('ad-media', 'ad-media', true, 5242880,
--           array['image/jpeg','image/png','image/webp']);
--
--   create policy ad_media_read on storage.objects for select
--     using (bucket_id = 'ad-media');
--   create policy ad_media_insert on storage.objects for insert
--     with check (bucket_id = 'ad-media' and public.is_admin('content_admin'));
--   create policy ad_media_update on storage.objects for update
--     using (bucket_id = 'ad-media' and public.is_admin('content_admin'));
--   create policy ad_media_delete on storage.objects for delete
--     using (bucket_id = 'ad-media' and public.is_admin('content_admin'));
