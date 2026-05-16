// 배달 경로 최적화 후보 계산 — 순수 함수.
// DeliveryRouteCard 의 candidates 가 운영(addressBook = { entries: {...} } 객체)에서
// 한 번도 작동 안 했던 버그를 회귀 방지하기 위해 분리. Jest 로 단위 테스트.
//
// addressBook 은 두 형태 모두 허용:
//   - 객체: { entries: { [key]: entry } } — useAddressBook / OrderContext 의 정식 형태
//   - 배열: Array<entry> — DeliveryRouteDemo 등 일부 컴포넌트의 단순 형태
// findAddressEntry 가 둘 다 흡수.

import { findAddressEntry } from './addressBookLookup';

export function buildRouteCandidates(activeOrders, storeInfo, addressBook) {
  if (
    !storeInfo ||
    typeof storeInfo.lat !== 'number' ||
    typeof storeInfo.lng !== 'number'
  ) {
    return [];
  }
  return (activeOrders || [])
    .filter((o) => o?.table?.type === 'delivery' && !!o.deliveryAddress)
    .map((o) => {
      const entry = findAddressEntry(addressBook, o.deliveryAddress);
      if (
        !entry ||
        typeof entry.lat !== 'number' ||
        typeof entry.lng !== 'number'
      ) {
        return null;
      }
      return {
        id: o.tableId,
        tableId: o.tableId,
        label: o.table?.label || o.tableId,
        address: o.deliveryAddress,
        lat: entry.lat,
        lng: entry.lng,
      };
    })
    .filter(Boolean);
}
