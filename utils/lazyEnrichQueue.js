// 주소록 항목을 배경에서 보강(좌표 변환 / 도로거리)하는 공용 큐.
//
// 2026-08-12 🔴 전수조사 B1·B2 처방.
//
// 옛 구조의 문제 (useAddressBook 좌표변환 · AddressBookPanel 도로거리 두 곳 동형):
//   ① **동시 호출 상한 없음** — 좌표 없는 항목이 50개면 카카오 요청 50건을 한꺼번에
//      발사했다. 브라우저는 호스트당 동시 연결이 6개 남짓이라 나머지는 큐에 쌓이고,
//      그 뒤에 선 **Firestore 요청까지 같이 막힌다** — 주문/결제가 느려지는 실체.
//   ② **결과 하나마다 setAddressBook** — 50건이면 전체 앱 리렌더 50회 + Firestore
//      write 50건. 6/11 "저장 횟수 오버" 와 같은 계열의 배경 쓰기 폭주.
//
// 처방: 동시 실행을 limit 로 묶고, 결과는 모았다가 flushMs 마다 한 번에 반영.
//   50회 리렌더 → 보통 1~2회. 카카오 동시 호출 50 → 3.
//
// 성공한 키는 inFlight 에서 빼지 않는다 — 반영(flush) 전에 스캔이 다시 돌아도 같은
// 항목을 재요청하지 않게. flush 후엔 항목에 값이 박혀 스캔이 자연히 건너뛴다.

const DEFAULT_LIMIT = 3;
const DEFAULT_FLUSH_MS = 400;

// apply(batch) — batch: [{ key, patch }]. 호출부가 한 번의 setState 로 전부 반영한다.
export function createLazyEnrichQueue({
  limit = DEFAULT_LIMIT,
  flushMs = DEFAULT_FLUSH_MS,
  apply,
} = {}) {
  const inFlight = new Set(); // 요청 발사됨 (성공 후에도 유지 — 위 주석)
  const failed = new Set(); // 일시 실패 — 앱 재시작 시 재시도 (메모리 only)
  const waiting = []; // { key, run }
  let running = 0;
  let pending = []; // 반영 대기 결과
  let flushTimer = null;

  function flushNow() {
    flushTimer = null;
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    if (typeof apply === 'function') apply(batch);
  }

  // 결과가 생길 때마다 예약 — 이미 예약돼 있으면 그 타이머에 합류(코얼레싱).
  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(flushNow, flushMs);
  }

  function settle(job, patch) {
    running -= 1;
    if (patch) {
      pending.push({ key: job.key, patch });
      scheduleFlush();
    } else {
      // 실패/무효 — 다시 시도할 수 있도록 inFlight 에서 빼고 실패로 표시.
      inFlight.delete(job.key);
      failed.add(job.key);
    }
    pump();
  }

  function pump() {
    while (running < limit && waiting.length > 0) {
      const job = waiting.shift();
      running += 1;
      Promise.resolve()
        .then(job.run)
        .then(
          (patch) => settle(job, patch),
          () => settle(job, null)
        );
    }
  }

  return {
    // key 를 아직 안 건드렸으면 run() 을 큐에 넣는다.
    // run 은 성공 시 patch 객체, 실패/무효면 null 을 resolve 해야 한다.
    enqueue(key, run) {
      if (key == null) return false;
      if (inFlight.has(key) || failed.has(key)) return false;
      inFlight.add(key);
      waiting.push({ key, run });
      pump();
      return true;
    },
    // 매장 좌표 변경 등으로 전부 다시 계산해야 할 때.
    reset() {
      inFlight.clear();
      failed.clear();
      waiting.length = 0;
      pending = [];
      running = 0;
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
    },
    stats() {
      return {
        inFlight: inFlight.size,
        failed: failed.size,
        waiting: waiting.length,
        running,
        pending: pending.length,
      };
    },
  };
}
