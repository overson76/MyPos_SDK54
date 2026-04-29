// 웹 전용 PWA 메타 주입.
// Why: Expo Web 의 자동 생성 index.html 에 매니페스트 / theme-color / apple-touch-icon
// 태그가 없음. 마운트 시점에 head 에 동적 삽입해서 브라우저가 "앱 설치" 가능하도록 표시.
// JS 로 늦게 삽입돼도 브라우저는 매니페스트를 다시 읽어서 install prompt 를 띄움 (확인됨).

function appendOnce(tagName, attrs, matchKeys) {
  if (typeof document === 'undefined' || !document.head) return;

  // 매칭 selector — rel/name 같은 식별자 키로 중복 삽입 방지
  const selectorParts = [tagName];
  for (const k of matchKeys) {
    if (attrs[k]) selectorParts.push(`[${k}="${attrs[k]}"]`);
  }
  if (document.head.querySelector(selectorParts.join(''))) return;

  const el = document.createElement(tagName);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.head.appendChild(el);
}

// SW 등록은 production 빌드에서만. dev 서버에서는 Metro/HMR 과 캐싱이 충돌하여
// 코드 변경이 안 보이는 사고가 잘 일어남. __DEV__ 는 RN/Expo 환경 변수 — production 에서는 false.
function registerServiceWorker() {
  if (typeof __DEV__ !== 'undefined' && __DEV__) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (typeof window === 'undefined') return;

  // load 후 등록 — 첫 페이지 로드 성능 영향 최소화
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // eslint-disable-next-line no-console
        console.info('[pwa] SW registered, scope:', reg.scope);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[pwa] SW register failed:', err);
      });
  });
}

export function setupPwa() {
  // 1) Web App Manifest — Android Chrome / Edge "앱으로 설치" 활성
  appendOnce('link', { rel: 'manifest', href: '/manifest.webmanifest' }, ['rel']);

  // 2) Theme color — 모바일 브라우저 상단 바 색상
  appendOnce('meta', { name: 'theme-color', content: '#1F2937' }, ['name']);

  // 3) iOS Safari "홈 화면에 추가" 대응
  appendOnce('link', { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }, ['rel']);
  appendOnce('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' }, ['name']);
  appendOnce(
    'meta',
    { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
    ['name']
  );
  appendOnce('meta', { name: 'apple-mobile-web-app-title', content: 'MyPos' }, ['name']);

  // 4) Service Worker — 인터넷 끊겨도 화면 살아있음 + 재방문 빠름. production 만.
  registerServiceWorker();
}
