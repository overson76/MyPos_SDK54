// 네이티브 no-op — CID 이벤트는 Electron → Firebase → 웹/앱 순서로 전달됨.
// 실제 구독 로직은 useIncomingCall.web.js 에 있음.
// 시그니처는 .web 과 동일 — { call, dismiss }.
const NOOP_DISMISS = () => {};
export function useIncomingCall(_storeId) {
  return { call: null, dismiss: NOOP_DISMISS };
}
