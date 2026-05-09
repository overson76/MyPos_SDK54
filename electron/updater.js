// 자동 업데이트 — electron-updater 래퍼.
//
// 매장 운영 안전 정책:
//   - autoDownload: true     — 백그라운드 다운로드, UI 차단 X
//   - autoInstallOnAppQuit: false — .exe 종료해도 NSIS 인스톨러 자동 실행 절대 X.
//     1.0.10 까지는 true 였는데 NSIS uninstall 단계 hang 사고("Failed to uninstall old
//     application files") 가 자동 적용 시점마다 반복돼서 1.0.11 부터 false. 사장님이
//     명시적으로 "지금 적용" 버튼을 눌러야만 NSIS 인스톨러가 실행됨.
//   - 절대 quitAndInstall() 강제 호출 X — 영업 중 갑자기 재시작 사고 방지
//
// 알림 흐름:
//   - 새 버전 다운로드되면 메인 프로세스가 모든 윈도우에 'mypos/update-status' 이벤트 발송
//   - 렌더러는 preload 의 onUpdateStatus(callback) 으로 구독 — 관리자 → 시스템 → 업데이트 카드에서 표시
//   - 사장님은 화면에서 "새 버전 v1.0.X 준비됨" 정보만 볼 뿐, 강제 적용 X

const { autoUpdater } = require('electron-updater');

// 1.0.28: autoDownload 도 false 로 변경. quitAndInstall silent 실패가 반복돼서 자동
// 다운로드 자체가 무용 — 백그라운드에서 다운로드만 받고 적용 못 하는 패턴 (사장님 며칠 짜증).
// 사장님이 GitHub Releases 에서 직접 NSIS Setup 받아 설치하는 단순 흐름으로 전환.
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

// 메인 프로세스 → 모든 BrowserWindow 에 이벤트 push.
function broadcastStatus(getWindows, status) {
  for (const win of getWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('mypos/update-status', status);
    }
  }
}

// 마지막 알려진 상태 — 새로 mount 한 렌더러도 즉시 받을 수 있게 캐시.
let lastStatus = { kind: 'idle', message: '아직 확인 안 됨', at: null };

function setStatus(getWindows, status) {
  lastStatus = { ...status, at: Date.now() };
  broadcastStatus(getWindows, lastStatus);
}

// 메인 프로세스 부팅 시 한 번 호출. autoUpdater 의 이벤트들에 리스너 붙이고 첫 체크 트리거.
function setupAutoUpdater(getWindows) {
  // dev 빌드 (app.isPackaged === false) 에서는 GitHub 호출 자체가 의미 없음.
  // electron-updater 가 자체적으로 dev 면 no-op 이지만 명시적으로 회피.
  if (!autoUpdater.isUpdaterActive || !autoUpdater.isUpdaterActive()) {
    setStatus(getWindows, { kind: 'disabled', message: 'dev 빌드 — 업데이트 비활성' });
    return;
  }

  autoUpdater.on('checking-for-update', () => {
    setStatus(getWindows, { kind: 'checking', message: '업데이트 확인 중...' });
  });
  autoUpdater.on('update-available', (info) => {
    setStatus(getWindows, {
      kind: 'available',
      message: `새 버전 ${info?.version || ''} 다운로드 시작`,
      version: info?.version || null,
    });
  });
  autoUpdater.on('update-not-available', (info) => {
    setStatus(getWindows, {
      kind: 'upToDate',
      message: '최신 버전입니다',
      version: info?.version || null,
    });
  });
  autoUpdater.on('download-progress', (progress) => {
    setStatus(getWindows, {
      kind: 'downloading',
      message: `다운로드 ${Math.round(progress?.percent || 0)}%`,
      percent: progress?.percent || 0,
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    setStatus(getWindows, {
      kind: 'downloaded',
      message: `새 버전 ${info?.version || ''} 준비됨. 다음 시작 시 자동 적용`,
      version: info?.version || null,
    });
  });
  autoUpdater.on('error', (err) => {
    setStatus(getWindows, {
      kind: 'error',
      message: `업데이트 오류: ${String(err?.message || err)}`,
    });
  });

  // 부팅 시 한 번 자동 체크. 실패해도 throw X — error 이벤트로 흘러감.
  // 1.0.21: checkForUpdatesAndNotify → checkForUpdates 로 변경.
  // AndNotify 는 update-downloaded 이벤트마다 OS Toast 알림을 자동 발송함 → 매장 PC 가 24/7
  // 켜진 상태에서 부팅/체크 사이클마다 누적되어 Windows 알림 센터에 spam (사장님 화면 19개).
  // 우리는 자체 자동업데이트 카드(관리자 → 시스템 → 🔄 자동 업데이트) + "🚀 지금 적용" 버튼으로
  // 충분히 안내하므로 OS 알림 불필요. 알림 spam 영원히 0.
  autoUpdater.checkForUpdates().catch(() => {});
}

// 수동 체크 — 관리자 화면 "지금 확인" 버튼 IPC.
async function checkNow() {
  try {
    const res = await autoUpdater.checkForUpdates();
    return { ok: true, info: res?.updateInfo || null };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// 1.0.20: "지금 적용" 버튼 IPC — 다운로드 완료(downloaded) 상태일 때만 호출 안전.
// 사장님이 영업 종료 후 명시 클릭 → quitAndInstall(false, true) → .exe 자동 닫힘 +
// NSIS Setup 자동 실행 + 새 버전 자동 시작. 영업 중 실수 클릭 방지는 UI 의 confirm 다이얼로그로.
//
// quitAndInstall(isSilent, isForceRunAfter):
//   - isSilent=false: NSIS 설치 진행 다이얼로그 보임 (안전 — 사장님이 진행 상황 확인 가능)
//   - isForceRunAfter=true: 새 버전 자동 시작 (영업 중단 최소)
//
// downloaded 가 아니면 no-op + 이유 반환 — 호출부가 사용자에게 안내.
function applyNow() {
  if (lastStatus.kind !== 'downloaded') {
    return {
      ok: false,
      reason: 'not-downloaded',
      kind: lastStatus.kind,
      message: '다운로드된 새 버전이 없습니다. (현재 상태: ' + lastStatus.kind + ')',
    };
  }
  try {
    // 1.0.24: quitAndInstall 이 .exe 종료 못 하는 케이스 (KIS bridge / SIP / 프린터 spool 등
    // child 프로세스 잔존) 대비 — 호출 후 8초 안에 앱이 안 닫혔으면 강제 app.exit(0).
    // NSIS 가 잠금 해제 후 새 버전 시작 가능. 1.0.21~1.0.23 에서 매번 매장 PC 가
    // "🚀 지금 적용" 클릭 후에도 옛 버전 그대로 였던 패턴 영구 차단.
    setTimeout(() => {
      try { autoUpdater.quitAndInstall(false, true); } catch {}
      // 8초 후 강제 종료 fallback. quitAndInstall 이 정상 종료되면 이 setTimeout 도 같이 죽음.
      setTimeout(() => {
        try {
          // eslint-disable-next-line global-require
          const { app } = require('electron');
          app.exit(0);
        } catch {}
      }, 8000);
    }, 50);
    return { ok: true, message: '잠시 후 .exe 가 닫히고 새 버전이 자동 시작됩니다' };
  } catch (e) {
    return { ok: false, reason: 'exception', error: String(e?.message || e) };
  }
}

function getLastStatus() {
  return lastStatus;
}

module.exports = {
  setupAutoUpdater,
  checkNow,
  applyNow,
  getLastStatus,
};
