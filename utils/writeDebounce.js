// Firestore push 디바운스의 "최대 대기" 계산 — 순수 함수.
//
// 2026-08-12 🔴 사장님 신고 근본처방: "딜레이 때문에 치우면 지워졌다가 다시 되살아난다".
//
// 옛 구조의 구멍 — **디바운스 기아(starvation)**:
//   push effect 는 orders 가 바뀔 때마다 이전 타이머를 취소하고 300ms 뒤로 다시 잡는다.
//   그런데 orders 는 *내 조작* 뿐 아니라 **다른 기기의 snapshot 이 올 때마다도** 바뀐다
//   (listener 가 매번 새 객체를 만들어 hydrate 하므로 내용이 같아도 참조가 바뀜).
//   그래서 매장이 바쁘거나(아이패드·주방에서 계속 write) 기기가 느려서 콜백이 밀리면
//   snapshot 이 300ms 보다 촘촘히 도착 → 타이머가 매번 리셋 → **커밋이 영영 안 뜬다**.
//
//   결과: 사장님이 테이블을 치우면 화면에서는 사라지는데(로컬 삭제) 그 삭제가 서버로
//   못 간다. mergeKeyedPull 이 "미push 로컬 삭제"를 계속 지켜주므로 그 기기에서는
//   멀쩡해 보이지만, 서버엔 그대로 살아 있다 → 새로고침 / 재시작 / 재접속으로 첫
//   snapshot(전체 교체)이 오는 순간 되살아난다. 느린 기기(저사양 PC·안드로이드 탭)
//   에서만 재현되고 빠른 아이패드는 멀쩡한 이유도 이 기아 조건이 CPU 속도에 걸려서다.
//
// 처방: 디바운스에 **상한(maxWait)** 을 둔다. 첫 dirty 시점부터 maxWait 이 지나면
//   더 미루지 않고 즉시 커밋. 쓰기가 *늦어질* 뿐 *사라질* 수는 없게 만든다.
//   (쓰기 횟수는 컬렉션당 maxWait 에 1회로 여전히 상한 — 6/11 쓰기한도 사고와 무관.)

// firstDirtyAt: 현재 dirty 구간이 시작된 시각(0 = 방금 시작). 반환값은 setTimeout 지연.
export function computeDebounceDelay(debounceMs, maxWaitMs, firstDirtyAt, now) {
  const base = Math.max(0, Number(debounceMs) || 0);
  const max = Math.max(0, Number(maxWaitMs) || 0);
  if (!firstDirtyAt) return base; // dirty 구간 시작 — 평소 디바운스 그대로
  const waited = Math.max(0, now - firstDirtyAt);
  return Math.max(0, Math.min(base, max - waited));
}
