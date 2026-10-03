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
    version: '1.0.0',
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
    ios: {
      bundleIdentifier: 'app.swipzy.client',
      // A build number is per-store-upload and can never be reused, even for
      // a build that was rejected. `version` only moves when there is
      // something to tell people about; this moves every submission.
      //
      // eas.json sets appVersionSource to "remote", so on an EAS build the
      // number here is ignored and EAS increments its own. That is not a
      // preference: EAS can only rewrite a static app.json, and this config is
      // JavaScript. The value below is what a local or bare build uses.
      buildNumber: '1',
      // Off deliberately. Leaving it on means Apple reviews the app on an
      // iPad, and a phone-width swipe deck stretched to eleven inches is a
      // rejection nobody needs. Turn it back on after laying the deck out for
      // a large screen and actually looking at it.
      supportsTablet: false,
      // Required. expo-image-picker calls the camera and the library from
      // src/lib/media.ts, and on iOS a missing usage string is not a refused
      // prompt — the app is killed the moment the sheet opens. Apple also
      // rejects vague copy, so these say what each one is actually for.
      infoPlist: {
        // Answered once here so neither the build nor App Store Connect asks
        // again. It is the truthful answer: there is no crypto library in the
        // dependency tree, the one call near it is crypto.getRandomValues
        // making a random device id, and everything else is HTTPS that iOS
        // itself provides — which is exactly what the exemption covers.
        ITSAppUsesNonExemptEncryption: false,
        NSCameraUsageDescription:
          'Swipzy uses the camera to photograph a dish for a recipe you are '
          + 'writing, to scan a written recipe, or to scan what is in your kitchen.',
        NSPhotoLibraryUsageDescription:
          'Swipzy uses your photos so you can attach one to a recipe you are '
          + 'writing or set it as your profile picture.',
      },
    },
    android: {
      package: 'app.swipzy.client',
      versionCode: 1,
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#FFFFFF',
      },
    },
    web: { bundler: 'metro', output: 'single', favicon: './assets/favicon.png' },
    plugins: ['expo-router'],
    // `owner` and `projectId` identify the EAS project this builds under.
    // EAS fills these into a static app.json by itself and refuses to touch a
    // dynamic config like this one, so they are written in by hand. Neither is
    // a secret: both are in the project's own public URL,
    // expo.dev/accounts/thomasb627/projects/swipzy.
    owner: 'thomasb627',
    extra: {
      eas: { projectId: 'fba8a1d0-468c-42d5-bc9d-cdfbacd178e7' },
    },
    experiments: {
      typedRoutes: false,
      ...(baseUrl ? { baseUrl } : {}),
    },
  },
};
