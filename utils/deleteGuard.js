// 대량 삭제 서킷브레이커 — 클라이언트가 서버 문서를 한꺼번에 지우는 것을 막는다.
//
// 2026-08-19 사고: 영업 중 "포스 현황이 다 날아갔다".
//
// 구조적 원인 (제 버그보다 이쪽이 더 근본이다):
//   useOrderFirestoreSync 의 push 는 "내 로컬에 없는데 lastSynced 에 있으면 서버에서
//   지운다" 로 동작한다. **상한이 없다.** 로컬 state 가 한순간 비거나 부분적으로만
//   차 있으면 그 한 대가 서버 문서를 전부 지우고, 그 삭제가 listener 를 타고 모든
//   기기로 전파된다. 이 코드베이스는 로컬↔서버가 어긋나는 사고 이력이 반복적이라
//   (6/30·7/3·7/8·7/15 부활 처방들) 어긋남 자체는 "언젠가 또 생기는 것" 으로 봐야 한다.
//   따라서 어긋남을 없애려 애쓰는 것보다, **어긋났을 때 피해를 상한으로 묶는 것**이
//   실효가 크다.
//
// 정책: 의심스러우면 지우지 않는다.
//   지워야 할 걸 안 지우면 → 화면에 남는다 (사장님이 다시 치우면 끝, 복구 가능).
//   안 지워야 할 걸 지우면  → 데이터가 사라진다 (복구 어려움).
//   두 실패의 무게가 다르므로 한쪽으로 치우치게 설계한다.
//
// 규칙 (정상 영업을 막지 않으면서 "전멸" 만 잡는 최소 조건):
//   1. 3건 이하는 항상 통과 — 테이블 하나씩 치우는 정상 동작.
//   2. 3건 초과 + 전체의 60% 이상을 지우려 함 → **차단**. 이건 정상 영업에 없는 모양이다.
//   3. 그 사이(예: 20개 중 5개)는 통과 — 배달 자동정리 등 정당한 묶음 삭제.

export const MAX_ALWAYS_ALLOWED = 3;
export const WIPE_RATIO = 0.6;

// { allowed, reason } 반환. reason 은 차단 시 사람이 읽을 로그 문구.
export function checkBulkDelete({ label, deleteCount, syncedCount }) {
  const del = Number(deleteCount) || 0;
  const total = Number(syncedCount) || 0;
  if (del <= MAX_ALWAYS_ALLOWED) return { allowed: true, reason: null };
  if (total > 0 && del / total >= WIPE_RATIO) {
    return {
      allowed: false,
      reason:
        `🛑 대량 삭제 차단: ${label} ${del}/${total}건 ` +
        `(전체의 ${Math.round((del / total) * 100)}%). 로컬 상태 이상 의심 — 서버 보존.`,
    };
  }
  return { allowed: true, reason: null };
}

// 로그 폭주 방지 — 차단은 매 push 마다 반복될 수 있으므로 라벨별로 간격을 둔다.
const LOG_INTERVAL_MS = 60000;
const _lastLoggedAt = new Map();

export function shouldLogBlock(label, now) {
  const t = typeof now === 'number' ? now : Date.now();
  const prev = _lastLoggedAt.get(label) || 0;
  if (t - prev < LOG_INTERVAL_MS) return false;
  _lastLoggedAt.set(label, t);
  return true;
}

export function _resetBlockLogForTest() {
  _lastLoggedAt.clear();
}
