import React, { useEffect, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Button, Screen } from '@/components/ui';
import { colors, radius, space, type } from '@/theme';

/**
 * Where a confirmation link lands.
 *
 * Supabase verifies the token itself and then redirects to whatever the Site
 * URL is set to. Left at its default that is localhost, which is why
 * confirming an address worked and then showed "this site can't be reached" —
 * the account was fine, the destination was not.
 *
 * Pointing it at the home page would work and would also tell nobody anything:
 * you would land on the welcome screen with no idea whether the thing you just
 * clicked had done what it said. So this page exists to say it did.
 *
 * It is reached in a browser, from a mail app, on a phone that probably has
 * the app installed — hence the deep link. Someone who confirmed on a laptop
 * gets told to go back to their phone, which is the honest instruction.
 */
export default function Confirmed() {
  /**
   * Supabase puts failures in the URL fragment rather than the query string,
   * and an expired link is the common one: the mail sat in an inbox for a day.
   * Telling someone "you're all set" when the token had expired would be the
   * worst outcome here, so the page reads the hash before claiming anything.
   */
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    const params = new URLSearchParams(hash);
    const description = params.get('error_description') ?? params.get('error');
    if (description) setFailure(description.replace(/\+/g, ' '));
  }, []);

  const ok = failure === null;

  return (
    <Screen>
      <SafeAreaView style={s.wrap}>
        <View style={[s.badge, !ok && s.badgeBad]}>
          <Feather name={ok ? 'check' : 'alert-circle'} size={30}
                   color={ok ? colors.onMint : colors.text} />
        </View>

        <View style={{ gap: space.md, alignItems: 'center' }}>
          <Text style={s.title}>{ok ? 'Email confirmed' : 'This link has expired'}</Text>
          <Text style={s.body}>
            {ok
              ? 'Your account is ready. Open Swipzy and sign in — you can close this tab.'
              : 'Confirmation links do not last forever. Open Swipzy, try to sign in, '
                + 'and it will offer to send a new one.'}
          </Text>
          {!ok && failure ? <Text style={s.detail}>{failure}</Text> : null}
        </View>

        <View style={{ gap: space.md, alignSelf: 'stretch' }}>
          <Button label="Open Swipzy"
                  onPress={() => { void Linking.openURL('swipzy://').catch(() => {}); }} />
          <Text style={s.footnote}>
            If nothing happens, open Swipzy from your home screen. On a computer,
            carry on from your phone.
          </Text>
        </View>
      </SafeAreaView>
    </Screen>
  );
}

const s = StyleSheet.create({
  wrap: {
    flex: 1, padding: space.xl, gap: space.xxl,
    alignItems: 'center', justifyContent: 'center',
  },
  badge: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: colors.mint,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeBad: { backgroundColor: colors.raised },
  title: { ...type.title, color: colors.text, textAlign: 'center' },
  body: {
    ...type.body, color: colors.textMuted, textAlign: 'center',
    lineHeight: 22, maxWidth: 330,
  },
  detail: {
    ...type.small, color: colors.textFaint, textAlign: 'center',
    backgroundColor: colors.surface, borderRadius: radius.md,
    paddingHorizontal: space.md, paddingVertical: space.sm, maxWidth: 330,
  },
  footnote: {
    ...type.small, color: colors.textFaint, textAlign: 'center', lineHeight: 18,
  },
});
