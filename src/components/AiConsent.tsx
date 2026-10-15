import React, { useCallback, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ConfirmDialog } from '@/components/ui';
import { key, storageReady } from '@/lib/storageKeys';

const CONSENT_KEY = key('ai_consent');

/**
 * Asks once before anything is sent to Anthropic.
 *
 * App Review Guideline 5.1.2(i) wants explicit permission before personal data
 * goes to a third-party AI, and a disclosure in the Privacy Policy is not that:
 * it has to be asked in the app, at the point of use. A photo of a recipe page
 * or a kitchen shelf can carry more than the person meant to send, so it is
 * asked before the first scan or estimate rather than assumed from the button.
 *
 * The answer is remembered on the device. Saying no sends nothing and is asked
 * again next time, so a mis-tap is not a permanent refusal.
 *
 * Usage: `const ai = useAiConsent();` then `if (!(await ai.ask())) return;`
 * before the request, and render `{ai.dialog}` somewhere in the screen.
 */
export function useAiConsent() {
  const [visible, setVisible] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const ask = useCallback(async (): Promise<boolean> => {
    try {
      await storageReady();
      if ((await AsyncStorage.getItem(CONSENT_KEY)) === '1') return true;
    } catch {
      // Unreadable storage means we do not know, so ask.
    }
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setVisible(true);
    });
  }, []);

  const settle = useCallback((ok: boolean) => {
    setVisible(false);
    if (ok) void AsyncStorage.setItem(CONSENT_KEY, '1').catch(() => {});
    resolver.current?.(ok);
    resolver.current = null;
  }, []);

  const dialog = (
    <ConfirmDialog
      visible={visible}
      title="Send this to Anthropic’s Claude?"
      body={'Scanning and nutrition estimates are done by Claude, an AI model made by '
        + 'Anthropic. What you scan or estimate — the photo, or the recipe text — is sent '
        + 'to Anthropic to be read, and nothing else: no name, email or account details. '
        + 'You can always type everything in yourself instead.'}
      confirmLabel="Allow"
      cancelLabel="Not now"
      confirmVariant="primary"
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );

  return { ask, dialog };
}
