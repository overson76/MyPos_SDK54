// 웹 빌드용 no-op 스텁.
// @react-native-firebase 는 RN 네이티브 전용 — Metro 가 .web.js 를 우선 해석.
// 웹에서는 Firebase 동기화 기능을 사용하지 않음 (Expo Web 은 미리보기 용도).
// 추후 Firebase JS SDK 로 웹 동기화 붙이려면 이 스텁을 실제 구현으로 교체.

export async function initFirebase() {
  // no-op
}

export function getFirebaseApp() {
  return null;
}

export function getAuth() {
  return null;
}

export function getFirestore() {
  return null;
}

export function getCurrentUid() {
  return null;
}

export function serverTimestamp() {
  return new Date();
}
