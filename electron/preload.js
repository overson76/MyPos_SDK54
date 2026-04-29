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
});
