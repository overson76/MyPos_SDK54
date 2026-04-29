// MyPos PC 카운터용 Service Worker.
//
// 전략: network-first + cached fallback.
//   - 매번 네트워크 우선 요청 → 응답 받으면 캐시 갱신
//   - 네트워크 실패 시 캐시된 마지막 응답으로 폴백 → 인터넷 잠시 끊겨도 화면 살아있음
//
// 새 빌드 배포 시 즉시 갱신:
//   - install 단계에서 skipWaiting() → 옛 SW 안 기다림
//   - activate 단계에서 옛 캐시 전부 삭제 + clients.claim() → 모든 탭 즉시 새 SW 제어
//   - 사용자는 새로고침 1회만 하면 새 빌드 활성화 (network-first 라 어차피 다음 fetch 부터 새 응답)
//
// 캐시 제외:
//   - 다른 origin (Firestore / Google APIs / wrangler 외부 호출)
//   - POST 등 비-GET
//   - /api/ 경로 (API 응답은 캐시 부적합)
//   - Firestore SDK 의 자체 IndexedDB persistence 와 영역 분리
//
// CACHE_VERSION 은 SW 코드 변경 시 수동으로 올림. (정적 자산은 fetch 시점에 자동 갱신되므로
// 평소엔 안 건드려도 됨. SW 자체 로직 바꿀 때만.)

const CACHE_VERSION = 'mypos-v1';
const CACHE_NAME = `mypos-${CACHE_VERSION}`;

function shouldCache(reqUrl) {
  try {
    const u = new URL(reqUrl);
    if (u.origin !== self.location.origin) return false;
    if (u.pathname.startsWith('/api/')) return false;
    return true;
  } catch {
    return false;
  }
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (!shouldCache(req.url)) return;

  event.respondWith(
    (async () => {
      try {
        const networkRes = await fetch(req);
        // 200 응답만 캐시 (404/500 등은 캐시 안 함 — 다음 시도 시 다시 네트워크)
        if (networkRes && networkRes.status === 200) {
          const cache = await caches.open(CACHE_NAME);
          // clone 필수: response body 는 한 번만 읽힐 수 있음
          cache.put(req, networkRes.clone()).catch(() => {});
        }
        return networkRes;
      } catch (e) {
        // 네트워크 실패 — 캐시 폴백
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(req);
        if (cached) return cached;
        throw e;
      }
    })()
  );
});
