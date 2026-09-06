import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { colors, radius, space, type } from '@/theme';

/**
 * §8.2: saving shows a lightweight, non-blocking confirmation. Never a
 * full-screen interstitial, never a celebratory modal — there is no match
 * moment in MenuMatch (§3).
 */
export function Toast({
  message, action, onAction, onDismiss,
}: {
  message: string | null;
  action?: string;
  onAction?: () => void;
  onDismiss: () => void;
}) {
  const opacity = useSharedValue(0);
  const y = useSharedValue(12);

  useEffect(() => {
    if (!message) return;
    opacity.value = withTiming(1, { duration: 140 });
    y.value = withTiming(0, { duration: 140 });
    const t = setTimeout(() => {
      opacity.value = withTiming(0, { duration: 180 });
      y.value = withTiming(12, { duration: 180 });
      setTimeout(onDismiss, 180);
    }, 2400);
    return () => clearTimeout(t);
  }, [message, onDismiss, opacity, y]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: y.value }],
  }));

  if (!message) return null;

  return (
    <Animated.View style={[s.wrap, style]} pointerEvents="box-none">
      <View style={s.toast} accessibilityLiveRegion="polite">
        <Text style={s.message} numberOfLines={2}>{message}</Text>
        {action && onAction ? (
          <Text style={s.action} onPress={onAction} accessibilityRole="button">{action}</Text>
        ) : null}
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: space.lg, right: space.lg, bottom: space.lg, alignItems: 'center' },
  toast: {
    flexDirection: 'row', alignItems: 'center', gap: space.lg,
    backgroundColor: colors.raised, borderColor: colors.borderBright, borderWidth: 1,
    paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.lg,
    maxWidth: 460,
  },
  message: { ...type.small, color: colors.text, flexShrink: 1 },
  action: { ...type.small, color: colors.mint, fontWeight: '700' },
});
