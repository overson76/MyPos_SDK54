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

// 라이브 URL 만 로드. 실패 시 자동 재시도 (3초 간격).
// 이전엔 mypos:// 로컬 폴백을 썼지만, origin 이 달라져서 Firebase 익명 UID 가 매번 바뀜
// → 매장 멤버십 잃음 → 매일 아침 연동 끊김 사고. 폴백 제거가 근본 처방.
//
// 매장 PC 는 카드 결제 등으로 항상 인터넷이 필요하므로 로컬 폴백의 가치보다 origin 통일이 더 중요.
// 인터넷이 일시 끊겨도 재시도 루프가 자동으로 복구.
//
// 반환: Promise<{ source: 'live' }> — 로드 성공할 때까지 기다림.
function loadWithFallback(win, liveUrl, retryDelayMs = 3000) {
  // eslint-disable-next-line no-console
  console.info(`[load] 라이브 URL 만 사용 (mypos:// 폴백 제거됨)`);

  const tryLoad = async () => {
    try {
      await win.loadURL(liveUrl);
      // eslint-disable-next-line no-console
      console.info(`[load] 라이브 URL 로드 성공`);
      return { source: 'live' };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[load] 라이브 URL 실패 (${e?.message}) → ${retryDelayMs / 1000}s 후 재시도`);
      // 사용자한테 시각적 피드백 — 간단한 안내 페이지 띄움.
      try {
        const html =
          'data:text/html;charset=utf-8,' +
          encodeURIComponent(
            '<!doctype html><html><head><meta charset="utf-8"><title>MyPos 연결 중</title>' +
            '<style>body{background:#1F2937;color:#fff;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}' +
            '.card{text-align:center}h1{font-size:32px;margin:0 0 12px}p{color:#9ca3af;margin:0 0 8px}</style></head>' +
            '<body><div class="card"><h1>MyPos</h1><p>인터넷 연결 확인 중...</p>' +
            '<p style="font-size:12px">자동으로 재시도 합니다</p></div></body></html>'
          );
        await win.loadURL(html);
      } catch {}
      await new Promise((r) => setTimeout(r, retryDelayMs));
      return tryLoad(); // 재귀 재시도
    }
  };

  return tryLoad();
}

module.exports = {
  registerOfflineScheme,
  mountLocalServer,
  getLocalURL,
  loadWithFallback,
};
