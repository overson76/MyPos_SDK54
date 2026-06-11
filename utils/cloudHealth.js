// 클라우드(Firestore) 쓰기 실패 상태 — 모듈 단일 진실 소스 (notify.js 의 _volume 패턴).
//
// 2026-06-11 사고 후속: 무료 한도 초과로 쓰기가 전면 차단됐는데 모든 write .catch 가
// Sentry 보고만 하고 조용히 넘어가서, 사장님이 "수정이 자꾸 사라진다"를 3일간
// 화면에서 알 길이 없었다. 실패가 생기면 CloudHealthBanner 가 즉시 빨간 띠를 띄운다.
//
// React 밖 싱글톤인 이유: useOrderFirestoreSync(훅) 와 CloudHealthBanner(컴포넌트) 가
// Provider 계층 어디에 있든 결합 없이 통신해야 해서. 구독자가 없어도 동작에 지장 없음.

let _state = {
  failing: false,
  ctx: null, // 마지막 실패 지점 (예: 'addresses.batch.write')
  code: null, // Firestore 에러 코드 문자열
  count: 0, // 연속 실패 횟수 (성공 시 리셋)
  since: null, // 첫 실패 시각 (epoch ms)
};

const _subs = new Set();

function _emit() {
  _subs.forEach((cb) => {
    try {
      cb(_state);
    } catch (e) {
      // 구독자 오류가 sync 흐름을 깨면 안 됨 — 무시.
    }
  });
}

export function reportWriteFailure(ctx, error) {
  const code = error && (error.code || error.message) ? error.code || error.message : 'unknown';
  _state = {
    failing: true,
    ctx: ctx || null,
    code: String(code),
    count: _state.failing ? _state.count + 1 : 1,
    since: _state.failing ? _state.since : Date.now(),
  };
  _emit();
}

export function reportWriteSuccess() {
  if (!_state.failing) return;
  _state = { failing: false, ctx: null, code: null, count: 0, since: null };
  _emit();
}

export function getCloudHealth() {
  return _state;
}

export function subscribeCloudHealth(cb) {
  _subs.add(cb);
  return () => _subs.delete(cb);
}

// 개발/진단용: 프리뷰·DevTools 콘솔에서 배너를 강제 점등/소등 (window.__cloudHealth).
// 운영(production) 번들에서는 __DEV__ false 라 노출 안 됨.
if (typeof __DEV__ !== 'undefined' && __DEV__ && typeof window !== 'undefined') {
  window.__cloudHealth = { reportWriteFailure, reportWriteSuccess, getCloudHealth };
}

// Firestore 에러 코드 → 사장님이 읽고 행동할 수 있는 한국어 한 줄.
export function describeCloudError(code) {
  const c = String(code || '').toLowerCase();
  if (c.includes('resource-exhausted')) return '사용 한도 초과 — 클라우드 쓰기 차단';
  if (c.includes('permission-denied')) return '권한 오류 — 매장 연동 상태 확인 필요';
  if (c.includes('unavailable') || c.includes('deadline')) return '네트워크 불안정';
  if (c.includes('unauthenticated')) return '로그인 끊김 — 앱 재시작 필요';
  return `오류: ${String(code || 'unknown')}`;
}
