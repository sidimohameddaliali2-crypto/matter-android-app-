const { getSentryExpoConfig } = require('@sentry/react-native/metro');

// getSentryExpoConfig wraps expo/metro-config's getDefaultConfig and adds
// the annotation plugin Sentry needs to map a crash's minified stack frames
// back to real source lines.
const config = getSentryExpoConfig(__dirname);

module.exports = config;
