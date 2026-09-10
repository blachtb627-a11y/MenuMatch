import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider } from '@/state/session';
import { colors } from '@/theme';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.ground }}>
      <SafeAreaProvider>
        <SessionProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.ground },
              animation: 'fade',
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="welcome" />
            <Stack.Screen name="onboarding" />
            <Stack.Screen name="tutorial" />
            <Stack.Screen name="auth" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="recipe/[id]" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="compose/[id]" options={{ animation: 'slide_from_bottom' }} />
            <Stack.Screen name="collection/[id]" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="creator/[id]" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="settings/profile" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="settings/preferences" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="settings/blocked" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="settings/export" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="leaderboard" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="pantry" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="report/problem" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="legal/terms" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="legal/privacy" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="legal/guidelines" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="admin/index" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="admin/report/[id]" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="admin/users" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="admin/user/[id]" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="admin/appeals" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="admin/team" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="admin/audit" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="admin/ads" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="admin/advertisers" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="admin/campaign/[id]" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="cook/[id]" options={{ animation: 'slide_from_bottom' }} />
          </Stack>
        </SessionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
