/**
 * Expo config.
 *
 * `baseUrl` is set only when EXPO_BASE_URL is present, which the Pages workflow
 * supplies. GitHub Pages serves a project repo from a subpath
 * (/MenuMatch), so the exported bundle needs to know that prefix; local dev and
 * native builds must not have it.
 */
const baseUrl = process.env.EXPO_BASE_URL || undefined;

module.exports = {
  expo: {
    name: 'MenuMatch',
    slug: 'menumatch',
    version: '0.1.0',
    orientation: 'portrait',
    scheme: 'menumatch',
    userInterfaceStyle: 'dark',
    newArchEnabled: true,
    backgroundColor: '#090B0A',
    splash: {
      backgroundColor: '#090B0A',
      resizeMode: 'contain',
    },
    ios: { supportsTablet: true, bundleIdentifier: 'app.menumatch.client' },
    android: {
      package: 'app.menumatch.client',
      adaptiveIcon: { backgroundColor: '#090B0A' },
    },
    web: { bundler: 'metro', output: 'single' },
    plugins: ['expo-router'],
    experiments: {
      typedRoutes: false,
      ...(baseUrl ? { baseUrl } : {}),
    },
  },
};
