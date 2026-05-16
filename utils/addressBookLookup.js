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
