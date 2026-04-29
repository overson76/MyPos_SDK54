// 네이티브 (iOS/Android) 빌드용 — 폰은 expo-updates(OTA) 사용. Electron 자동 업데이트 무관.

export function isElectronUpdateAvailable() {
  return false;
}

export async function checkForElectronUpdate() {
  return { ok: false, reason: 'native' };
}

export async function getElectronUpdateStatus() {
  return null;
}

export function subscribeElectronUpdate(_callback) {
  return () => {};
}
