// Electron preload — 렌더러(웹페이지)에서 사용 가능한 안전한 API 노출.
// contextBridge 를 거치므로 직접 Node API 접근 X — 매장 환경 안전.
//
// Phase 2 추가:
//   window.mypos.printReceipt(receipt, options?) — 메인 프로세스의 IPC 핸들러로 전달.
//
// 향후 Phase 3 (자동 업데이트) 등에서 추가.

const { contextBridge, ipcRenderer } = require('electron');

// Firebase 인증 상태를 localStorage 에 사전 주입.
// Firebase 가 초기화되기 전에 실행되어야 하므로 preload 최상단에 위치.
// Cloudflare URL 로 로드될 때와 mypos:// 로컬 폴백으로 로드될 때 localStorage 가 달라서
// 매번 다른 익명 UID 가 생성되던 문제를 방지한다.
try {
  const savedAuth = ipcRenderer.sendSync('mypos/load-auth-state-sync');
  if (savedAuth && typeof savedAuth === 'object') {
    Object.entries(savedAuth).forEach(([k, v]) => {
      try { window.localStorage.setItem(k, v); } catch {}
    });
  }
} catch {}

contextBridge.exposeInMainWorld('mypos', {
  isElectron: true,
  platform: process.platform, // 'win32' / 'darwin' / 'linux'
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    // app 버전은 비동기로 — 1.0.5 에서 sendSync 가 sandbox 환경에서 freeze + 즉시 종료
    // 회귀 발생. async getter 로 변경 (UpdateBanner 도 async fetch 로 수정).
  },
  async getAppVersion() {
    try { return await ipcRenderer.invoke('mypos/get-app-version'); }
    catch { return ''; }
  },
  // 영수증 출력 — 메인 프로세스의 'mypos/print-receipt' IPC 핸들러 호출.
  // receipt: utils/escposBuilder 의 receipt 객체.
  // options: { mode, host, port, iface, type }. 미지정 시 환경변수 / simulate.
  // 반환: Promise<{ ok, mode, error?, info? }>
  async printReceipt(receipt, options) {
    return await ipcRenderer.invoke('mypos/print-receipt', receipt, options);
  },

  // KIS-NAGT 카드 단말기 결제.
  //   request: { tradeType: 'D1'|'D2', amount, vatAmount?, installment?, orgAuthDate?, orgAuthNo? }
  //   options: { mode: 'simulate'|'bridge', bridgePath?, timeoutMs? } — 미지정 시 환경변수 default.
  //   반환: { ok, mode, data?, error?, exitCode? }
  // simulate 모드 = 가짜 승인 (단말기 미연동 매장 흐름 검증). bridge = 실 결제.
  async kisPay(request, options) {
    return await ipcRenderer.invoke('mypos/kis-pay', request, options);
  },
  // KIS 셋업 진단 — OCX 등록 / 브릿지 .exe 위치 / 모드 확인. 관리자 화면용.
  async kisDiagnose() {
    return await ipcRenderer.invoke('mypos/kis-diagnose');
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

  // 매장 멤버십 파일 영속화 — 재설치해도 매장 연동 유지.
  async saveMembership(data) {
    return await ipcRenderer.invoke('mypos/save-membership', data);
  },
  async loadMembership() {
    return await ipcRenderer.invoke('mypos/load-membership');
  },
  async clearMembership() {
    return await ipcRenderer.invoke('mypos/clear-membership');
  },

  // Firebase 인증 상태 저장 — firebase.web.js 가 인증 상태 변경 시 호출.
  async saveAuthState(data) {
    return await ipcRenderer.invoke('mypos/save-auth-state', data);
  },

  // CID — 전화 착신 자동 감지.
  async startCid(storeId) {
    return await ipcRenderer.invoke('mypos/start-cid', storeId);
  },
  onIncomingCall(callback) {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('mypos/incoming-call', handler);
    return () => ipcRenderer.removeListener('mypos/incoming-call', handler);
  },
  // CID 진단 — sip 패키지 로드 / 5060 바인딩 / REGISTER 결과 등 스냅샷.
  // 관리자 → 시스템 → "📞 CID 진단" 카드가 호출.
  async cidDiagnose() {
    return await ipcRenderer.invoke('mypos/cid-status');
  },

  async checkUpdate() {
    return await ipcRenderer.invoke('mypos/update-check');
  },
  async getUpdateStatus() {
    return await ipcRenderer.invoke('mypos/update-status');
  },
  // 1.0.20: 다운로드된 새 버전을 즉시 적용 — 관리자 → 시스템 → "지금 적용" 버튼.
  // 반환: { ok, reason?, message? } — ok=true 면 곧 .exe 종료 + NSIS 트리거 + 새 버전 시작.
  async applyUpdateNow() {
    return await ipcRenderer.invoke('mypos/update-apply-now');
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
