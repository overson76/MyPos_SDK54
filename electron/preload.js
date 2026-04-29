// Electron preload — 렌더러(웹페이지)에서 사용 가능한 안전한 API 노출.
// contextBridge 를 거치므로 직접 Node API 접근 X — 매장 환경 안전.
//
// 현재 Phase 1 — 구체적인 노출 API 없음. 향후 Phase 2 (영수증 프린터),
// Phase 3 (자동 업데이트) 등에서 추가.
//
// 노출 예시 (미래):
//   window.mypos.printReceipt(text) → 메인 프로세스 → 시리얼/USB 프린터로
//   window.mypos.checkUpdate() → 메인 프로세스 → electron-updater
//
// 지금은 "이 앱은 Electron 으로 실행 중입니다" 확인용 작은 정보만.

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('mypos', {
  isElectron: true,
  platform: process.platform, // 'win32' / 'darwin' / 'linux'
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
});
