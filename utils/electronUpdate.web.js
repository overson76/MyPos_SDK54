// 웹 빌드용 자동 업데이트 헬퍼 — Electron .exe 환경에서만 활성, 일반 브라우저는 no-op.
// preload 의 contextBridge 가 노출한 window.mypos.* 를 사용.

export function isElectronUpdateAvailable() {
  if (typeof window === 'undefined') return false;
  return !!(window.mypos?.isElectron && typeof window.mypos.checkUpdate === 'function');
}

export async function checkForElectronUpdate() {
  if (!isElectronUpdateAvailable()) {
    return { ok: false, reason: 'browser' };
  }
  try {
    return await window.mypos.checkUpdate();
  } catch (e) {
    return { ok: false, reason: 'ipc-error', error: String(e?.message || e) };
  }
}

export async function getElectronUpdateStatus() {
  if (!isElectronUpdateAvailable()) return null;
  try {
    return await window.mypos.getUpdateStatus();
  } catch {
    return null;
  }
}

// callback(status) — main 프로세스가 broadcast 할 때마다 호출.
// 반환: 구독 해제 함수. 컴포넌트 unmount 시 호출.
export function subscribeElectronUpdate(callback) {
  if (!isElectronUpdateAvailable() || typeof callback !== 'function') return () => {};
  return window.mypos.onUpdateStatus(callback);
}

// 1.0.20: 다운로드된 새 버전을 즉시 적용 — 관리자 → 시스템 → "지금 적용" 버튼.
// 반환: { ok, reason?, message? }. ok=true 면 곧 .exe 종료 → NSIS Setup 자동 실행 → 새 버전.
export async function applyElectronUpdateNow() {
  if (typeof window === 'undefined' || !window.mypos?.applyUpdateNow) {
    return { ok: false, reason: 'unavailable' };
  }
  try {
    return await window.mypos.applyUpdateNow();
  } catch (e) {
    return { ok: false, reason: 'ipc-error', error: String(e?.message || e) };
  }
}
