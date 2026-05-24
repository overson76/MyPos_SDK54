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
export function findSimilarAliases(query, addressBook) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 1) return [];
  const all = listAddressBookEntries(addressBook);
  const out = [];
  for (const e of all) {
    const a = String(e?.alias || '').trim().toLowerCase();
    if (!a) continue;
    if (a === q) continue; // 정확 매칭 제외
    if (a.includes(q) || q.includes(a)) {
      out.push(e);
    }
  }
  // 사용 횟수 / 길이 차이 기준 가까운 순
  out.sort((x, y) => {
    const xa = (x.alias || '').length;
    const ya = (y.alias || '').length;
    const xDiff = Math.abs(xa - q.length);
    const yDiff = Math.abs(ya - q.length);
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

// 배달 손님 식별 — 주소 → 주소록 entry 의 alias/phone/phones 통합 추출.
// 우선순위: order 객체에 명시 저장된 fallback.alias/phone (orderReducer 가 보존) > 주소록 entry.
// 매출 history 빌더 / 영수증 재출력 / 라벨 표기 모든 곳이 같은 식별값을 쓰도록.
export function resolveDeliveryIdentity(addressBook, deliveryAddress, fallback = {}) {
  const entry = findAddressEntry(addressBook, deliveryAddress);
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
