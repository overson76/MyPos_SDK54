// 내용 기준 동등 비교 — Firestore push 판정 전용.
//
// 2026-09-11 쓰기 폭발 사고 (하루 쓰기 2만 한도 소진 → 읽기 6.2만 → 서비스 차단):
//   push effect 들이 "보낼 게 있나" 를 참조(===)로만 판정하고 있었다.
//     if (orders[tid] !== synced[tid]) batch.set(...)
//   Firestore 에서 내려오는 데이터는 매 snapshot 마다 새 객체다. 그래서 이 설계는
//   "리듀서가 서버 객체의 참조를 그대로 보존한다" 는 암묵적 전제 위에서만 조용하다.
//   그 전제가 한 번이라도 깨지면:
//     쓰기 → 에코 → 새 객체 → "변경됐다" 오판 → 또 쓰기 → 에코 → …
//   자가증식 쓰기 루프가 된다. 디바운스(300ms)로만 눌리므로 분당 수백 건,
//   한 시간이면 일일 한도 2만에 닿는다. 쓰기 1건은 다른 기기 수만큼 읽기를
//   유발하므로 읽기 한도도 같이 터진다.
//
//   2026-06-10 에도 같은 계통이었다 (ignoredSimilarPairs union 배열이 매번 새
//   참조 → 무한 write → 한도 초과 → 영업 중단). 그때는 그 필드를 Firestore 에서
//   빼는 것으로 개별 대응했지만, 판정 방식 자체는 그대로 남아 있었다.
//
// 그래서 여기서는 근본을 바꾼다: 참조가 달라도 **내용이 같으면 안 쓴다**.
// 참조 일치는 빠른 경로로 먼저 보고(대부분 여기서 끝남), 다를 때만 내용을 본다.
//
// 키 순서는 무시한다 — 로컬에서 만든 객체와 Firestore 가 역직렬화한 객체는
// 키 순서가 다를 수 있어 JSON.stringify 비교로는 오탐이 난다.
// undefined 와 "키 없음" 은 같게 본다 — Firestore 가 undefined 를 저장하지 않으므로
// 왕복하면 키가 사라진다. 이걸 다르다고 보면 그 자체가 영구 루프가 된다.

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// 값이 "없음" 취급인가 (undefined / 키 부재).
function isAbsent(v) {
  return v === undefined;
}

export function deepEqual(a, b) {
  if (a === b) return true; // 빠른 경로 + 원시값

  // NaN === NaN 은 false 지만, 왕복해도 NaN 이므로 같게 본다.
  if (typeof a === 'number' && typeof b === 'number') {
    return Number.isNaN(a) && Number.isNaN(b);
  }

  if (isAbsent(a) || isAbsent(b)) return isAbsent(a) && isAbsent(b);
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false; // 원시값인데 === 아니면 다름

  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr !== bArr) return false;

  if (aArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (!isPlainObject(a) || !isPlainObject(b)) {
    // Date 등 — getTime 비교로 최소 대응, 그 외는 참조가 다르면 다름으로.
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    return false;
  }

  // undefined 값 키는 "없음" 과 같게 봐야 하므로 키 개수 비교를 먼저 하면 안 된다.
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

// push 판정용 — 참조가 같으면 즉시 true(가장 흔한 경로), 아니면 내용 비교.
// 이름을 따로 두는 이유: 호출부에서 "왜 내용까지 보는가" 가 드러나게 하기 위함.
export function sameForSync(a, b) {
  return a === b || deepEqual(a, b);
}
