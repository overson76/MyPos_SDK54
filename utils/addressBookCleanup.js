// 주소록 자동 정리 — 중복 entry 통합 + 비슷한 상호 병합. 순수 함수 모음.
// 2026-06-04: 사장님 요청 "클릭 한 번으로 주소록 정리. 오타/잘못 기입/조작 미숙
//   실수를 효율적으로 정리". AddressBookCleanupModal 이 이 함수들로 분석 → 사장님
//   확인 → 통합 적용.
//
// 두 종류 중복:
//   A. 같은 전화번호가 여러 entry 에 흩어짐 (CID phone-only + 별칭 단 것 등)
//   B. 비슷한 상호 (부분 포함 — "탑마트" vs "신평 탑마트")
//
// 정책:
//   - A 는 안전 (같은 번호 = 같은 손님) → 기본 통합 ON.
//   - B 는 사장님 판단 (다른 가게일 수 있음) → 기본 OFF, 사장님이 "같은 곳" 선택 시만.
//   - 통합 시 survivor(살릴 entry) = 정보 풍부한 쪽 (주소 > 별칭 > 주문횟수).
//     나머지의 전번/주문횟수/별칭/주소를 survivor 로 흡수 후 삭제.

import { normalizePhoneDigits } from './addressBookLookup';

// entry 의 모든 전화번호 digits — phone/phones 필드 + label/key 텍스트의 전화 패턴.
// CID phone-only entry 는 phone 필드가 비고 label/key 에만 번호 있는 경우도 있어 텍스트도 스캔.
export function entryPhoneDigits(key, entry) {
  if (!entry) return [];
  const set = new Set();
  const add = (v) => {
    const d = normalizePhoneDigits(v);
    if (d && d.length >= 9) set.add(d);
  };
  if (entry.phone) add(entry.phone);
  if (Array.isArray(entry.phones)) entry.phones.forEach(add);
  const txt = `${entry.label || ''} ${key || ''}`;
  const m = txt.match(/0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}/g);
  if (m) m.forEach(add);
  return [...set];
}

// 진짜 주소 있는 entry 인지 (placeholder/별칭과 다른 실제 주소 label).
export function hasRealAddress(entry) {
  if (!entry) return false;
  const label = (entry.label || '').trim();
  const alias = (entry.alias || '').trim();
  return !!label && !label.startsWith('(주소 미입력)') && label !== alias;
}

// 유효 별칭 (placeholder 아님).
export function realAlias(entry) {
  const a = (entry?.alias || '').trim();
  return a && !a.startsWith('(주소 미입력)') ? a : '';
}

// survivor 추천 점수 — 높을수록 살림. 주소 > 별칭 > 주문횟수 > 먼저 본 것.
export function entryScore(key, entry) {
  let s = 0;
  if (hasRealAddress(entry)) s += 100000;
  if (realAlias(entry)) s += 10000;
  s += (entry?.count || 0) * 10;
  // firstSeenAt 오래될수록 약간 우대 (tie-break) — 작은 값에 큰 가중.
  if (typeof entry?.firstSeenAt === 'number') {
    s += Math.max(0, 100 - entry.firstSeenAt / 1e13);
  }
  return s;
}

// ── A. 같은 전화번호 중복 그룹 ──
// 반환: [{ phone, survivorKey, mergeKeys, keys }] — survivor 는 점수 최고.
export function findPhoneDuplicates(entries) {
  if (!entries || typeof entries !== 'object') return [];
  const byPhone = {};
  for (const k of Object.keys(entries)) {
    for (const d of entryPhoneDigits(k, entries[k])) {
      (byPhone[d] = byPhone[d] || []).push(k);
    }
  }
  const groups = [];
  for (const [phone, keys] of Object.entries(byPhone)) {
    const uniq = [...new Set(keys)];
    if (uniq.length < 2) continue;
    const sorted = uniq.sort(
      (a, b) => entryScore(b, entries[b]) - entryScore(a, entries[a])
    );
    groups.push({
      phone,
      survivorKey: sorted[0],
      mergeKeys: sorted.slice(1),
      keys: uniq,
    });
  }
  return groups;
}

// 비슷한 상호 쌍의 안정 키 — 두 entry key 를 정렬해 조합(순서 무관).
// "다른 가게" 무시 목록 / 후보 매칭에 공통 사용.
export function similarPairKey(keyA, keyB) {
  return [keyA, keyB].sort().join('||');
}

// ── B. 비슷한 상호 쌍 (부분 포함, 정확 일치 제외) ──
// 반환: [{ a, b, keyA, keyB, survivorKey, mergeKey }] — survivor 는 점수 높은 쪽.
// 2026-06-05: ignoredPairKeys — 사장님이 "다른 가게" 로 확정한 쌍은 후보에서 제외
//   (계속 다시 뜨던 문제 처방). 배열 또는 Set 둘 다 허용.
export function findSimilarAliasPairs(entries, ignoredPairKeys) {
  if (!entries || typeof entries !== 'object') return [];
  const ignored =
    ignoredPairKeys instanceof Set
      ? ignoredPairKeys
      : new Set(ignoredPairKeys || []);
  // alias → 대표 key (점수 최고 1개)
  const aliasKey = {};
  for (const k of Object.keys(entries)) {
    const a = realAlias(entries[k]);
    if (!a) continue;
    if (!aliasKey[a] || entryScore(k, entries[k]) > entryScore(aliasKey[a], entries[aliasKey[a]])) {
      aliasKey[a] = k;
    }
  }
  const aliases = Object.keys(aliasKey);
  const pairs = [];
  for (let i = 0; i < aliases.length; i++) {
    for (let j = i + 1; j < aliases.length; j++) {
      const a = aliases[i];
      const b = aliases[j];
      const la = a.toLowerCase();
      const lb = b.toLowerCase();
      if (la === lb) continue;
      if (la.includes(lb) || lb.includes(la)) {
        const keyA = aliasKey[a];
        const keyB = aliasKey[b];
        if (ignored.has(similarPairKey(keyA, keyB))) continue; // "다른 가게" 확정 — 숨김
        // survivor = 점수 높은 쪽 (보통 주소/주문 많은 정식 entry)
        const aWins = entryScore(keyA, entries[keyA]) >= entryScore(keyB, entries[keyB]);
        pairs.push({
          a,
          b,
          keyA,
          keyB,
          survivorKey: aWins ? keyA : keyB,
          mergeKey: aWins ? keyB : keyA,
        });
      }
    }
  }
  return pairs;
}

// ── C. 불완전 entry — 전화/별칭/주소 중 "하나만" 있는 항목 (새 저장 정책 위반) ──
// 반환: [{ key, kind, display, count }]. kind: 'phone'(번호만)|'alias'(별칭만)|'address'(주소만).
//   번호만 → 별칭만 → 주소만 순, 그 안에서 주문 적은 것(삭제 후보) 먼저.
//   2개 이상(전화+주소 등) = 정상 → 제외. 0개(빈 entry) → 제외.
export function findIncompleteEntries(entries) {
  if (!entries || typeof entries !== 'object') return [];
  const out = [];
  for (const k of Object.keys(entries)) {
    const e = entries[k];
    if (!e) continue;
    const hasAlias = !!realAlias(e);
    const hasAddr = hasRealAddress(e);
    const phones = entryPhoneDigits(k, e);
    const hasPhone = phones.length > 0;
    const cnt = (hasAlias ? 1 : 0) + (hasAddr ? 1 : 0) + (hasPhone ? 1 : 0);
    if (cnt !== 1) continue;
    let kind;
    let display;
    if (hasPhone) {
      kind = 'phone';
      display = phones[0];
    } else if (hasAlias) {
      kind = 'alias';
      display = realAlias(e);
    } else {
      kind = 'address';
      display = e.label;
    }
    out.push({ key: k, kind, display, count: e.count || 0 });
  }
  const order = { phone: 0, alias: 1, address: 2 };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || a.count - b.count);
}

// ── 통합 실행 ──
// survivorKey 에 mergeKeys 의 전번/주문횟수/별칭/주소를 흡수 후 mergeKeys 삭제.
// 반환: 새 entries (변경 없으면 동일 참조).
export function mergeEntries(entries, survivorKey, mergeKeys) {
  if (!entries || !survivorKey || !Array.isArray(mergeKeys) || mergeKeys.length === 0) {
    return entries;
  }
  if (!entries[survivorKey]) return entries;
  const next = { ...entries };
  const survivor = { ...next[survivorKey] };
  const phones = new Set(entryPhoneDigits(survivorKey, survivor));
  let count = survivor.count || 0;

  for (const k of mergeKeys) {
    const e = next[k];
    if (!e || k === survivorKey) continue;
    entryPhoneDigits(k, e).forEach((d) => phones.add(d));
    count += e.count || 0;
    // survivor 에 별칭 없고 흡수 대상에 있으면 채움
    if (!realAlias(survivor) && realAlias(e)) survivor.alias = realAlias(e);
    // survivor 에 주소 없고 흡수 대상에 있으면 주소+좌표 가져옴
    if (!hasRealAddress(survivor) && hasRealAddress(e)) {
      survivor.label = e.label;
      if (typeof e.lat === 'number') survivor.lat = e.lat;
      if (typeof e.lng === 'number') survivor.lng = e.lng;
      if (typeof e.drivingM === 'number') survivor.drivingM = e.drivingM;
    }
    // 단골요청 보존
    if (!survivor.customerRequest && e.customerRequest) {
      survivor.customerRequest = e.customerRequest;
    }
    delete next[k];
  }

  const phoneArr = [...phones].filter(Boolean);
  if (phoneArr.length > 0) {
    survivor.phones = phoneArr;
    survivor.phone = phoneArr[0];
  }
  survivor.count = count;
  next[survivorKey] = survivor;
  return next;
}

// 여러 통합을 순차 적용 — 모달의 "적용" 에서 사장님이 선택한 그룹들.
// merges: [{ survivorKey, mergeKeys }]
export function applyMerges(entries, merges) {
  if (!Array.isArray(merges) || merges.length === 0) return entries;
  let cur = entries;
  for (const m of merges) {
    cur = mergeEntries(cur, m.survivorKey, m.mergeKeys);
  }
  return cur;
}
