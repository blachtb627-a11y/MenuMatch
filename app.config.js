/**
 * Expo config.
 *
 * `baseUrl` is set only when EXPO_BASE_URL is present, which the Pages workflow
 * supplies. GitHub Pages serves a project repo from a subpath
 * (/MenuMatch — the repo name, which the rename to Swipzy did not change), so
 * the exported bundle needs to know that prefix; local dev and native builds
 * must not have it.
 */
const baseUrl = process.env.EXPO_BASE_URL || undefined;

module.exports = {
  expo: {
    name: 'Swipzy',
    slug: 'swipzy',
    version: '0.1.0',
    orientation: 'portrait',
    scheme: 'swipzy',
    userInterfaceStyle: 'dark',
    newArchEnabled: true,
    backgroundColor: '#090B0A',
    icon: './assets/icon.png',
    // The lockup is drawn on white and the wordmark is near-black, so the
    // splash is white and the app opens dark. The alternative — the ground
    // colour here — would need a light colourway of the wordmark, which we do
    // not have; putting the dark one on #090B0A would show the cards and the
    // arrow floating above nothing.
    splash: {
      image: './assets/splash.png',
      backgroundColor: '#FFFFFF',
      resizeMode: 'contain',
    },
    ios: { supportsTablet: true, bundleIdentifier: 'app.swipzy.client' },
    android: {
      package: 'app.swipzy.client',
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#FFFFFF',
      },
    },
    web: { bundler: 'metro', output: 'single', favicon: './assets/favicon.png' },
    plugins: ['expo-router'],
    experiments: {
      typedRoutes: false,
      ...(baseUrl ? { baseUrl } : {}),
    },
  },
};
