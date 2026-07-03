// 성능 진단 — 메인스레드 블로킹(long task) 자동 감지. 관찰만(동작 무변경).
//
// 2026-07-03: 카운터 PC(저사양) "응답 없는 페이지" 멈춤의 범인 추적. 추측 수술
// 대신 실측 — 브라우저 내장 PerformanceObserver('longtask') 로 200ms 이상
// 메인스레드 블로킹을 시각·길이·직전 액션과 함께 링버퍼에 기록. 관리자 →
// 시스템 → 🩺 성능 진단 에서 확인(F12 없이). 멈춤이 재현되면 그 스냅샷이 범인.
//
// longtask API 는 Chromium(EXE)·Chrome(웹) 지원. 폰(iOS) 미지원이나 폰은 빠르니 무관.

const THRESHOLD_MS = 200; // 이 이상 블로킹만 기록 (정상 렌더 노이즈 제외)
const NEAR_ACTION_MS = 4000; // 블로킹 직전 이 시간 안의 사용자 액션을 원인 후보로
const MAX = 60;

const _log = []; // { ts, duration, action }
const _subs = new Set();
let _observer = null;
let _lastAction = null; // { label, at }

function _emit() {
  for (const cb of _subs) {
    try {
      cb(_log);
    } catch (_) {}
  }
}

// 사용자 액션 라벨 표시 — 결제/주문 등 눌린 직후 블로킹의 원인 후보로 붙는다.
export function markPerfAction(label) {
  _lastAction = { label: String(label || ''), at: _now() };
}

function _now() {
  // Date.now 대체 (workflow 제약 무관 — 런타임 코드). performance.now 는 상대값이라
  // 시각 표시엔 Date 필요하나, 여기선 지속시간·상대 비교만 — Date.now 안전.
  return Date.now();
}

export function startPerfDiag() {
  if (_observer) return;
  if (typeof PerformanceObserver === 'undefined') return;
  try {
    _observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.duration < THRESHOLD_MS) continue;
        const action =
          _lastAction && _now() - _lastAction.at < NEAR_ACTION_MS
            ? _lastAction.label
            : null;
        _log.unshift({
          ts: _now(),
          duration: Math.round(e.duration),
          action,
        });
        if (_log.length > MAX) _log.pop();
        if (typeof console !== 'undefined') {
          console.warn(
            `[PERF] 메인스레드 ${Math.round(e.duration)}ms 블로킹` +
              (action ? ` — 직전 액션: ${action}` : '')
          );
        }
        _emit();
      }
    });
    _observer.observe({ entryTypes: ['longtask'] });
  } catch (_) {
    // 미지원 브라우저 — 조용히 무시.
  }
}

export function getPerfLog() {
  return _log.slice();
}

export function clearPerfLog() {
  _log.length = 0;
  _emit();
}

export function subscribePerfLog(cb) {
  _subs.add(cb);
  return () => _subs.delete(cb);
}

// 이름표 계측 — 배경 작업(저장/직렬화/리스너)을 감싸 200ms 이상 걸리면 그 *이름*을
// 기록. longtask 는 "무엇이" 느린지 안 알려주므로, 유력 지점을 직접 감싸 범인 특정.
// (동기 함수 전용 — JSON.stringify/parse, 리스너 콜백 동기부 등.)
export function measurePerf(label, fn) {
  const t0 = _now();
  try {
    return fn();
  } finally {
    const dt = _now() - t0;
    if (dt >= THRESHOLD_MS) {
      _log.unshift({ ts: _now(), duration: Math.round(dt), action: `⚙ ${label}` });
      if (_log.length > MAX) _log.pop();
      if (typeof console !== 'undefined') {
        console.warn(`[PERF] ${label} ${Math.round(dt)}ms`);
      }
      _emit();
    }
  }
}

// 임계 무관 정보 기록 — 크기 이상 등 "느림은 아니지만 원인 후보" 신호를 진단
// 목록에 남긴다 (duration 0 으로 구분). 예: "⚠ orders 크기 8000KB".
export function notePerfInfo(label) {
  _log.unshift({ ts: _now(), duration: 0, action: String(label || ''), info: true });
  if (_log.length > MAX) _log.pop();
  if (typeof console !== 'undefined') console.warn(`[PERF] ${label}`);
  _emit();
}

// 링버퍼 요약 — 블로킹 건수 + 최대·합계(진단 한눈에).
export function summarizePerfLog(log = _log) {
  const list = Array.isArray(log) ? log : [];
  if (list.length === 0) return { count: 0, maxMs: 0, totalMs: 0, byAction: {} };
  let maxMs = 0;
  let totalMs = 0;
  const byAction = {};
  for (const e of list) {
    maxMs = Math.max(maxMs, e.duration);
    totalMs += e.duration;
    const k = e.action || '(액션 없음/배경)';
    byAction[k] = (byAction[k] || 0) + 1;
  }
  return { count: list.length, maxMs, totalMs, byAction };
}
