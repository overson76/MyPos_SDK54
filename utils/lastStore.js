// 마지막으로 가입했던 매장 정보 영구 캐시.
// 익명 UID 손실 / TestFlight 새 빌드 / Electron .exe autoUpdater 첫 부팅 등으로
// storeMembership(CACHE_KEY) 캐시가 사라져도 lastStore 는 별도 키로 보존된다.
// AuthScreen 이 이 캐시로 매장 코드/이름/role 자동 prefill — 사고 시 한 번 클릭으로 복구.
//
// 명시적으로 잊기는 forgetLastStore() 만 — 본인 탈퇴 / 매장 삭제 / "이전 매장 잊기" 버튼.
import { loadJSON, saveJSON, removeKey } from './persistence';

const KEY = 'lastStore';

// 가입 성공 시 호출 (StoreContext.markJoined / subscribeMembership 정상 진입).
// info: { storeId, code, name, role, displayName }
export async function rememberStore(info) {
  if (!info?.storeId || !info?.code) return;
  await saveJSON(KEY, {
    storeId: info.storeId,
    code: info.code,
    name: info.name || null,
    role: info.role || 'staff',
    displayName: info.displayName || null,
    savedAt: Date.now(),
  });
}

export async function getLastStore() {
  return loadJSON(KEY, null);
}

export async function forgetLastStore() {
  await removeKey(KEY);
}
