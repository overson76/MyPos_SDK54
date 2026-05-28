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

// 2026-05-28: 사장님 신고 "김해시락국 entry 가 2개. 별칭 같은데 통합 안 됨".
//   같은 alias 의 정식 entry + phone-only entry 가 *별개로* 박혀있는 케이스.
//   원인: 사장님이 시뮬/CID 통합 흐름에서 phone-only entry 생성 → 옛 정식
//   entry 와 phone 다른 케이스 → mergeOrphanPhoneOnlyEntries (phone 매칭 기준)
//   는 안 잡음.
//
// 정책:
//   - 같은 alias 의 정식 entry (label = 주소) + phone-only entry 가 있으면,
//     phone-only 의 phone digits 를 정식 entry 의 phones array 에 추가 + phone-only 삭제.
//   - 정식 entry 둘 (둘 다 주소 entry) 의 alias 같음 — 그대로 유지. 사장님이
//     "집 주소 + 회사 주소" 처럼 의도적으로 다른 주소 등록한 케이스일 수 있음.
// phone-only entry 식별 — __phone: key prefix 또는 "(주소 미입력)" label,
//   또는 label 이 alias 와 같음 (진짜 주소 아님).
//
// 2026-05-28 (2부): 사장님 신고 "모래톱 entry 2개 — label='모래톱'/alias='모래톱'
// 하나 + label='부산 사하구 비봉로54번안길 26-1'/alias='모래톱' 하나".
//   원인: addAddress 의 label 칸에 사장님이 별칭만 입력 → label=alias 박힌
//   pseudo-phone-only entry 가 따로 생성. 같은 alias 의 진짜 주소 entry 와 공존.
//
//   label === alias 인 entry 는 "주소 정보가 사실상 없음" — phone-only-like 로
//   취급 후 진짜 주소 entry 와 통합. 단 mergeSameAliasPhoneOnlyEntries 가
//   "같은 alias 의 정식 entry 가 있을 때만 통합" 정책이라, 한 곳뿐인 가게
//   ("모래톱" 가게 단독 등록) 는 그대로 유지 — 사장님 의도 보호.
function isPhoneOnlyLike(key, entry) {
  if (typeof key === 'string' && key.startsWith('__phone:')) return true;
  const label = (entry?.label || '').trim();
  if (label.startsWith('(주소 미입력)')) return true;
  const alias = (entry?.alias || '').trim();
  if (alias && label === alias) return true;
  return false;
}

export function mergeSameAliasPhoneOnlyEntries(entries) {
  if (!entries || typeof entries !== 'object') return entries;

  // alias → [정식 entry key 들]
  const regularByAlias = {};
  // alias → [phone-only-like entry key 들]
  const phoneOnlyByAlias = {};

  for (const key of Object.keys(entries)) {
    const entry = entries[key];
    if (!entry) continue;
    const alias = (entry.alias || '').trim();
    if (!alias) continue;
    if (isPhoneOnlyLike(key, entry)) {
      (phoneOnlyByAlias[alias] = phoneOnlyByAlias[alias] || []).push(key);
    } else {
      (regularByAlias[alias] = regularByAlias[alias] || []).push(key);
    }
  }

  // 통합 대상 — alias 가 정식 entry 에도 있고 phone-only 에도 있는 경우
  const toDelete = new Set();
  const phonesToAdd = {}; // 정식 key → [추가할 digits]
  for (const alias of Object.keys(phoneOnlyByAlias)) {
    const regularKeys = regularByAlias[alias];
    if (!regularKeys || regularKeys.length === 0) continue;
    // 첫 정식 entry 가 주 entry
    const targetKey = regularKeys[0];
    for (const orphanKey of phoneOnlyByAlias[alias]) {
      const orphan = entries[orphanKey];
      const digits = String(orphan?.phone || '').replace(/\D/g, '');
      if (digits) {
        (phonesToAdd[targetKey] = phonesToAdd[targetKey] || []).push(digits);
      }
      toDelete.add(orphanKey);
    }
  }

  if (toDelete.size === 0) return entries;

  const next = {};
  for (const key of Object.keys(entries)) {
    if (toDelete.has(key)) continue;
    const entry = entries[key];
    const addDigits = phonesToAdd[key];
    if (addDigits && addDigits.length > 0) {
      const existing = collectPhoneDigits(entry);
      const merged = [...existing];
      for (const d of addDigits) {
        if (!merged.includes(d)) merged.push(d);
      }
      next[key] = {
        ...entry,
        phones: merged,
        phone: merged[0] || entry.phone || null,
      };
    } else {
      next[key] = entry;
    }
  }
  return next;
}
