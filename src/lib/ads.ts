import { supabase } from './supabase';
import { newOpaqueId } from './device';
import type { PickedImage } from './media';

/**
 * Paid placement (§38).
 *
 * The serving side is deliberately tiny — one call to fetch, one to count a
 * view, one to count a tap — because everything that decides whether an ad may
 * run lives in the database. A client that lied about any of it could not
 * change what gets served, only what gets billed, and the impression RPC
 * re-checks the campaign before it counts anything.
 */

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

// ------------------------------------------------------------------ serving

export type ServedAd = {
  id: string;
  headline: string;
  body: string | null;
  imageUrl: string;
  ctaLabel: string;
  clickUrl: string;
  advertiser: string;
  /** One ad every this many recipe cards. */
  deckInterval: number;
};

/** The next eligible ad, or null when nothing should run. */
export const fetchAd = (deviceKey?: string | null) =>
  rpc<ServedAd | null>('get_ad', { p_device_key: deviceKey ?? null });

/**
 * Counts a view — called when the card actually reaches the top of the deck,
 * never when it is fetched. A deck of twenty cards that someone abandons after
 * three did not deliver twenty views, and an advertiser paying per impression
 * is entitled to the difference.
 */
export const recordAdImpression = (campaignId: string, deviceKey?: string | null) =>
  rpc<{ ok: boolean; counted: boolean }>('record_ad_impression', {
    p_campaign_id: campaignId, p_device_key: deviceKey ?? null,
  });

export const recordAdClick = (campaignId: string, deviceKey?: string | null) =>
  rpc<{ ok: boolean }>('record_ad_click', {
    p_campaign_id: campaignId, p_device_key: deviceKey ?? null,
  });

// -------------------------------------------------------------------- admin

export type Advertiser = {
  id: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  websiteUrl: string | null;
  notes: string | null;
  campaignCount: number;
  createdAt: string;
};

export type CampaignStatus =
  | 'draft' | 'scheduled' | 'active' | 'paused' | 'completed' | 'archived';

export type Campaign = {
  id: string;
  advertiserId: string;
  advertiser: string;
  name: string;
  headline: string;
  body: string | null;
  imageUrl: string;
  ctaLabel: string;
  clickUrl: string;
  startsAt: string;
  endsAt: string;
  impressionGoal: number | null;
  dailyImpressionCap: number | null;
  frequencyCapPerDay: number;
  deckInterval: number;
  status: CampaignStatus;
  impressions: number;
  clicks: number;
  impressionsToday: number;
  /** How many more views it may serve today, or null when uncapped. */
  dailyAllowance: number | null;
  createdAt: string;
};

export type CampaignInput = {
  id?: string | null;
  advertiserId: string;
  name: string;
  headline: string;
  body?: string | null;
  imageUrl: string;
  ctaLabel: string;
  clickUrl: string;
  startsAt: string;
  endsAt: string;
  impressionGoal?: number | null;
  dailyImpressionCap?: number | null;
  frequencyCapPerDay: number;
  deckInterval: number;
};

export const adminAdvertisers = () => rpc<Advertiser[]>('admin_advertisers');

export const adminSaveAdvertiser = (a: {
  id?: string | null; name: string; contactName?: string; contactEmail?: string;
  websiteUrl?: string; notes?: string;
}) => rpc<{ ok: boolean; id: string }>('admin_save_advertiser', {
  p_id: a.id ?? null, p_name: a.name,
  p_contact_name: a.contactName ?? null, p_contact_email: a.contactEmail ?? null,
  p_website_url: a.websiteUrl ?? null, p_notes: a.notes ?? null,
});

export const adminDeleteAdvertiser = (id: string) =>
  rpc<{ ok: boolean }>('admin_delete_advertiser', { p_id: id });

export const adminCampaigns = (advertiserId?: string | null) =>
  rpc<Campaign[]>('admin_campaigns', { p_advertiser_id: advertiserId ?? null });

export const adminSaveCampaign = (c: CampaignInput) =>
  rpc<{ ok: boolean; id: string }>('admin_save_campaign', {
    p_id: c.id ?? null,
    p_advertiser_id: c.advertiserId,
    p_name: c.name,
    p_headline: c.headline,
    p_body: c.body ?? null,
    p_image_url: c.imageUrl,
    p_cta_label: c.ctaLabel,
    p_click_url: c.clickUrl,
    p_starts_at: c.startsAt,
    p_ends_at: c.endsAt,
    p_impression_goal: c.impressionGoal ?? null,
    p_daily_impression_cap: c.dailyImpressionCap ?? null,
    p_frequency_cap_per_day: c.frequencyCapPerDay,
    p_deck_interval: c.deckInterval,
  });

export const adminSetCampaignStatus = (id: string, status: CampaignStatus) =>
  rpc<{ ok: boolean; status: CampaignStatus }>('admin_set_campaign_status', {
    p_id: id, p_status: status,
  });

export const adminDeleteCampaign = (id: string) =>
  rpc<{ ok: boolean }>('admin_delete_campaign', { p_id: id });

export const adminCampaignDaily = (id: string, days = 30) =>
  rpc<{ day: string; impressions: number; clicks: number }[]>(
    'admin_campaign_daily', { p_id: id, p_days: days });

// ------------------------------------------------------------------ uploads

const AD_BUCKET = 'ad-media';

/**
 * Ad creative lives in its own bucket, not recipe-media. That bucket's policies
 * key on the uploader's own folder because the photos in it belong to the
 * person who took them; an advertiser's artwork belongs to the advertiser, and
 * only a content admin may put it there or take it down.
 */
export async function uploadAdImage(image: PickedImage): Promise<string> {
  const extension = image.mimeType.includes('png') ? 'png'
    : image.mimeType.includes('webp') ? 'webp' : 'jpg';
  const path = `creative/${newOpaqueId()}.${extension}`;

  const blob = await (await fetch(image.uri)).blob();
  if (blob.size > 5 * 1024 * 1024) {
    throw new Error('That image is over 5MB. Try a smaller one.');
  }

  const { error } = await supabase.storage.from(AD_BUCKET).upload(path, blob, {
    contentType: image.mimeType, upsert: false,
  });
  if (error) throw new Error(error.message);
  return supabase.storage.from(AD_BUCKET).getPublicUrl(path).data.publicUrl;
}

// ------------------------------------------------------------------ display

export const STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  active: 'Running',
  paused: 'Paused',
  completed: 'Finished',
  archived: 'Archived',
};

/**
 * Why a campaign is or is not being seen right now, in one line.
 *
 * A status alone does not answer the question that actually gets asked — "is
 * my ad running?" — because a campaign can be Running and still deliver
 * nothing today, having already hit its pace.
 */
export function describeDelivery(c: Campaign, now = new Date()): string {
  const starts = new Date(c.startsAt);
  const ends = new Date(c.endsAt);

  if (c.status === 'completed') return `Delivered ${c.impressions.toLocaleString()} views`;
  if (c.status === 'archived') return 'Archived';
  if (c.status === 'paused') return 'Paused — not being shown';
  if (c.status === 'draft') return 'Not scheduled yet';
  if (c.status === 'scheduled') return `Starts ${formatWhen(starts)}`;

  // Running, so say what is actually happening today.
  if (now < starts) return `Starts ${formatWhen(starts)}`;
  if (now > ends) return `Ended ${formatWhen(ends)} — no longer showing`;

  const left = daysBetween(now, ends);
  const window = left === 0 ? 'ends today' : left === 1 ? '1 day left' : `${left} days left`;

  if (c.dailyAllowance == null) return `Showing · ${window}`;
  if (c.impressionsToday >= c.dailyAllowance) {
    return `Today's ${c.dailyAllowance.toLocaleString()} views delivered · ${window}`;
  }
  return `${c.impressionsToday.toLocaleString()} of ${c.dailyAllowance.toLocaleString()} today · ${window}`;
}

/** How far through its total goal a campaign is, 0–1, or null when open-ended. */
export function goalProgress(c: Campaign): number | null {
  if (!c.impressionGoal) return null;
  return Math.min(c.impressions / c.impressionGoal, 1);
}

export function clickRate(c: Campaign): string {
  if (!c.impressions) return '—';
  return `${((c.clicks / c.impressions) * 100).toFixed(1)}%`;
}

function daysBetween(from: Date, to: Date): number {
  const ms = to.setHours(0, 0, 0, 0) - new Date(from).setHours(0, 0, 0, 0);
  return Math.max(Math.round(ms / 86400000), 0);
}

function formatWhen(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
