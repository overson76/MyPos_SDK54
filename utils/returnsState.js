// 회수 차수의 returnedAt 상태 변환 — 순수 함수.
// useDeliveryRounds 가 setState + Firestore 쓰기에만 집중하도록 변환 로직 분리.
// Jest 단위 테스트로 동작 검증.
//
// returnedAt 정책:
//   - null 또는 undefined → 미회수
//   - number(timestamp) → 회수 완료
//   - 라이더가 매장에서 한 차수 끝낼 때까지 한 곳씩 체크. 모두 끝나면 차수 마감 표시(✅).

// 단일 entry 의 회수 상태 토글. value 가 명시되면 그대로, 아니면 기존값 반전.
// ranked / unknown 양쪽에서 동일 key 찾아 갱신.
export function toggleEntryReturned(round, entryKey, value) {
  if (!round || !round.snapshot) return round;
  const updateArr = (arr) =>
    (arr || []).map((it) => {
      if (it.key !== entryKey) return it;
      const next = value === undefined ? !it.returnedAt : !!value;
      return { ...it, returnedAt: next ? Date.now() : null };
    });
  return {
    ...round,
    snapshot: {
      ...round.snapshot,
      ranked: updateArr(round.snapshot.ranked),
      unknown: updateArr(round.snapshot.unknown),
    },
  };
}

// 차수 전체 회수 처리 — 이미 회수된 entry 는 기존 timestamp 유지(되돌리기 방지).
export function fillAllReturned(round, ts) {
  if (!round || !round.snapshot) return round;
  const now = ts || Date.now();
  const fill = (arr) =>
    (arr || []).map((it) => ({ ...it, returnedAt: it.returnedAt || now }));
  return {
    ...round,
    snapshot: {
      ...round.snapshot,
      ranked: fill(round.snapshot.ranked),
      unknown: fill(round.snapshot.unknown),
    },
  };
}

// 차수 전체 회수 해제 — 사용자가 실수로 모두 회수 눌렀을 때 복구.
export function clearAllReturned(round) {
  if (!round || !round.snapshot) return round;
  const clear = (arr) =>
    (arr || []).map((it) => ({ ...it, returnedAt: null }));
  return {
    ...round,
    snapshot: {
      ...round.snapshot,
      ranked: clear(round.snapshot.ranked),
      unknown: clear(round.snapshot.unknown),
    },
  };
}

// 회수 진행률 — UI 헤더 표시용.
//   { done: 회수된 entry 수, total: 전체 entry 수,
//     complete: total>0 && done===total }
export function getRoundReturnProgress(round) {
  if (!round || !round.snapshot) {
    return { done: 0, total: 0, complete: false };
  }
  const all = [
    ...(round.snapshot.ranked || []),
    ...(round.snapshot.unknown || []),
  ];
  const done = all.filter((it) => !!it.returnedAt).length;
  return { done, total: all.length, complete: all.length > 0 && done === all.length };
}
