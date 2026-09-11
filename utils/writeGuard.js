// Firestore 쓰기 폭주 차단기 (circuit breaker).
//
// 2026-09-11: 하루 쓰기 2만 한도를 소진해 Firestore 가 통째로 차단됐다. 쓰기 1건이
// 다른 기기 수만큼 읽기 에코를 유발하므로 읽기 한도(5만)도 같이 터져(6.2만) 매장의
// 모든 기기가 서버와 단절됐다. 화면은 로컬 저장본으로 멀쩡히 돌아가서, 기기끼리
// 내용이 다르다는 것 말고는 아무 증상이 없었다.
//
// 원인(참조 비교로 인한 자가증식 쓰기 루프)은 deepEqual 로 제거했지만, 그건 "이번
// 원인" 이다. 2026-06-10 에도 같은 계통의 다른 루프가 있었다. 원인을 하나씩 잡는
// 방식으로는 또 난다 — 그래서 **원인과 무관하게** 비정상 쓰기량 자체를 막는다.
//
// 정책: 정상 매장의 쓰기량을 한참 웃도는 선에서 끊는다. 바쁜 점심에도 분당 수십 건이면
// 충분하므로 분당 상한은 넉넉히 잡되, 루프(분당 수백~수천)는 확실히 걸리게 한다.
// 일일 상한은 무료 한도(2만)의 절반 — 걸려도 그날 영업은 멀쩡하고, 남은 절반이
// 진단·복구 여유분이 된다.

import { loadJSON, saveJSON } from './persistence';
import { reportError } from './sentry';

export const PER_MINUTE_LIMIT = 300;
export const PER_DAY_LIMIT = 10000;

const DAY_KEY = 'writeGuard:day';

let _windowStart = 0;
let _windowCount = 0;
let _dayDate = null; // 'YYYY-MM-DD'
let _dayCount = 0;
let _tripped = null; // null | 'minute' | 'day'
let _hydrated = false;

const _subs = new Set();

function _emit() {
  const snap = getWriteStats();
  for (const cb of _subs) {
    try {
      cb(snap);
    } catch (e) {
      // 구독자 오류가 쓰기 흐름을 깨면 안 됨.
    }
  }
}

function _localDate(now) {
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 앱 시작 시 1회 — 재시작으로 일일 카운터가 리셋되면 상한이 무의미해진다.
export async function hydrateWriteGuard(now = Date.now()) {
  if (_hydrated) return;
  _hydrated = true;
  try {
    const saved = await loadJSON(DAY_KEY, null);
    const today = _localDate(now);
    if (saved && saved.date === today && typeof saved.count === 'number') {
      _dayDate = today;
      _dayCount = saved.count;
      if (_dayCount >= PER_DAY_LIMIT) _tripped = 'day';
      _emit();
    }
  } catch (e) {
    reportError(e, { ctx: 'writeGuard.hydrate' });
  }
}

function _rollDay(now) {
  const today = _localDate(now);
  if (_dayDate !== today) {
    _dayDate = today;
    _dayCount = 0;
    if (_tripped === 'day') _tripped = null;
  }
}

function _rollWindow(now) {
  if (now - _windowStart >= 60000) {
    _windowStart = now;
    _windowCount = 0;
    // 분당 차단은 1분 지나면 자동 해제 — 일시적 폭주면 스스로 회복한다.
    if (_tripped === 'minute') _tripped = null;
  }
}

/**
 * 이번 쓰기(opCount 건)를 보내도 되는가.
 * 한도를 넘기면 false — 호출부는 그 배치를 **보내지 않고** 건너뛴다.
 */
export function canWrite(opCount = 1, now = Date.now()) {
  _rollDay(now);
  _rollWindow(now);
  if (_tripped) return false;
  if (_windowCount + opCount > PER_MINUTE_LIMIT) {
    _tripped = 'minute';
    _emit();
    return false;
  }
  if (_dayCount + opCount > PER_DAY_LIMIT) {
    _tripped = 'day';
    _emit();
    return false;
  }
  return true;
}

/** 실제로 보낸 쓰기 건수를 기록. */
export function noteWrites(opCount = 1, now = Date.now()) {
  if (!opCount || opCount < 0) return;
  _rollDay(now);
  _rollWindow(now);
  if (!_windowStart) _windowStart = now;
  _windowCount += opCount;
  _dayCount += opCount;
  // 영속화는 fire-and-forget — 실패해도 쓰기 흐름에 영향 없음.
  saveJSON(DAY_KEY, { date: _dayDate, count: _dayCount }).catch(() => {});
  _emit();
}

export function getWriteStats() {
  return {
    perMinute: _windowCount,
    perMinuteLimit: PER_MINUTE_LIMIT,
    today: _dayCount,
    todayLimit: PER_DAY_LIMIT,
    tripped: _tripped, // null | 'minute' | 'day'
  };
}

export function subscribeWriteStats(cb) {
  _subs.add(cb);
  return () => _subs.delete(cb);
}

/** 사장님이 관리자 화면에서 수동 해제 (원인을 고친 뒤). */
export function resetWriteGuard(now = Date.now()) {
  _windowStart = now;
  _windowCount = 0;
  _tripped = null;
  _emit();
}

// 테스트 전용 — 모듈 싱글톤 초기화.
export function __resetWriteGuardForTest() {
  _windowStart = 0;
  _windowCount = 0;
  _dayDate = null;
  _dayCount = 0;
  _tripped = null;
  _hydrated = false;
  _subs.clear();
}
