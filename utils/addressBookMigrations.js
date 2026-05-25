// 주소록 1회 청소 마이그레이션 — 순수 함수 모음.
// 부팅 시 useAddressBook 의 hydrate 직후 1회 실행되어, 옛 데이터의 비일관성을
// 자동 정리. 신규 비일관성 생성은 각 헬퍼(addPhoneOnly 등) 의 가드가 차단.

// 2026-05-25: 같은 phone digits 의 정식 entry 와 phone-only entry (__phone:digits)
// 가 동시 존재할 수 있는 옛 데이터 케이스 자동 통합.
//
// 원인: addPhoneOnly 의 옛 중복 가드가 entry.phone 단일 필드만 검사했음 →
//   정식 entry 가 phones array 만 갖고 phone 단일이 비어있는 경우 CID 들어올
//   때마다 phone-only entry 가 별도 생성됨 → CID 매칭 시 phone-only entry
//   (alias 없음) 가 먼저 잡혀 별칭 안 뜸.
//
// 정책:
//   - phone-only entry 의 digits 가 정식 entry 의 phone/phones 와 매치되면
//     phone-only 삭제 (정식 entry 가 우선 — 보통 더 풍부한 정보).
//   - 매치되는 정식 entry 가 없는 phone-only 는 그대로 유지 (사장님이 나중에
//     주소 채울 의미 있는 데이터).
//
// 입력: entries 객체 { key: entry }
// 반환: 변경 없으면 동일 reference, 변경 있으면 새 객체.
//   reference 비교로 setAddressBook noop 가드 가능.
export function mergeOrphanPhoneOnlyEntries(entries) {
  if (!entries || typeof entries !== 'object') return entries;

  const phoneOnlyMap = {}; // digits → orphan key
  const regularEntries = []; // [key, entry] — 정식 entry

  for (const key of Object.keys(entries)) {
    const entry = entries[key];
    if (!entry) continue;
    if (typeof key === 'string' && key.startsWith('__phone:')) {
      const digits = String(entry.phone || '').replace(/\D/g, '');
      if (digits) phoneOnlyMap[digits] = key;
    } else {
      regularEntries.push([key, entry]);
    }
  }

  if (Object.keys(phoneOnlyMap).length === 0) return entries;

  const toDelete = new Set();
  for (const [, regularEntry] of regularEntries) {
    const phones = collectPhoneDigits(regularEntry);
    for (const d of phones) {
      const orphanKey = phoneOnlyMap[d];
      if (orphanKey) toDelete.add(orphanKey);
    }
  }

  if (toDelete.size === 0) return entries;

  const next = {};
  for (const key of Object.keys(entries)) {
    if (!toDelete.has(key)) next[key] = entries[key];
  }
  return next;
}

// entry 의 phone + phones array 를 통합한 digits 배열. 중복 제거.
export function collectPhoneDigits(entry) {
  if (!entry) return [];
  const out = [];
  if (Array.isArray(entry.phones)) {
    for (const p of entry.phones) {
      const d = String(p || '').replace(/\D/g, '');
      if (d && !out.includes(d)) out.push(d);
    }
  }
  if (entry.phone) {
    const d = String(entry.phone).replace(/\D/g, '');
    if (d && !out.includes(d)) out.push(d);
  }
  return out;
}

// entries 안에 주어진 digits 가 어디든 등록돼 있는지 — addPhoneOnly 중복 가드용.
// phone 단일 / phones array 둘 다 검사 (옛 가드는 phone 만 봤음 — 2026-05-25 버그).
export function hasPhoneDigitsAnywhere(entries, digits) {
  if (!entries || !digits) return false;
  const target = String(digits).replace(/\D/g, '');
  if (!target) return false;
  for (const key of Object.keys(entries)) {
    const e = entries[key];
    if (!e) continue;
    if (collectPhoneDigits(e).includes(target)) return true;
  }
  return false;
}
