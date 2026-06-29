// 배달 주소 → 주소록 entry 매칭 헬퍼.
// 정규화 키 기준 — 대소문자/공백 차이는 normalizeAddressKey 가 흡수.
//
// addressBook 자료 형태:
//   - 객체: { entries: { [key]: entry } } — useAddressBook 의 정식 형태
//   - 배열: Array<entry> — DeliveryRouteCard 등 일부 컴포넌트의 단순 형태
// 둘 다 안전하게 처리.

import { normalizeAddressKey } from './orderHelpers';

export function findAddressEntry(addressBook, deliveryAddress) {
  if (!addressBook || !deliveryAddress) return null;
  const key = normalizeAddressKey(deliveryAddress);
  if (!key) return null;

  if (Array.isArray(addressBook)) {
    return addressBook.find((e) => e?.key === key) || null;
  }

  const entries = addressBook.entries;
  if (!entries) return null;

  if (Array.isArray(entries)) {
    return entries.find((e) => e?.key === key) || null;
  }
  if (typeof entries === 'object') {
    return entries[key] || null;
  }
  return null;
}

// 단골요청 — entry.customerRequest 추출 (없으면 빈 문자열).
export function getCustomerRequest(addressBook, deliveryAddress) {
  const entry = findAddressEntry(addressBook, deliveryAddress);
  const v = (entry?.customerRequest || '').trim();
  return v;
}

// 별칭 — entry.alias 추출 (없으면 빈 문자열).
export function getAddressAlias(addressBook, deliveryAddress) {
  const entry = findAddressEntry(addressBook, deliveryAddress);
  return (entry?.alias || '').trim();
}

// 한 entry 의 전번들 — phones array (신) + 옛 phone (단일) 통합.
// 2026-05-16: 같은 손님이 휴대폰 + 일반전화 2개 가질 수 있게 phones array 도입.
// 옛 entry 호환 — phone 단일 필드 유지 + phones 추가. read 헬퍼가 둘 다 흡수.
export function getAllPhones(entry) {
  if (!entry) return [];
  const result = [];
  if (Array.isArray(entry.phones)) {
    for (const p of entry.phones) {
      const t = String(p || '').trim();
      if (t && !result.includes(t)) result.push(t);
    }
  }
  const single = String(entry.phone || '').trim();
  if (single && !result.includes(single)) result.push(single);
  return result;
}

// 주 전번 — 첫 phones[0], 없으면 옛 phone. 표시 / 음성 / CID listing 등 single 필요 시.
export function getPrimaryPhone(entry) {
  const all = getAllPhones(entry);
  return all[0] || '';
}

// entry 의 모든 phone digits 모음 — CID 매칭 / AI 단골 매칭에 사용.
export function getAllPhoneDigits(entry) {
  return getAllPhones(entry)
    .map((p) => p.replace(/\D/g, ''))
    .filter(Boolean);
}

// 객체/배열 두 형태 모두 흡수해 entries 배열로 반환. 비어 있으면 빈 배열.
// 추천 로직 등에서 entries 전체 순회 필요할 때 사용.
export function listAddressBookEntries(addressBook) {
  if (!addressBook) return [];
  if (Array.isArray(addressBook)) return addressBook;
  const entries = addressBook.entries;
  if (!entries) return [];
  if (Array.isArray(entries)) return entries;
  if (typeof entries === 'object') return Object.values(entries);
  return [];
}

// 2026-05-25: 사장님 요청 "진실 → 진실보석 되묻기". 부분 매칭 후보 찾기.
// query: 사장님이 입력한 별칭 (예: "진실")
// addressBook: useOrders().addressBook
// 반환: 후보 entries 배열 (가장 가까운 매칭 순). 정확 매칭은 제외 (그 entry 가
//       이미 있으면 그대로 사용 — confirm 불필요).
//
// 매칭 정책:
//   - entry.alias 가 query 를 *포함* (substring)
//   - 또는 query 가 entry.alias 를 *포함*
//   - 대소문자 무시
//   - 정확 일치는 제외 (호출부가 별도 매칭으로 처리)
//   - 최대 3건
//
// 2026-05-28: 사장님 호소 "같은 별칭이나 주소지인데 다른 번호로 전화가 왔다면 자동으로
// 비슷한 별칭 검색해서 필터" — alias 뿐 아니라 label(주소) 도 검색 대상에 포함.
// 사장님이 라벨 칸에 "신규추가" 같은 식별자를 적은 entry, 또는 alias 없고 label 만
// 있는 entry 도 매칭. 매칭 결과의 alias 가 비면 label 을 alias 자리로 표시 (모달 UX).
export function findSimilarAliases(query, addressBook) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 1) return [];
  const all = listAddressBookEntries(addressBook);
  const out = [];
  const seenKeys = new Set();
  for (const e of all) {
    if (seenKeys.has(e.key)) continue;
    const a = String(e?.alias || '').trim().toLowerCase();
    const l = String(e?.label || '').trim().toLowerCase();
    let matched = false;
    // alias 매칭 (옛 정책)
    if (a && a !== q && (a.includes(q) || q.includes(a))) matched = true;
    // 2026-05-28: label(주소) 매칭 추가 — alias 비어도 사장님이 라벨에 식별자 적은 entry 잡음.
    // CID phone-only entry (__phone:digits / label="(주소 미입력) ...") 는 제외 — 노이즈.
    if (!matched && l && l !== q && !l.startsWith('(주소 미입력)')) {
      if (l.includes(q) || q.includes(l)) matched = true;
    }
    if (matched) {
      seenKeys.add(e.key);
      out.push(e);
    }
  }
  // 사용 횟수 / 길이 차이 기준 가까운 순. 비교 대상이 alias 우선, 없으면 label.
  out.sort((x, y) => {
    const xs = (x.alias || x.label || '').length;
    const ys = (y.alias || y.label || '').length;
    const xDiff = Math.abs(xs - q.length);
    const yDiff = Math.abs(ys - q.length);
    if (xDiff !== yDiff) return xDiff - yDiff;
    return (y.count || 0) - (x.count || 0);
  });
  return out.slice(0, 3);
}

// 2026-05-25: phone digits 정규화 (+82 → 0 한국 국가코드 흡수). CID 매칭과
// 같은 함수 — 일관성 위해. useCidHandler.web.js 의 normalizePhoneDigits 와 동일.
export function normalizePhoneDigits(raw) {
  if (!raw) return '';
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('82') && d.length >= 11) {
    d = '0' + d.slice(2);
  }
  return d;
}

// 2026-05-25: 일반전화/대표번호 판별 — 휴대폰 prefix 제외.
// 카카오 로컬 검색 가능 여부 — 가게는 일반전화/대표번호 등록, 휴대폰은 개인 번호라 미등록.
// 휴대폰 prefix: 010 (현재) / 011, 016, 017, 018, 019 (옛 PCS)
// 그 외 (02 서울, 031~064 지역, 070 인터넷전화 등) = 가게 등록 가능 = 검색 가능
export function isLandlinePhone(rawPhone) {
  const d = normalizePhoneDigits(rawPhone);
  if (!d || d.length < 9) return false;
  const mobilePrefixes = ['010', '011', '016', '017', '018', '019'];
  for (const p of mobilePrefixes) {
    if (d.startsWith(p)) return false;
  }
  return true;
}

// 2026-05-25: 전화번호로 entry 찾기 (phones array + 옛 phone 단일 모두 검색).
// CID phone-only entry 와 주소 entry 통합 시 사용.
export function findEntryByPhone(addressBook, phone) {
  const digits = normalizePhoneDigits(phone);
  if (!digits) return null;
  const all = listAddressBookEntries(addressBook);
  for (const e of all) {
    const list = [];
    if (Array.isArray(e?.phones)) {
      for (const p of e.phones) {
        const d = normalizePhoneDigits(p);
        if (d) list.push(d);
      }
    }
    if (e?.phone) {
      const d = normalizePhoneDigits(e.phone);
      if (d && !list.includes(d)) list.push(d);
    }
    if (list.includes(digits)) return e;
  }
  return null;
}

// entry 가 "식별 가능한 이름" 을 가졌는지 — alias 우선, 없으면 label 도 식별로 인정.
// 2026-06-09: 진실보석 단골 모달 반복 버그. needsAliasPrompt 가 entry.alias 만 봐서
//   alias 비고 label="진실보석..." 인 entry 를 "미상" 으로 오판 → 매번 prompt.
//   다른 화면(배달지도/주소록/CID)은 label 도 식별로 쓰는데 OrderScreen 만 누락.
//   placeholder label(__phone:digits / "(주소 미입력)...") 은 식별로 인정 X — 신규는 여전히 prompt.
export function entryIdentityName(entry) {
  if (!entry) return '';
  const alias = (entry.alias || '').trim();
  if (alias) return alias;
  const label = (entry.label || '').trim();
  if (!label) return '';
  if (label.startsWith('__phone:')) return '';
  if (label.startsWith('(주소 미입력)')) return '';
  return label;
}

// 2026-06-13: 카운터 PC 딜레이 처방 — entry 가 카카오 좌표 변환을 시도할 가치가
// 있는 "진짜 주소" 를 가졌는지. useAddressBook 의 lazy geocode 루프가 주소 미입력
// (CID phone-only / placeholder) entry 48~62건까지 매번 카카오로 보내 실패하던 낭비
// 차단. 이런 entry 는 label 이 주소가 아니라 식별용 placeholder 라 좌표를 구할 수 없음
// → 호출 자체가 무의미. (alias 기반 검색은 AliasPromptModal 이 사용자 트리거로 별도 처리.)
export function hasResolvableAddress(entry) {
  const label = (entry?.label || '').trim();
  if (!label) return false;
  if (label.startsWith('(주소 미입력)')) return false;
  if (label.startsWith('__phone:')) return false;
  if (entry?.pendingAddress === true) return false;
  return true;
}

// 2026-06-12: CID 착신 → 주소록 매칭 — 실 CID(useCidHandler.web.js)와 시뮬
// (App.js onSimulateCall) 이 *같은 매칭 결과* 를 내도록 공용화한 순수 함수.
// 사장님 신고 "주소록에 저장된 단골(테스트1)인데 시뮬 배너에 번호만 뜸" — 시뮬
// 경로에 주소록 lookup 이 통째로 없어서 실 CID 와 다른 화면이 나오던 버그의 처방.
// 반환 형태는 useCidHandler 가 Firestore incomingCall 문서에 박는 필드와 동일.
export function matchCidEntry(addressBook, phoneNumber) {
  const entry = findEntryByPhone(addressBook, phoneNumber);
  return {
    entry: entry || null,
    alias: entry?.alias || null,
    address: entry?.label || null,
    orderCount: entry?.count || 0,
    isNewNumber: !entry,
  };
}

// 2026-06-12: PENDING 카트 → 배달/포장/예약 슬롯 배당 시 발신자 도장 계산 — 순수 함수.
// PENDING 카트엔 발신자 정보가 없는 게 보통 (CID stash 는 별도 d 슬롯에만 박힘).
// 최근 착신 번호(lastCallPhone, 5분 TTL)와 주소록 별칭으로 보강 — 없으면 빈 값
// (매장 직접 손님). needsAliasPrompt / AliasPromptModal 의 lastCallPhone 정책과 동일 결.
export function resolvePendingCallerStamp(order, addressBook, lastCallPhone) {
  const phone =
    (order?.deliveryPhone || '').trim() || (lastCallPhone || '').trim() || '';
  const entry = phone ? findEntryByPhone(addressBook, phone) : null;
  const alias =
    (order?.deliveryAlias || '').trim() || (entry?.alias || '').trim() || null;
  return {
    deliveryAddress: order?.deliveryAddress,
    deliveryPhone: phone || null,
    deliveryAlias: alias,
  };
}

// 주문 확정 시 별칭 입력 모달(AliasPromptModal)을 띄울지 결정 — 순수 함수.
// 정책 (사장님 누적 요구):
//   - delivery/takeout/reservation 타입만 대상 (매장/홀은 모달 X)
//   - 손님 식별 정보(별칭 OR 식별 라벨)가 *어디에든* 있으면 단골 → skip
//   - 완전 미상(신규)만 모달 → 사장님 별칭 등록 기회
// 식별 소스: order.deliveryAlias > 주소 entry > 전화번호 entry (alias 또는 label).
export function computeNeedsAliasPrompt({
  tableType,
  deliveryAlias,
  deliveryAddress,
  phone,
  addressBook,
} = {}) {
  const isPromptType =
    tableType === 'delivery' ||
    tableType === 'takeout' ||
    tableType === 'reservation';
  if (!isPromptType) return false;

  const aliasFromOrder = (deliveryAlias || '').trim();
  if (aliasFromOrder) return false;

  // 주소 → entry 식별명
  if ((deliveryAddress || '').trim()) {
    const entry = findAddressEntry(addressBook, deliveryAddress);
    if (entryIdentityName(entry)) return false;
  }

  // 전화번호 → entry 식별명
  if ((phone || '').trim()) {
    const entry = findEntryByPhone(addressBook, phone);
    if (entryIdentityName(entry)) return false;
  }

  return true;
}

// 배달 손님 식별 — 주소 → 주소록 entry 의 alias/phone/phones 통합 추출.
// 우선순위: order 객체에 명시 저장된 fallback.alias/phone (orderReducer 가 보존) > 주소록 entry.
// 매출 history 빌더 / 영수증 재출력 / 라벨 표기 모든 곳이 같은 식별값을 쓰도록.
export function resolveDeliveryIdentity(addressBook, deliveryAddress, fallback = {}) {
  let entry = findAddressEntry(addressBook, deliveryAddress);
  // 2026-05-29: 주소 key 로 못 찾으면 전화번호로 재시도 — CID phone-only 슬롯
  //   (deliveryAddress="(주소 미입력) ...") 에서 사장님이 그 번호에 별칭("아가맘")을
  //   저장한 entry 가 다른 key(__phone:digits / 진짜 주소) 라 주소 매칭이 실패하던
  //   사고. 전화번호로 찾으면 alias 가 잡힌다. (사장님 신고 "아가맘인데 전번만 뜸")
  if (!entry && (fallback.phone || '').trim()) {
    entry = findEntryByPhone(addressBook, fallback.phone);
  }
  const alias =
    (fallback.alias || '').trim() ||
    (entry?.alias || '').trim();
  const phones = getAllPhones(entry);
  const primary =
    (fallback.phone || '').trim() ||
    phones[0] ||
    '';
  return {
    alias,
    phone: primary,
    phones: phones.length > 0 ? phones : null,
  };
}

// 배달 손님 라벨 — 사장님 정책: **별칭 > 전번 > 주소** 우선순위.
// 모든 배달 표시 (자주 칩 / 배달 카드 / 영수증 / 음성) 가 같은 규칙을 따르도록
// 통합 헬퍼. 사용처마다 phoneStyle/addressMaxLen 으로 미세 조정.
//
// 입력 (모두 optional):
//   - alias / phone / label / address / deliveryAddress
//
// 옵션:
//   - phoneStyle:
//       'full'   = 010-1234-5678 (default, 화면 표시용)
//       'short'  = 📞 5678        (좁은 칩용, 끝 4자리)
//       'spoken' = 공일공 일이삼사 오륙칠팔 (TTS — 숫자 사이 공백)
//   - addressMaxLen: fallback 주소가 너무 길면 자름 (음성용)
export function formatDeliveryLabel(
  { alias, phone, phones, label, address, deliveryAddress } = {},
  opts = {}
) {
  const { phoneStyle = 'full', addressMaxLen } = opts;
  const aliasText = (alias || '').trim();
  if (aliasText) return aliasText;

  // 2026-05-16: phones array (다중 phone) 우선 + 옛 phone 단일 fallback.
  // 첫 phone 만 표시 (자주 칩/카드 등 좁은 영역 가정).
  const firstPhone = Array.isArray(phones) && phones.length > 0
    ? phones[0]
    : phone;
  const phoneDigits = String(firstPhone || '').replace(/\D/g, '');
  if (phoneDigits.length >= 4) {
    if (phoneStyle === 'short') {
      return `📞 ${phoneDigits.slice(-4)}`;
    }
    if (phoneStyle === 'spoken') {
      // TTS 가 자연스럽게 끊어 읽도록 공백.
      if (phoneDigits.length === 11) {
        return `${phoneDigits.slice(0, 3)} ${phoneDigits.slice(3, 7)} ${phoneDigits.slice(7)}`;
      }
      if (phoneDigits.length === 10) {
        return `${phoneDigits.slice(0, 3)} ${phoneDigits.slice(3, 6)} ${phoneDigits.slice(6)}`;
      }
      return phoneDigits;
    }
    // full (default — 화면 표시용 표준 형태)
    if (phoneDigits.length === 11) {
      return `${phoneDigits.slice(0, 3)}-${phoneDigits.slice(3, 7)}-${phoneDigits.slice(7)}`;
    }
    if (phoneDigits.length === 10) {
      return `${phoneDigits.slice(0, 3)}-${phoneDigits.slice(3, 6)}-${phoneDigits.slice(6)}`;
    }
    return phoneDigits;
  }

  const addr = (label || address || deliveryAddress || '').trim();
  if (addressMaxLen && addr.length > addressMaxLen) {
    return addr.slice(0, addressMaxLen) + '…';
  }
  return addr;
}
