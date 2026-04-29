// Electron preload — 렌더러(웹페이지)에서 사용 가능한 안전한 API 노출.
// contextBridge 를 거치므로 직접 Node API 접근 X — 매장 환경 안전.
//
// Phase 2 추가:
//   window.mypos.printReceipt(receipt, options?) — 메인 프로세스의 IPC 핸들러로 전달.
//
// 향후 Phase 3 (자동 업데이트) 등에서 추가.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mypos', {
  isElectron: true,
  platform: process.platform, // 'win32' / 'darwin' / 'linux'
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  // 영수증 출력 — 메인 프로세스의 'mypos/print-receipt' IPC 핸들러 호출.
  // receipt: utils/escposBuilder 의 receipt 객체.
  // options: { mode, host, port, iface, type }. 미지정 시 환경변수 / simulate.
  // 반환: Promise<{ ok, mode, error?, info? }>
  async printReceipt(receipt, options) {
    return await ipcRenderer.invoke('mypos/print-receipt', receipt, options);
  },

  // 자동 업데이트 — Phase 3.
  // 수동 "지금 확인" 버튼:
  //   await window.mypos.checkUpdate(); // → { ok, info? }
  // 현재 상태 조회 (마지막 알려진 status — 마운트 시점에 폴링용):
  //   const s = await window.mypos.getUpdateStatus();
  //   // { kind: 'idle'|'checking'|'available'|'downloading'|'downloaded'|'upToDate'|'error'|'disabled', message, ... }
  // 푸시 이벤트 구독 — 메인이 새 상태 broadcast 할 때 자동 호출:
  //   const unsub = window.mypos.onUpdateStatus((status) => { ... });
  //   // 컴포넌트 언마운트 시 unsub() 호출
  // 앱 종료 — 관리자 화면의 "앱 종료" 버튼이 호출. 키오스크에서 X 버튼 없을 때 사용.
  quitApp() {
    ipcRenderer.send('mypos/quit');
  },

  async checkUpdate() {
    return await ipcRenderer.invoke('mypos/update-check');
  },
  async getUpdateStatus() {
    return await ipcRenderer.invoke('mypos/update-status');
  },
  onUpdateStatus(callback) {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('mypos/update-status', handler);
    return () => {
      ipcRenderer.removeListener('mypos/update-status', handler);
    };
  },
});
