// Firestore pull(onSnapshot) ↔ 로컬 미전송(dirty) 변경 병합 — 순수 함수 모음.
//
// 2026-06-30 사장님 신고 3종의 근본 처방:
//   "결제/완료 처리한 게 되살아난다" + "실행하다 보면 멈춰있다(조작이 씹힘)"
//
// 구조적 원인: pull 콜백이 서버 snapshot 으로 로컬 state 를 *통째 교체*했음.
//   로컬 조작 → push 는 디바운스(300~500ms) + PC 딜레이로 늦는데, 그 틈에
//   snapshot(다른 기기의 write, 또는 *자기 직전 write 의 echo*)이 도착하면
//   ① 방금 조작이 서버의 옛 상태로 되돌아가고 ② effect 재실행이 디바운스
//   타이머를 취소해 그 조작은 서버로 영영 안 감 — 흔적 없이 소멸.
//   (1.0.51 "PENDING 카트 지워짐" 사고와 같은 계열 — 그땐 PENDING 만 보존 처방)
//
// 원칙: pull 은 "서버 진실 + 아직 안 보낸 내 변경(dirty)" 병합.
//   dirty 판정 = push effect 와 동일한 참조 비교 (local[k] !== lastSynced[k]).
//   dirty 항목은 로컬 값 유지 → lastSynced 는 서버 값으로 전진하므로
//   push effect 가 diff 를 감지해 곧 서버로 밀어냄 (소멸 불가).
//   dirty 가 하나도 없으면 server 객체를 *그대로* 반환 — push effect 의
//   참조 비교(noop)와 기존 테스트(hydrate 가 payload 로 교체) 유지.
//
// 트레이드오프 (의도): 같은 테이블을 두 기기가 "동시에" 편집하면 내 기기가
//   이김(last-write-wins). 드문 진짜 충돌보다 "완료가 소멸"이 훨씬 큰 사고.

// 키-객체 맵 병합 — orders(테이블별) / addressBook.entries(주소 키별) 공용.
// server: snapshot 재구성 결과, local: 현재 state, lastSynced: 마지막 push/pull 시점 ref.
export function mergeKeyedPull(server, local, lastSynced) {
  const srv = server || {};
  const loc = local || {};
  const last = lastSynced || {};
  let merged = null; // 변경 필요할 때만 복사 (없으면 server 그대로)

  // 로컬 dirty(미push 편집/신규) 보존 — 서버 값 대신 로컬 값.
  for (const k of Object.keys(loc)) {
    if (loc[k] !== last[k] && srv[k] !== loc[k]) {
      if (!merged) merged = { ...srv };
      merged[k] = loc[k];
    }
  }
  // 로컬 삭제 미push 보존 — lastSynced 에 있었는데 로컬에서 지운 키는
  // 서버 snapshot 에 아직 남아 있어도 부활시키지 않는다 (결제 완료 = 칸 비움).
  for (const k of Object.keys(last)) {
    if (!(k in loc)) {
      const base = merged || srv;
      if (k in base) {
        if (!merged) merged = { ...srv };
        delete merged[k];
      }
    }
  }
  return merged || srv;
}

// history(배열, id 기반) 병합 — 방금 append 한 결제 기록이 echo/타 기기
// snapshot 에 아직 없어도 소멸하지 않게. 로컬 삭제(되돌리기 정리)도 보존.
export function mergeHistoryPull(server, local, lastSynced) {
  const srv = Array.isArray(server) ? server : [];
  const loc = Array.isArray(local) ? local : [];
  const last = Array.isArray(lastSynced) ? lastSynced : [];
  if (loc === last) return srv; // dirty 없음 — 서버 그대로

  const idOf = (h) => (h && h.id != null ? String(h.id) : null);
  const lastById = new Map(last.map((h) => [idOf(h), h]).filter(([k]) => k));
  const srvIds = new Set(srv.map(idOf).filter(Boolean));

  // 로컬 dirty: lastSynced 와 참조가 다르거나(수정) lastSynced 에 없던(신규) 항목.
  const dirtyNew = [];
  const dirtyById = new Map();
  const locIds = new Set();
  for (const h of loc) {
    const id = idOf(h);
    if (!id) continue;
    locIds.add(id);
    const prev = lastById.get(id);
    if (prev === h) continue; // 변경 없음
    if (srvIds.has(id)) dirtyById.set(id, h); // 서버에도 있는 항목의 로컬 수정 우선
    else dirtyNew.push(h); // 서버에 아직 없는 로컬 신규 (방금 결제)
  }
  // 로컬 삭제 미push: lastSynced 에 있었는데 로컬에 없는 id 는 서버에서 빼고 유지.
  const removed = new Set();
  for (const [id] of lastById) {
    if (!locIds.has(id)) removed.add(id);
  }

  if (dirtyNew.length === 0 && dirtyById.size === 0 && removed.size === 0) {
    return srv;
  }
  const base = srv
    .filter((h) => !removed.has(idOf(h)))
    .map((h) => dirtyById.get(idOf(h)) || h);
  // 신규는 앞에 — appendHistory 가 최신을 앞에 붙이는 규칙과 동일.
  return [...dirtyNew, ...base];
}

// 단일 값(splits/groups/revenue.total) — dirty 면 pull 무시(내 값 유지).
// lastSynced ref 는 호출부가 서버 값으로 전진시키므로 push effect 가 곧 밀어냄.
export function mergeValuePull(server, local, lastSynced) {
  return local === lastSynced ? server : local;
}
