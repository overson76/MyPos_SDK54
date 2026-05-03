// Sentry 에러 추적 초기화 + 헬퍼.
// DSN 이 비어있으면 init 을 건너뛴다 — 개발 환경에서 Sentry 미설정 상태라도 앱이 안전하게 뜨도록.
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

// Sentry DSN 은 .env 의 EXPO_PUBLIC_SENTRY_DSN 에서 로드.
// EXPO_PUBLIC_ prefix 변수는 빌드 시 RN 클라이언트 번들에 inline 됨.
// .env 가 없거나 값 미설정이면 빈 문자열 → init skip (앱은 정상 동작).
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN || '';

// release 식별자 — app.json 의 version 을 자동으로 쓰도록 동적화.
// 과거에 '1.0.0' 하드코딩되어 새 빌드(1.0.2 등)에서 발생한 사고를 옛 release 로 잘못 그루핑함.
// 이제 Sentry 가 진짜 빌드 버전을 알 수 있어 어떤 빌드에서 발생했는지 정확히 추적 가능.
const RELEASE = Constants.expoConfig?.version || Constants.manifest?.version || '0.0.0';

let _initialized = false;

export function initSentry() {
  if (_initialized) return;
  if (!SENTRY_DSN) {
    // DSN 미설정 — 조용히 skip. 콘솔에 한 번만 안내.
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[sentry] DSN 이 비어있어 초기화를 건너뜁니다. utils/sentry.js 에 DSN 을 입력하세요.');
    }
    return;
  }
  Sentry.init({
    dsn: SENTRY_DSN,
    release: RELEASE,
    // 이벤트 전송 비율 (1.0 = 100%). 개발 중에는 모두, 운영에서는 줄여도 됨.
    tracesSampleRate: __DEV__ ? 1.0 : 0.2,
    // 개인정보 보호 — 자동으로 IP/유저ID 수집 안함. 우리 앱은 로컬 전용이라 필요 없음.
    sendDefaultPii: false,
    // 백그라운드/포그라운드 등 RN 라이프사이클 이벤트는 자동 breadcrumb 로 기록됨.
    enableAutoSessionTracking: true,
    // 환경 라벨 — Sentry 대시보드에서 development / production 분리 가시화.
    environment: __DEV__ ? 'development' : 'production',
  });
  _initialized = true;
}

// 의도한 에러 직접 보고 (예: try/catch 의 catch 블록).
export function reportError(error, extra) {
  if (!_initialized) return;
  if (extra) {
    Sentry.withScope((scope) => {
      Object.entries(extra).forEach(([k, v]) => scope.setExtra(k, v));
      Sentry.captureException(error);
    });
  } else {
    Sentry.captureException(error);
  }
}

// 사용자 동작 흐름 기록 — 크래시 발생 시 직전 행동을 알 수 있게.
// 예: addBreadcrumb('order.confirmed', { tableId: 't01', total: 24000 })
export function addBreadcrumb(message, data) {
  if (!_initialized) return;
  Sentry.addBreadcrumb({
    message,
    data,
    level: 'info',
    timestamp: Date.now() / 1000,
  });
}

// 앱 전역 ErrorBoundary 컴포넌트.
// Sentry 가 init 안 된 상태에서도 React 트리는 살아남게 fallback 을 자체 제공.
// 사용: <SentryErrorBoundary><App /></SentryErrorBoundary>
export const SentryErrorBoundary = Sentry.ErrorBoundary;

export default Sentry;
