// plugins/withAndroidLinkingQueries.js
//
// Adds explicit <queries><package .../> entries for the specific apps this
// project launches via Linking (Google Maps, 2GIS) on the Delivery Details
// screen's "Maps"/"2GIS" buttons.
//
// Android 11+ (API 30+) hides other apps' visibility from Linking.canOpenURL
// / Linking.openURL by default (package visibility). Expo's own default
// prebuild output only adds a generic <intent> query for a bare
// "https" scheme with no host, which is unreliable in practice for specific,
// host-scoped apps like Google Maps — it works inconsistently across
// devices/OEMs and Android versions (this is a widely reported real-world
// gap, not just a theoretical one). Declaring the exact target packages is
// the reliable fix Android's own docs recommend when you know which app
// you're targeting.
//
// This runs on every `expo prebuild`, so it survives the clean regenerations
// this project does at each SDK-migration stage — don't hand-edit the
// generated AndroidManifest.xml's <queries> block directly, it'll be wiped.
const { withAndroidManifest } = require('@expo/config-plugins');

const TARGET_PACKAGES = [
  'com.google.android.apps.maps', // Google Maps
  'ru.dublgis.dgismobile',        // 2GIS
];

const withAndroidLinkingQueries = (config) => {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    if (!manifest.queries) {
      manifest.queries = [{}];
    }
    const queries = manifest.queries[0];

    if (!queries.package) {
      queries.package = [];
    }

    for (const packageName of TARGET_PACKAGES) {
      const alreadyPresent = queries.package.some(
        (entry) => entry?.$?.['android:name'] === packageName
      );
      if (!alreadyPresent) {
        queries.package.push({ $: { 'android:name': packageName } });
      }
    }

    return config;
  });
};

module.exports = withAndroidLinkingQueries;
