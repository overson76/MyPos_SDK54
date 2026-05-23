// GitHub Releases 의 latest tag 를 가져와 "최신버전" 표기에 사용.
// 모든 기기 공통 호출 — Cloudflare 웹, Electron .exe, iOS, Android 어디서나 동일.
// GitHub API 는 CORS 허용 + 무인증 시간당 60 회 (매장 단일 PC 운영엔 충분).
// 네트워크 실패 / rate limit / 비공개 repo 모두 null 반환 — UI 는 "확인 불가" 표시.

const RELEASES_API =
  'https://api.github.com/repos/overson76/MyPos_SDK54/releases/latest';

const FETCH_TIMEOUT_MS = 5000;

export async function fetchLatestVersion() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(RELEASES_API, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const data = await res.json();
    // tag_name 형식: "v1.0.52" 또는 "1.0.52" — v 접두사 제거 후 표기.
    const tag = String(data?.tag_name || '').replace(/^v/i, '').trim();
    return tag || null;
  } catch {
    return null;
  }
}

// 단순 semver 비교 — 같으면 0, current 가 더 낮으면 -1, 더 높으면 1.
// 형식 불일치(예: "1.0.52-beta") 는 문자열 직접 비교로 fallback.
export function compareVersions(current, latest) {
  if (!current || !latest) return null;
  if (current === latest) return 0;
  const a = String(current).split('.').map((x) => parseInt(x, 10));
  const b = String(latest).split('.').map((x) => parseInt(x, 10));
  if (a.some(isNaN) || b.some(isNaN)) {
    return current < latest ? -1 : current > latest ? 1 : 0;
  }
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}
