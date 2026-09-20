import React from 'react';
import { Redirect, Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '@/state/session';
import { REQUIRE_ACCOUNT } from '@/config';
import { colors } from '@/theme';

/**
 * The navigator's own content height for a bottom bar — icon, label and the
 * spacing it puts between them. Taken as given rather than re-derived: sizing
 * the row by hand squeezed it, and the labels came out sliced in half.
 */
const NAV_ROW = 49;

/** Clear space under the row, on top of whatever inset the phone reports. */
const LIFT = 10;

/** §6 primary navigation. Terminology follows the §3 lexicon: Cookbook, not Library. */
export default function TabsLayout() {
  const { ready, session } = useSession();
  const insets = useSafeAreaInsets();

  // Covers signing out and an expired session, not just a cold start: without
  // this the tabs stay mounted after the session goes away.
  if (ready && REQUIRE_ACCOUNT && !session) return <Redirect href="/welcome" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.mint,
        tabBarInactiveTintColor: colors.textFaint,
        // The bar sits on the same ground as the screen above it. A lighter
        // bar with a rule across the top reads as a strip bolted to the
        // bottom; matching the ground lets the content run to the edge and
        // leaves the icons to mark the boundary.
        //
        // Height and bottom padding move together. An explicit height is
        // taken by the navigator as the *total*, inset included, so growing it
        // by exactly LIFT and spending that same LIFT on padding leaves the
        // row its full NAV_ROW and simply raises it off the bottom edge.
        //
        // Padding on its own — which is what an earlier pass added here,
        // against the warning that used to be in this comment — takes the
        // space out of the row instead, and the labels come out sliced.
        tabBarStyle: {
          backgroundColor: colors.ground,
          borderTopWidth: 0,
          elevation: 0,
          height: NAV_ROW + LIFT + insets.bottom,
          paddingBottom: LIFT + insets.bottom,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600', letterSpacing: 0.1 },
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
