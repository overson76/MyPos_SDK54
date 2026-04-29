// 오프라인 캐시 모듈 — Phase 4.
//
// 전략: network-first + local-bundle-fallback.
//   1. 먼저 라이브 URL(Cloudflare) 로드 시도 → 항상 최신 코드
//   2. 6초 안에 응답 없거나 네트워크 오류 → .exe 안에 번들된 dist/ 폴백
//
// 왜 protocol.handle('mypos://') ?
//   Expo web 빌드가 /_expo/static/... 같은 절대 경로를 사용.
//   file:// 로 index.html 을 로드하면 절대 경로가 file:///_expo/... 가 되어 깨짐.
//   커스텀 scheme 을 http 처럼 동작하게 등록하면 /로 시작하는 경로도 정상 해석.
//
// 등록 시점:
//   app.whenReady() 이전에 protocol.registerSchemesAsPrivileged 호출 필수.
//   → main.js 최상단에서 호출. (app ready 이후엔 스킴 등록 불가 — Electron 제약)

const { protocol, net, app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const SCHEME = 'mypos';

// 번들된 dist/ 경로 — 패키징된 .exe vs dev 빌드 분기.
function getDistPath() {
  if (app.isPackaged) {
    // electron-builder 가 resources/app/ 아래에 파일들을 넣음.
    return path.join(process.resourcesPath, 'app', 'dist');
  }
  // dev 빌드 — 프로젝트 루트의 dist/ (npm run build:web 결과물).
  return path.join(__dirname, '..', 'dist');
}

// 커스텀 scheme 을 http 와 동일하게 privileged 등록.
// 반드시 app.whenReady() 전에 호출.
function registerOfflineScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,      // http 와 같은 URL 파싱 규칙
        secure: true,        // https 처럼 보안 컨텍스트 (fetch, ServiceWorker 가능)
        supportFetchAPI: true,
        stream: true,        // 스트리밍 응답 지원
      },
    },
  ]);
}

// protocol.handle 등록 — app.whenReady() 이후 호출.
// dist/ 가 없으면 false 반환 → loadWithFallback 이 폴백 건너뜀.
function mountLocalServer() {
  const distPath = getDistPath();
  if (!fs.existsSync(distPath)) {
    // eslint-disable-next-line no-console
    console.warn(`[offline] dist/ 없음 (${distPath}). 폴백 비활성화.`);
    return false;
  }

  protocol.handle(SCHEME, (req) => {
    const url = new URL(req.url);
    let filePath = path.join(distPath, url.pathname);

    try {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }
    } catch {
      // 파일 없으면 index.html 로 — SPA 클라이언트 라우팅 대응.
      filePath = path.join(distPath, 'index.html');
    }

    return net.fetch('file://' + filePath.replace(/\\/g, '/'));
  });

  // eslint-disable-next-line no-console
  console.info(`[offline] local server mounted: ${SCHEME}://localhost/ → ${distPath}`);
  return true;
}

function getLocalURL() {
  return `${SCHEME}://localhost/`;
}

// 라이브 URL 로드 시도 → 실패/타임아웃 시 로컬 폴백.
// 반환: Promise<{ source: 'live' | 'local' | 'failed' }>
function loadWithFallback(win, liveUrl, timeoutMs = 6000) {
  const localAvailable = fs.existsSync(getDistPath());
  return new Promise((resolve) => {
    let settled = false;
    const finish = (source) => {
      if (settled) return;
      settled = true;
      resolve({ source });
    };

    const fallback = () => {
      if (settled) return;
      // eslint-disable-next-line no-console
      console.warn(`[offline] 라이브 URL 응답 없음 → 로컬 폴백`);
      if (localAvailable) {
        win.loadURL(getLocalURL())
          .then(() => finish('local'))
          .catch(() => finish('failed'));
      } else {
        finish('failed');
      }
    };

    const timer = setTimeout(fallback, timeoutMs);

    win.loadURL(liveUrl)
      .then(() => {
        clearTimeout(timer);
        finish('live');
      })
      .catch(() => {
        clearTimeout(timer);
        fallback();
      });
  });
}

module.exports = {
  registerOfflineScheme,
  mountLocalServer,
  getLocalURL,
  loadWithFallback,
};
