import React, { useCallback, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Button, Loading, Screen } from '@/components/ui';
import { AdminHeader, Field } from '@/components/admin/Shared';
import { Toast } from '@/components/Toast';
import { pickImage } from '@/lib/media';
import {
  STATUS_LABELS, adminAdvertisers, adminCampaignDaily, adminCampaigns,
  adminSaveCampaign, adminSetCampaignStatus, clickRate, describeDelivery,
  uploadAdImage, type Advertiser, type Campaign,
} from '@/lib/ads';
import { useSession } from '@/state/session';
import { colors, fill, radius, space, type } from '@/theme';

/**
 * Build one ad and decide how hard it runs.
 *
 * The two things being set are the two the money is priced on: how long it
 * runs, and how many views it should get. Everything else on this screen is
 * the creative or a guard rail. The live preview is the actual card component
 * would be too heavy to mount here, so it is a faithful copy of its layout —
 * what matters is that nobody ships a headline that turns out to be four lines
 * long on a phone.
 */
export default function CampaignEditor() {
  const { id, advertiser: presetAdvertiser } =
    useLocalSearchParams<{ id: string; advertiser?: string }>();
  const isNew = id === 'new';
  const { me, ready } = useSession();

  const [advertisers, setAdvertisers] = useState<Advertiser[] | null>(null);
  const [existing, setExisting] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [daily, setDaily] = useState<{ day: string; impressions: number; clicks: number }[]>([]);

  // form
  const [advertiserId, setAdvertiserId] = useState(presetAdvertiser ?? '');
  const [name, setName] = useState('');
  const [headline, setHeadline] = useState('');
  const [body, setBody] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [ctaLabel, setCtaLabel] = useState('Learn more');
  const [clickUrl, setClickUrl] = useState('');
  const [startsAt, setStartsAt] = useState(todayISO());
  // 29 days ahead, not 30: the window is inclusive of both ends, so this is
  // the default that actually reads "30 days" and paces a round goal evenly.
  const [endsAt, setEndsAt] = useState(inDaysISO(29));
  const [goal, setGoal] = useState('');
  const [dailyCap, setDailyCap] = useState('');
  const [frequency, setFrequency] = useState('3');
  const [interval, setIntervalCards] = useState('12');

  const load = useCallback(async () => {
    try {
      const list = await adminAdvertisers();
      setAdvertisers(list);
      if (!isNew) {
        const all = await adminCampaigns();
        const found = all.find((c) => c.id === id) ?? null;
        if (found) {
          setExisting(found);
          setAdvertiserId(found.advertiserId);
          setName(found.name);
          setHeadline(found.headline);
          setBody(found.body ?? '');
          setImageUrl(found.imageUrl);
          setCtaLabel(found.ctaLabel);
          setClickUrl(found.clickUrl);
          setStartsAt(found.startsAt.slice(0, 10));
          setEndsAt(found.endsAt.slice(0, 10));
          setGoal(found.impressionGoal ? String(found.impressionGoal) : '');
          setDailyCap(found.dailyImpressionCap ? String(found.dailyImpressionCap) : '');
          setFrequency(String(found.frequencyCapPerDay));
          setIntervalCards(String(found.deckInterval));
          setDaily(await adminCampaignDaily(found.id));
        } else {
          setError('That campaign no longer exists.');
        }
      } else if (!presetAdvertiser && list.length === 1) {
        setAdvertiserId(list[0]!.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this campaign');
    } finally {
      setLoading(false);
    }
  }, [id, isNew, presetAdvertiser]);

  useEffect(() => { void load(); }, [load]);

  async function attachImage() {
    try {
      const picked = await pickImage('library');
      if (!picked) return;
      setBusy(true);
      setImageUrl(await uploadAdImage(picked));
      setToast('Image uploaded');
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not upload that image');
    } finally {
      setBusy(false);
    }
  }

  async function save(thenGoLive: boolean) {
    setError(null);
    if (!advertiserId) { setError('Pick the company this ad is for.'); return; }
    if (!name.trim()) { setError('Give the campaign a name so you can find it later.'); return; }
    if (!headline.trim()) { setError('The ad needs a headline.'); return; }
    if (!imageUrl) { setError('The ad needs an image.'); return; }
    if (!/^https?:\/\/\S+$/i.test(clickUrl.trim())) {
      setError('The link must start with http:// or https://');
      return;
    }
    // Dates are typed, so they are checked here rather than only being
    // bounced back by the database with a less helpful message.
    const from = new Date(`${startsAt}T00:00:00`);
    const to = new Date(`${endsAt}T23:59:59`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      setError('Use dates in the form YYYY-MM-DD.');
      return;
    }
    if (to <= from) { setError('The end date has to be after the start date.'); return; }

    setBusy(true);
    try {
      const { id: savedId } = await adminSaveCampaign({
        id: isNew ? null : id,
        advertiserId,
        name: name.trim(),
        headline: headline.trim(),
        body: body.trim() || null,
        imageUrl,
        ctaLabel: ctaLabel.trim() || 'Learn more',
        clickUrl: clickUrl.trim(),
        startsAt: from.toISOString(),
        endsAt: to.toISOString(),
        impressionGoal: numberOrNull(goal),
        dailyImpressionCap: numberOrNull(dailyCap),
        frequencyCapPerDay: Number(frequency) || 3,
        deckInterval: Number(interval) || 12,
      });
      if (thenGoLive) await adminSetCampaignStatus(savedId, 'active');
      router.replace('/admin/ads');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that');
      setBusy(false);
    }
  }

  if (ready && me && me.adminRole !== 'content_admin' && me.adminRole !== 'super_admin') {
    return <Redirect href="/admin" />;
  }
  if (loading) return <Screen><Loading label="Loading" /></Screen>;

  const days = Math.max(
    Math.round((new Date(`${endsAt}T23:59:59`).getTime()
      - new Date(`${startsAt}T00:00:00`).getTime()) / 86400000), 1);
  const perDay = numberOrNull(goal) ? Math.ceil(numberOrNull(goal)! / days) : null;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <AdminHeader
          title={isNew ? 'New campaign' : 'Campaign'}
          back
          subtitle={existing ? STATUS_LABELS[existing.status] : 'Not scheduled yet'}
        />

        <KeyboardAvoidingView style={{ flex: 1 }}
                              behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
            {existing ? (
              <View style={s.live}>
                <Text style={s.liveLabel}>{describeDelivery(existing)}</Text>
                <View style={s.liveMetrics}>
                  <Metric label="VIEWS" value={existing.impressions.toLocaleString()} />
                  <Metric label="CLICKS" value={existing.clicks.toLocaleString()} />
                  <Metric label="CLICK RATE" value={clickRate(existing)} />
                </View>
                {daily.length ? <Sparkline data={daily} /> : null}
              </View>
            ) : null}

            <Section title="Company">
              {(advertisers ?? []).length === 0 ? (
                <View style={{ gap: space.md }}>
                  <Text style={s.hint}>
                    No companies yet. Add the company that is paying first.
                  </Text>
                  <Button label="Add a company" variant="secondary"
                          onPress={() => router.push('/admin/advertisers')} />
                </View>
              ) : (
                <View style={s.chipWrap}>
                  {(advertisers ?? []).map((a) => (
                    <Pressable key={a.id} onPress={() => setAdvertiserId(a.id)}
                               accessibilityRole="radio"
                               accessibilityState={{ selected: advertiserId === a.id }}
                               style={[s.chip, advertiserId === a.id && s.chipOn]}>
                      <Text style={[s.chipLabel, advertiserId === a.id && s.chipLabelOn]}>
                        {a.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </Section>

            <Section title="The ad">
              <Field label="Campaign name (only you see this)" value={name} onChange={setName}
                     placeholder="Bertoni — autumn launch" />

              <Pressable onPress={() => void attachImage()} disabled={busy}
                         accessibilityRole="button" accessibilityLabel="Choose the ad image"
                         style={({ pressed }) => [s.imagePick, pressed && { opacity: 0.7 }]}>
                {imageUrl ? (
                  <Image source={{ uri: imageUrl }} style={s.imagePreview} contentFit="cover"
                         accessibilityIgnoresInvertColors />
                ) : (
                  <View style={s.imageEmpty}>
                    <Feather name="image" size={22} color={colors.textFaint} />
                    <Text style={s.hint}>Tap to choose the ad image</Text>
                  </View>
                )}
              </Pressable>

              <Field label="Headline" value={headline} onChange={setHeadline}
                     placeholder="Fresh pasta, delivered"
                     hint={`${headline.length}/80 — keep it to a line or two on a phone.`} />
              <Field label="Body (optional)" value={body} onChange={setBody} multiline
                     placeholder="Same-day from local mills."
                     hint={`${body.length}/200`} />
              <Field label="Button text" value={ctaLabel} onChange={setCtaLabel}
                     placeholder="Order now" />
              <Field label="Where the button goes" value={clickUrl} onChange={setClickUrl}
                     placeholder="https://bertoni.example/offer" keyboardType="url"
                     hint="Must start with http:// or https://" />
            </Section>

            <Section title="How long it runs">
              <View style={s.pair}>
                <View style={{ flex: 1 }}>
                  <Field label="Starts" value={startsAt} onChange={setStartsAt}
                         placeholder="YYYY-MM-DD" />
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="Ends" value={endsAt} onChange={setEndsAt}
                         placeholder="YYYY-MM-DD" />
                </View>
              </View>
              <Text style={s.hint}>{days} day{days === 1 ? '' : 's'}</Text>
            </Section>

            <Section title="How many views">
              <Field label="Total views to deliver" value={goal} onChange={setGoal}
                     keyboardType="number-pad" placeholder="Leave empty for no limit"
                     hint={perDay
                       ? `About ${perDay.toLocaleString()} a day, spread evenly. It stops itself when the goal is met.`
                       : 'With no goal it keeps running until the end date.'} />
              <Field label="Daily limit (optional)" value={dailyCap} onChange={setDailyCap}
                     keyboardType="number-pad" placeholder="Overrides the even spread"
                     hint="Use this when the advertiser wants a hard cap per day." />
              <View style={s.pair}>
                <View style={{ flex: 1 }}>
                  <Field label="Times per person per day" value={frequency}
                         onChange={setFrequency} keyboardType="number-pad" />
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="Show every N cards" value={interval}
                         onChange={setIntervalCards} keyboardType="number-pad" />
                </View>
              </View>
              <Text style={s.hint}>
                One person sees it at most {frequency || 3} times a day, and never more often
                than one card in {interval || 12}.
              </Text>
            </Section>

            <Section title="How it will look">
              <Preview headline={headline} body={body} imageUrl={imageUrl}
                       ctaLabel={ctaLabel}
                       advertiser={advertisers?.find((a) => a.id === advertiserId)?.name ?? 'Company'} />
            </Section>

            {error ? <Text style={s.error}>{error}</Text> : null}

            <View style={{ gap: space.md }}>
              <Button label={busy ? 'Saving…' : 'Save'} onPress={() => void save(false)}
                      disabled={busy} />
              {existing?.status !== 'active' ? (
                <Button label="Save and start running" variant="secondary"
                        onPress={() => void save(true)} disabled={busy} />
              ) : null}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </Screen>
  );
}

/** The deck card's layout, at a size that fits on this page. */
function Preview({
  headline, body, imageUrl, ctaLabel, advertiser,
}: {
  headline: string; body: string; imageUrl: string; ctaLabel: string; advertiser: string;
}) {
  return (
    <View style={s.preview}>
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover"
               accessibilityIgnoresInvertColors />
      ) : null}
      <View style={s.previewScrim} />
      <View style={s.previewSponsored}>
        <Text style={s.previewSponsoredLabel}>SPONSORED</Text>
      </View>
      <View style={s.previewContent}>
        <Text style={s.previewAdvertiser} numberOfLines={1}>{advertiser}</Text>
        <Text style={s.previewHeadline} numberOfLines={3}>
          {headline || 'Your headline goes here'}
        </Text>
        {body ? <Text style={s.previewBody} numberOfLines={3}>{body}</Text> : null}
        <View style={s.previewCta}>
          <Text style={s.previewCtaLabel}>{ctaLabel || 'Learn more'}</Text>
        </View>
      </View>
    </View>
  );
}

/** Views per day, at a glance. Bars, because thirty numbers is not a shape. */
function Sparkline({ data }: { data: { day: string; impressions: number }[] }) {
  const max = Math.max(...data.map((d) => d.impressions), 1);
  return (
    <View style={s.spark}
          accessibilityRole="image"
          accessibilityLabel={`Daily views: ${data.map((d) => `${d.day}, ${d.impressions}`).join('; ')}`}>
      {data.map((d) => (
        <View key={d.day} style={s.sparkCol}>
          <View style={[s.sparkBar, { height: Math.max((d.impressions / max) * 44, 2) }]} />
        </View>
      ))}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.md }}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={s.metricLabel}>{label}</Text>
      <Text style={s.metricValue}>{value}</Text>
    </View>
  );
}

function numberOrNull(v: string): number | null {
  const n = Number(v.replace(/[^0-9]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}
function todayISO(): string { return new Date().toISOString().slice(0, 10); }
function inDaysISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const s = StyleSheet.create({
  body: { padding: space.xl, gap: space.xxl, paddingBottom: space.xxxl },
  sectionTitle: { ...type.micro, color: colors.mint },
  hint: { ...type.small, color: colors.textFaint, lineHeight: 18 },
  error: { ...type.small, color: colors.danger },
  pair: { flexDirection: 'row', gap: space.md },

  live: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, padding: space.lg, gap: space.md,
  },
  liveLabel: { ...type.bodyStrong, color: colors.text },
  liveMetrics: { flexDirection: 'row', gap: space.xl },
  metricLabel: { ...type.micro, color: colors.textFaint },
  metricValue: { ...type.bodyStrong, color: colors.text },

  spark: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 46 },
  sparkCol: { flex: 1, justifyContent: 'flex-end' },
  sparkBar: { backgroundColor: colors.mintDim, borderRadius: 2 },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    paddingHorizontal: space.md, paddingVertical: 9, borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  chipOn: { backgroundColor: colors.mintWash, borderColor: colors.mint },
  chipLabel: { ...type.small, color: colors.textMuted },
  chipLabelOn: { color: colors.mint },

  imagePick: {
    height: 150, borderRadius: radius.md, overflow: 'hidden',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  imagePreview: { width: '100%', height: '100%' },
  imageEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm },

  preview: {
    height: 300, borderRadius: radius.lg, overflow: 'hidden',
    backgroundColor: colors.raised, justifyContent: 'flex-end',
  },
  previewScrim: { ...fill, backgroundColor: 'rgba(6,10,8,0.55)' },
  previewSponsored: {
    position: 'absolute', top: space.md, left: space.md,
    paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: radius.sm,
    backgroundColor: 'rgba(6,10,8,0.72)',
  },
  previewSponsoredLabel: { ...type.micro, color: colors.text },
  previewContent: { padding: space.lg, gap: space.sm },
  previewAdvertiser: { ...type.micro, color: colors.mint },
  previewHeadline: { ...type.title, color: colors.text },
  previewBody: { ...type.body, color: colors.textMuted, lineHeight: 20 },
  previewCta: {
    marginTop: space.sm, paddingVertical: space.md, borderRadius: radius.md,
    backgroundColor: colors.mint, alignItems: 'center',
  },
  previewCtaLabel: { ...type.bodyStrong, color: colors.onMint },
});
