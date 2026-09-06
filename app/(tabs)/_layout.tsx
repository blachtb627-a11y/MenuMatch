import React from 'react';
import { Redirect, Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSession } from '@/state/session';
import { REQUIRE_ACCOUNT } from '@/config';
import { colors } from '@/theme';

/** §6 primary navigation. Terminology follows the §3 lexicon: Cookbook, not Library. */
export default function TabsLayout() {
  const { ready, session } = useSession();

  // Covers signing out and an expired session, not just a cold start: without
  // this the tabs stay mounted after the session goes away.
  if (ready && REQUIRE_ACCOUNT && !session) return <Redirect href="/welcome" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.mint,
        tabBarInactiveTintColor: colors.textFaint,
        // Padding here without matching height clips the labels; let the
        // navigator size the bar and add its own safe-area inset.
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{
        title: 'Discover',
        tabBarIcon: ({ color, size }) => <Feather name="layers" size={size} color={color} />,
      }} />
      <Tabs.Screen name="search" options={{
        title: 'Search',
        tabBarIcon: ({ color, size }) => <Feather name="search" size={size} color={color} />,
      }} />
      <Tabs.Screen name="create" options={{
        title: 'Create',
        tabBarIcon: ({ color, size }) => <Feather name="plus-square" size={size} color={color} />,
      }} />
      <Tabs.Screen name="cookbook" options={{
        title: 'Cookbook',
        tabBarIcon: ({ color, size }) => <Feather name="bookmark" size={size} color={color} />,
      }} />
      <Tabs.Screen name="profile" options={{
        title: 'Profile',
        tabBarIcon: ({ color, size }) => <Feather name="user" size={size} color={color} />,
      }} />
    </Tabs>
  );
}
