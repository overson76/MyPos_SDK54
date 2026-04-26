// 웹 번들용 Sentry no-op 스텁.
// metro 가 @sentry/browser 의 exports 해석에 실패하는 이슈를 회피하기 위해
// 웹에서는 모든 export 를 빈 함수로 대체. 매장 운영은 네이티브(iOS/Android) 만 대상이므로
// 웹 미리보기에서는 에러 추적이 필요하지 않음.

export function initSentry() {}

export function reportError() {}

export function addBreadcrumb() {}

export function SentryErrorBoundary({ children }) {
  return children;
}

export default {
  init: () => {},
  captureException: () => {},
  captureMessage: () => {},
  addBreadcrumb: () => {},
  withScope: (cb) => cb({ setExtra: () => {} }),
};
