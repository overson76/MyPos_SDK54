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
//
// 🔴 주의 — 이 상한은 **기기별**이고 서버 한도는 **매장 전체 공유**다.
// 기기가 N대면 서버 입장에선 N배로 쓴다. 일일 상한을 "서버 한도의 절반" 으로 잡으면
// 2대만 돼도 한도를 넘는다. 그래서 기기수를 나눈 값으로 잡는다 (PER_DAY_LIMIT 주석 참조).
// 새 기기 종류가 늘면 그 나눗셈을 다시 해야 한다.

import { loadJSON, saveJSON } from './persistence';
import { reportError } from './sentry';

export const PER_MINUTE_LIMIT = 300;
// 기기 1대당 하루 상한. 상한은 기기마다 따로 세는데 **서버 한도(2만)는 매장 전체가
// 공유**한다 — 3대면 3배로 쓴다. 그래서 "서버 한도의 절반" 이 아니라
// "서버 한도 ÷ 예상 기기수 ÷ 안전계수" 로 잡는다.
//   2만 ÷ 5대 = 4천 → 5대까지 늘려도 합계 2만을 넘지 않는다.
// 정상 영업은 기기당 하루 1천 건대라 충분히 여유가 있다.
// 덧붙여 앱의 "하루" 는 로컬 자정 기준이고 Firestore 할당량은 태평양시 자정
// (한국시간 16시) 기준이라 경계가 어긋난다. 그 어긋남까지 흡수하려면 넉넉한
// 여유가 필요하다 — 이것도 상한을 낮게 잡는 이유.
export const PER_DAY_LIMIT = 4000;

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
    // 정상적으로 큰 배치 하나(오프라인 동안 밀린 변경 일괄 push, 주소록 일괄 정리 등)는
    // 통과시킨다. 이걸 막으면 배치가 상한보다 큰 순간 영원히 못 보내고 교착된다 —
    // 4시 한도 리셋 직후가 정확히 그 상황이다.
    // 루프는 "작은 배치가 쉼 없이" 오는 모양이라 이 예외로 새지 않는다:
    // 창을 이미 쓴 뒤면(_windowCount > 0) 예외 없이 막고, 통과시킨 뒤엔 창이
    // 포화되어 1분간 추가 쓰기가 전부 차단된다.
    if (_windowCount === 0 && _dayCount + opCount <= PER_DAY_LIMIT) {
      return true;
    }
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
