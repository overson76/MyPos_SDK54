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
