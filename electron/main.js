// MyPos PC 카운터 — Electron 메인 프로세스.
//
// 역할: BrowserWindow 하나 생성 → 라이브 URL 로드.
// Chrome --kiosk 와 같은 효과 + 정식 .exe 설치형으로 매장 PC 에 배포.
//
// 보안 정책:
//   - nodeIntegration: false / contextIsolation: true — 표준 안전 설정
//   - sandbox: true — 렌더러는 OS 직접 접근 못 함
//   - 외부 링크는 OS 기본 브라우저로 — 매장 환경에서 실수로 외부 사이트로 가도 격리
//
// 키오스크 모드 토글:
//   - 환경변수 MYPOS_KIOSK=1 (또는 패키징된 빌드의 default 설정) → 풀스크린 + 메뉴바 제거
//   - dev 모드는 일반 창 — 디버깅 편함
//
// 라이브 URL:
//   - 환경변수 MYPOS_URL 또는 기본값 (Cloudflare 라이브 URL)

const { app, BrowserWindow, shell, Menu, ipcMain, globalShortcut } = require('electron');
const path = require('node:path');
const { printReceiptIpc } = require('./printer/print');
const { startCidListener } = require('./cid');
const { setupAutoUpdater, checkNow, getLastStatus } = require('./updater');
const {
  registerOfflineScheme,
  mountLocalServer,
  loadWithFallback,
} = require('./offline');

// 커스텀 scheme 등록 — app.whenReady() 이전에 호출 필수.
// mypos:// 가 http 처럼 동작해서 Expo 빌드의 절대 경로(/static/...)가 정상 해석됨.
registerOfflineScheme();

const DEFAULT_URL = process.env.MYPOS_URL || 'https://mypos-sdk54.overson76.workers.dev';
const KIOSK_MODE = process.env.MYPOS_KIOSK === '1' || app.isPackaged;
const IS_DEV = !app.isPackaged;

// 같은 .exe 가 두 번 실행되는 것 방지 — 매장 PC 에서 사장님이 더블클릭 한 번 더 누르면
// 두 창이 열리는 흔한 사고 회피. 두 번째 인스턴스는 첫 번째 창을 활성화하고 즉시 종료.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#1F2937', // 로딩 시 흰 화면 깜빡임 방지 — navy 와 일치
    title: 'MyPos',
    fullscreen: KIOSK_MODE,
    autoHideMenuBar: KIOSK_MODE,
    kiosk: KIOSK_MODE,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 매장 환경 — 자동 다른 origin 으로 navigate 안 됨. 안전 우선.
      webSecurity: true,
    },
  });

  // 키오스크 모드일 땐 메뉴바 자체 제거. dev 는 메뉴 유지 (개발자 도구 접근).
  if (KIOSK_MODE) {
    Menu.setApplicationMenu(null);
  }

  // 라이브 URL 우선. 타임아웃/오류 시 번들된 dist/ 폴백 (Phase 4 오프라인 캐시).
  loadWithFallback(mainWindow, DEFAULT_URL).then(({ source }) => {
    if (source !== 'live') {
      // eslint-disable-next-line no-console
      console.warn(`[main] 로드 소스: ${source}`);
    }
  });

  // 외부 링크 (target=_blank, window.open 등) 는 OS 기본 브라우저로.
  // 매장 PC 에서 실수로 외부 사이트 들어가도 격리된 공간에서 열림.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // navigate 도 방지 — 라이브 URL 이외 origin 은 외부 브라우저로.
  mainWindow.webContents.on('will-navigate', (event, navUrl) => {
    try {
      const target = new URL(navUrl);
      const home = new URL(DEFAULT_URL);
      if (target.origin !== home.origin) {
        event.preventDefault();
        shell.openExternal(navUrl);
      }
    } catch {
      event.preventDefault();
    }
  });

  // dev 빌드는 자동으로 DevTools 열어 디버깅 편하게.
  if (IS_DEV) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('second-instance', () => {
  // 두 번째 인스턴스 시도 → 기존 창 활성화
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// 영수증 출력 IPC — preload 의 contextBridge 가 렌더러 → 메인으로 호출 보낼 때 진입.
// receipt: utils/escposBuilder 의 receipt 객체. options: { mode, host, port, iface, type }.
// 모드 default = simulate (콘솔 로그). 매장이 프린터 결정 후 환경변수 / IPC 옵션으로 전환.
ipcMain.handle('mypos/print-receipt', async (_event, receipt, options) => {
  return await printReceiptIpc(receipt, options);
});

// 앱 종료 IPC — 관리자 화면 "앱 종료" 버튼 또는 preload 의 quitApp() 이 호출.
ipcMain.on('mypos/quit', () => {
  app.quit();
});

// 자동 업데이트 IPC — 관리자 화면 "지금 확인" 버튼이 호출.
ipcMain.handle('mypos/update-check', async () => {
  return await checkNow();
});
ipcMain.handle('mypos/update-status', () => {
  return getLastStatus();
});

app.whenReady().then(() => {
  // 로컬 dist/ 서버 마운트 — createWindow 보다 먼저 등록해야 loadWithFallback 이 바로 사용 가능.
  mountLocalServer();
  createWindow();
  // 윈도우 만든 후 자동 업데이트 setup — autoUpdater 이벤트가 모든 윈도우에 broadcast.
  // dev 빌드에서는 setupAutoUpdater 가 'disabled' 상태 setStatus 후 즉시 반환.
  setupAutoUpdater(() => BrowserWindow.getAllWindows());

  // CID 착신 감지 — Electron 에서만 실행. 전화 오면 모든 기기에 Firebase 이벤트 push.
  // IPC 로 렌더러가 storeId 를 전달하면 CID 활성화.
  ipcMain.handle('mypos/start-cid', (_event, storeId) => {
    if (!storeId) return { ok: false };
    startCidListener((phoneNumber, formattedNumber) => {
      // Firebase 에 기록 — 렌더러(웹) 에서 처리
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('mypos/incoming-call', { phoneNumber, formattedNumber, storeId });
        }
      }
    });
    return { ok: true };
  });

  // 키오스크 종료 단축키 — 메뉴바 없어도 사용 가능.
  // Ctrl+Shift+Q: 사장님/직원용 앱 종료. 키오스크 환경에서 Alt+F4 대체.
  globalShortcut.register('CommandOrControl+Shift+Q', () => {
    app.quit();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // 매장 PC = Windows. 모든 창 닫히면 종료. macOS 만의 dock 잔존 동작 회피.
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  // macOS: 도크 클릭 시 창 없으면 새로 생성. Windows 에선 거의 발생 X 지만 안전 차원.
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
