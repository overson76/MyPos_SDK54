// Firestore 실시간 구독(onSnapshot) 자동 재연결 래퍼.
//
// 2026-09-11 사고: Firestore 의 onSnapshot 은 에러가 나면 그 자리에서 *종료*되고
// 스스로 다시 붙지 않는다. 그런데 앱의 리스너 33개가 전부 에러 콜백에서
// reportError(Sentry 보고)만 하고 끝나서, 한도 초과/권한 오류가 한 번 스치면
// 리스너가 조용히 죽고 앱 재시작 전까지 영영 안 돌아왔다.
//   → 로컬 상태는 마지막 값 그대로라 화면은 멀쩡
//   → 쓰기는 성공하니 CloudHealthBanner 도 안 뜸 (그 배너는 write 만 감시)
//   → 기기마다 죽은 시점이 달라 "기기끼리 안 맞음" 으로만 드러남
// 사장님이 3번째로 신고한 "연동 또 풀렸다" 의 정체.
//
// 방아쇠는 Blaze(종량제) → Spark(무료) 다운그레이드. 종량제엔 일일 한도가 없어
// resource-exhausted 가 날 일이 없었는데, 무료로 내려가며 읽기 5만/쓰기 2만이 부활했다.

import { reportError } from './sentry';
import { reportListenerFailure, reportListenerRecovered } from './cloudHealth';

// 일반 오류(네트워크 등) — 빠르게 붙되 금방 상한에 도달.
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 60000;
// 사람 손이 필요한 오류 — 기계적 재시도로는 절대 안 풀린다.
//   resource-exhausted: 자정 한도 리셋까지 기다려야 하고, 재구독 자체가 읽기를 더 태운다.
//     (2026-06-10 union 무한루프로 한도를 넘겨 영업이 중단된 전례)
//   permission-denied: 매장 재연동이나 규칙 수정이 있어야 풀린다. 복구되면 어차피
//     StoreContext 가 effect 를 다시 돌려 새로 구독하므로 여기서 조급할 이유가 없다.
// 둘 다 배너로 사장님께 보이고, 즉시 복구는 retryAllListenersNow() 가 맡는다.
const SLOW_BASE_DELAY_MS = 60000;
const SLOW_MAX_DELAY_MS = 300000;

function isSlowCode(code) {
  const c = String(code || '').toLowerCase();
  return c.includes('resource-exhausted') || c.includes('permission-denied');
}

// 지수 백오프. attempt 는 1 부터 (첫 실패 = 1).
export function computeRetryDelay(attempt, code) {
  const slow = isSlowCode(code);
  const base = slow ? SLOW_BASE_DELAY_MS : BASE_DELAY_MS;
  const cap = slow ? SLOW_MAX_DELAY_MS : MAX_DELAY_MS;
  const n = Math.max(1, Math.floor(attempt));
  // 2 ** (n-1) 가 매우 커지면 Infinity 가 되므로 지수 자체를 먼저 제한.
  const steps = Math.min(n - 1, 20);
  return Math.min(base * Math.pow(2, steps), cap);
}

// ±25% 흔들기 — 리스너 15개가 같은 순간에 몰려 재시도하면 그 자체가 한도를 태운다.
export function applyJitter(delay, rnd = Math.random) {
  const factor = 0.75 + rnd() * 0.5;
  return Math.round(delay * factor);
}

// 백오프 대기 중인 리스너들. 한도 초과는 최대 5분을 기다리는데, 사장님이 결제 문제를
// 고쳤거나 자정이 지나 한도가 풀린 순간에 5분을 더 기다릴 이유가 없다.
// 앱이 포그라운드로 돌아올 때 + 관리자 화면의 "지금 재연결" 버튼이 이걸 부른다.
const _waiting = new Set();

// 대기 중인 리스너를 전부 즉시 재연결. 반환값 = 깨운 개수.
export function retryAllListenersNow() {
  const pending = Array.from(_waiting);
  let woke = 0;
  pending.forEach((h) => {
    if (h.retryNow()) woke += 1;
  });
  return woke;
}

export function getPendingRetryCount() {
  return _waiting.size;
}

/**
 * ref.onSnapshot 을 감싸 에러 시 지수 백오프로 자동 재구독한다.
 *
 * @param ref Firestore CollectionReference | DocumentReference (onSnapshot 보유)
 * @param onNext snapshot 콜백. 여기서 throw 해도 리스너를 죽이지 않는다.
 * @param opts.ctx 진단용 이름 (예: 'orders.listener'). 배너에 표시됨.
 * @param opts.extra Sentry 에 함께 보낼 추가 필드 (예: { storeId }).
 * @returns unsubscribe — 호출 시 재연결 타이머까지 정리.
 */
export function subscribeResilient(ref, onNext, opts = {}) {
  const ctx = opts.ctx || 'listener';
  const extra = opts.extra || null;
  const rnd = opts.random || Math.random;
  const setTimer = opts.setTimeout || setTimeout;
  const clearTimer = opts.clearTimeout || clearTimeout;
  const now = opts.now || (() => Date.now());

  let unsub = null;
  let timer = null;
  let attempt = 0;
  let stopped = false;

  // retryAllListenersNow() 가 잡아 깨울 수 있는 핸들. 대기 중일 때만 _waiting 에 있다.
  const handle = {
    ctx,
    retryNow() {
      if (stopped) return false;
      if (timer) {
        clearTimer(timer);
        timer = null;
      }
      _waiting.delete(handle);
      attach();
      return true;
    },
  };

  function detach() {
    if (!unsub) return;
    try {
      unsub();
    } catch (e) {
      // 이미 끊긴 리스너 해제 — 무시.
    }
    unsub = null;
  }

  function handleError(err) {
    if (stopped) return;
    detach();
    attempt += 1;
    reportError(err, extra ? { ctx, attempt, ...extra } : { ctx, attempt });
    const code = err && (err.code || err.message);
    const delay = applyJitter(computeRetryDelay(attempt, code), rnd);
    reportListenerFailure(ctx, err, now() + delay);
    _waiting.add(handle);
    timer = setTimer(() => {
      timer = null;
      _waiting.delete(handle);
      attach();
    }, delay);
  }

  function attach() {
    if (stopped) return;
    try {
      unsub = ref.onSnapshot(
        (snap) => {
          if (stopped) return;
          // 서버가 응답했다 = 리스너 살아있음. 실패 기록부터 지운다.
          attempt = 0;
          reportListenerRecovered(ctx);
          try {
            onNext(snap);
          } catch (e) {
            // 핸들러 예외가 구독을 끊지 않게 격리 — 데이터 한 건이 망가져도 sync 는 계속.
            reportError(e, { ctx: `${ctx}.handler` });
          }
        },
        (err) => handleError(err)
      );
    } catch (e) {
      // onSnapshot 자체가 던지는 경우 (ref 무효 등)
      handleError(e);
    }
  }

  attach();

  return () => {
    stopped = true;
    _waiting.delete(handle);
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
    detach();
    // 화면 전환/매장 변경으로 인한 정상 해제는 장애가 아니다 — 배너에서 내린다.
    reportListenerRecovered(ctx);
  };
}
