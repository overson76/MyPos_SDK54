// 네이티브 (iOS/Android) OTA 체크 헬퍼.
// expo-updates 가 Expo 서버(EAS Update)에서 새 JS 번들 받아 다음 앱 시작 시 자동 적용.
//
// 매장 운영 안전 정책:
//   - 영업 중에는 "다음 앱 시작 시 적용" 만. reload 강제 X (갑자기 화면 새로고침되면 사고).
//   - 다운로드는 백그라운드 — UI 차단 X.
//   - 사장님이 자연스럽게 앱 종료 → 재시작하는 흐름에 맞춰 적용.
//
// runtimeVersion (app.json) 정책:
//   - "policy": "appVersion" — version 같은 빌드끼리만 OTA 호환.
//   - 네이티브 코드 변경 (새 패키지 추가, expo-updates SDK 자체 업그레이드 등) 시
//     반드시 app.json version 올리고 새 EAS 빌드 — 옛 빌드는 호환 안 됨.

import * as Updates from 'expo-updates';
import { addBreadcrumb, reportError } from './sentry';

// 앱 시작 직후 호출. 새 OTA 있으면 백그라운드 다운로드 → 다음 시작 시 적용.
// 반환값:
//   { state: 'disabled' }   — dev 빌드 / Updates.isEnabled === false
//   { state: 'upToDate' }   — 같은 버전
//   { state: 'downloaded', manifest } — 새 번들 받아 캐시. 다음 시작 시 적용
//   { state: 'error', error } — 네트워크 / 서버 / 권한 오류
export async function checkForUpdates() {
  // expo-updates 가 처음 추가된 네이티브 빌드에서 isEnabled 접근 자체가 드물게 에러 발생 가능.
  // 전체를 최상위 try/catch 로 감쌈 — 어떤 에러도 앱 크래시로 번지지 않게.
  try {
    if (!Updates.isEnabled) {
      return { state: 'disabled' };
    }
    const result = await Updates.checkForUpdateAsync();
    if (!result.isAvailable) {
      addBreadcrumb('ota.upToDate');
      return { state: 'upToDate' };
    }
    addBreadcrumb('ota.available');
    const fetchResult = await Updates.fetchUpdateAsync();
    addBreadcrumb('ota.downloaded', {
      isNew: fetchResult.isNew,
    });
    return { state: 'downloaded', manifest: fetchResult.manifest };
  } catch (e) {
    reportError(e, { ctx: 'otaUpdates.checkForUpdates' });
    return { state: 'error', error: String(e?.message || e) };
  }
}

// 진단 정보 — 관리자 화면에서 현재 빌드 + OTA 상태 표시용.
export function getOtaInfo() {
  try {
    return {
      enabled: Updates.isEnabled,
      runtimeVersion: Updates.runtimeVersion || null,
      updateId: Updates.updateId || null,
      channel: Updates.channel || null,
      createdAt: Updates.createdAt || null,
      isEmbeddedLaunch: Updates.isEmbeddedLaunch ?? null,
    };
  } catch {
    return { enabled: false, runtimeVersion: null, updateId: null, channel: null, createdAt: null, isEmbeddedLaunch: null };
  }
}
