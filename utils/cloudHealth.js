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
  // 함수 선언은 호이스팅되므로 아래쪽에 정의된 리스너 함수들도 여기서 참조 가능.
  window.__cloudHealth = {
    reportWriteFailure,
    reportWriteSuccess,
    getCloudHealth,
    reportListenerFailure,
    reportListenerRecovered,
    resetListenerHealth,
    getListenerHealth,
  };
}

// Firestore 에러 코드 → 사장님이 읽고 행동할 수 있는 한국어 한 줄.
export function describeCloudError(code) {
  const c = String(code || '').toLowerCase();
  if (c.includes('resource-exhausted')) return '사용 한도 초과 — 내일 자동 해제';
  if (c.includes('permission-denied')) return '권한 오류 — 매장 연동 상태 확인 필요';
  if (c.includes('unavailable') || c.includes('deadline')) return '네트워크 불안정';
  if (c.includes('unauthenticated')) return '로그인 끊김 — 앱 재시작 필요';
  return `오류: ${String(code || 'unknown')}`;
}

// ─────────────────────────────────────────────────────────────
// 리스너(읽기) 건강 상태 — 2026-09-11 추가.
//
// 위의 _state 는 *쓰기* 실패만 본다. 2026-06-11 사고가 쓰기 차단이었기 때문.
// 그런데 같은 뿌리(한도/권한)의 반대쪽 — onSnapshot 리스너 사망 — 은 감시 대상이
// 아니었다. 리스너가 죽으면 쓰기는 멀쩡히 성공하므로 빨간 띠가 안 뜨고, 화면도
// 마지막 값으로 멀쩡해 보인다. 기기끼리 어긋나는 것 말고는 증상이 없다.
// subscribeResilient(utils/resilientListener.js) 가 여기에 보고한다.

// ctx → { code, since, retryAt, count }. 살아있는 리스너는 들어있지 않다.
const _down = new Map();

let _listenerState = {
  failing: false,
  ctxs: [],
  code: null,
  since: null,
  retryAt: null, // 가장 이른 재연결 예정 시각
  count: 0,
};

const _listenerSubs = new Set();

function _emitListeners() {
  _listenerSubs.forEach((cb) => {
    try {
      cb(_listenerState);
    } catch (e) {
      // 구독자 오류가 sync 흐름을 깨면 안 됨 — 무시.
    }
  });
}

function _recomputeListeners() {
  if (_down.size === 0) {
    _listenerState = { failing: false, ctxs: [], code: null, since: null, retryAt: null, count: 0 };
    return;
  }
  let since = null;
  let retryAt = null;
  let code = null;
  let count = 0;
  const ctxs = [];
  _down.forEach((v, ctx) => {
    ctxs.push(ctx);
    count += v.count;
    if (since == null || v.since < since) since = v.since;
    if (v.retryAt != null && (retryAt == null || v.retryAt < retryAt)) retryAt = v.retryAt;
    // 한도 초과가 섞여 있으면 그게 대표 — 사장님이 가장 먼저 알아야 할 원인.
    if (code == null || String(v.code).includes('resource-exhausted')) code = v.code;
  });
  ctxs.sort();
  _listenerState = { failing: true, ctxs, code, since, retryAt, count };
}

export function reportListenerFailure(ctx, error, retryAt) {
  const key = ctx || 'listener';
  const code = error && (error.code || error.message) ? error.code || error.message : 'unknown';
  const prev = _down.get(key);
  _down.set(key, {
    code: String(code),
    since: prev ? prev.since : Date.now(),
    retryAt: retryAt != null ? retryAt : null,
    count: prev ? prev.count + 1 : 1,
  });
  _recomputeListeners();
  _emitListeners();
}

// 정상 snapshot 마다 불린다 — 끊긴 적 없으면 즉시 빠져나가야 emit 폭주가 없다.
export function reportListenerRecovered(ctx) {
  const key = ctx || 'listener';
  if (!_down.has(key)) return;
  _down.delete(key);
  _recomputeListeners();
  _emitListeners();
}

export function getListenerHealth() {
  return _listenerState;
}

export function subscribeListenerHealth(cb) {
  _listenerSubs.add(cb);
  return () => _listenerSubs.delete(cb);
}

// 테스트/진단용 — 전체 리셋.
export function resetListenerHealth() {
  if (_down.size === 0) return;
  _down.clear();
  _recomputeListeners();
  _emitListeners();
}
