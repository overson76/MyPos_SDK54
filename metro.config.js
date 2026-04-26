// Metro 설정 — Sentry source map 업로드용 serializer 적용.
// `@sentry/react-native/metro` wrapper 가 빌드 산출물에 sourceMappingURL 주석을 추가해
// EAS / 로컬 빌드 시 plugin 이 source map 을 자동 업로드할 수 있게 한다.
const { getDefaultConfig } = require('expo/metro-config');
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

// 기존 expo 설정을 받아 sentry wrapper 로 한 번 감싼다.
const config = getDefaultConfig(__dirname);

module.exports = getSentryExpoConfig(__dirname, config);
