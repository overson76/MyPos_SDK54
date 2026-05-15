// 배달 회수(그릇 회수) 목록 빌더 — 순수 함수.
//
// 의도: 배달 완료 후 그릇 회수가 잊히기 쉬움. 출력물 들고 회수.
// 멀리부터 회수하면 라이더 동선 효율 — 한 번 멀리 간 김에 돌아오는 길에 가까운 곳 들름.
//
// 입력:
//   - history: revenue.history (결제완료 배달 entries)
//   - addressBook: { entries: { [key]: { lat, lng, alias, label, phone, ... } } }
//   - storeCoord: { lat, lng } | null (매장 좌표 없으면 거리 정렬 불가)
//   - now: 기준 시각 (default Date.now())
//   - sortMode: 'far' (원거리 우선, 기본) | 'near' (근거리 우선)
//   - withinHours: 회수 후보 시간 윈도우 (default 24시간 — 오늘 + 어제 새벽까지)
//
// 출력:
//   {
//     ranked: [{ rank, key, label, alias, address, distanceM, menuSummary, totalDishes, entryIds }],
//     unknown: [{ key, label, alias, address, menuSummary, totalDishes, entryIds }],
//     sortMode,
//     storeHasCoord,
//   }
//
// "주소불명" 정책:
//   - 주소록 entry 가 없거나
//   - entry.lat / entry.lng 가 없음
//   - 매장 좌표가 없음 (이 경우 전체가 거리 측정 불가 → 모두 ranked 에 거리 null 로)
//   → 무조건 최상단 별도 섹션, 번호 X (UI 에서 "0." 표기).

import { normalizeAddressKey } from './orderHelpers';

const HOUR_MS = 60 * 60 * 1000;

// 두 좌표 사이 직선거리(m). 도로 실거리는 비싸므로 정렬용으로 직선 충분.
function haversineM(a, b) {
  if (!a || !b) return null;
  if (typeof a.lat !== 'number' || typeof a.lng !== 'number') return null;
  if (typeof b.lat !== 'number' || typeof b.lng !== 'number') return null;
  const R = 6371000;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

// 같은 메뉴 이름 끼리 qty + largeQty 합산. 옵션은 무시 (회수는 그릇 수만 중요).
function mergeMenuSummary(existing, items) {
  const map = new Map(existing.map((m) => [m.name, m.qty]));
  for (const it of items || []) {
    const name = it?.name;
    if (!name) continue;
    const q = Math.max(0, (it.qty || 0) + (it.largeQty || 0));
    if (q <= 0) continue;
    map.set(name, (map.get(name) || 0) + q);
  }
  return Array.from(map.entries())
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty);
}

export function computeDeliveryReturns({
  history,
  addressBook,
  storeCoord,
  now = Date.now(),
  sortMode = 'far',
  withinHours = 24,
} = {}) {
  const empty = { ranked: [], unknown: [], sortMode, storeHasCoord: !!storeCoord };
  if (!Array.isArray(history)) return empty;

  const sinceMs = withinHours * HOUR_MS;
  const entriesMap = (addressBook && addressBook.entries) || {};
  const validStoreCoord =
    storeCoord && typeof storeCoord.lat === 'number' && typeof storeCoord.lng === 'number';

  // 1) 회수 대상 필터 — 배달 + 결제완료 + 미취소 + 시간 윈도우.
  const candidates = history.filter((e) => {
    if (!e || e.reverted) return false;
    if (e.paymentStatus !== 'paid') return false;
    if (!e.deliveryAddress) return false;
    const ts = e.clearedAt;
    if (typeof ts !== 'number') return false;
    if (now - ts > sinceMs) return false;
    if (now - ts < 0) return false;
    return true;
  });

  // 2) 같은 주소(정규화 키) 별로 그룹화 — 메뉴 합산.
  const groups = new Map();
  for (const e of candidates) {
    const key = normalizeAddressKey(e.deliveryAddress);
    if (!key) continue;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        address: e.deliveryAddress,
        menuSummary: [],
        entryIds: [],
      });
    }
    const g = groups.get(key);
    g.menuSummary = mergeMenuSummary(g.menuSummary, e.items);
    g.entryIds.push(e.id);
  }

  // 3) 주소록 매칭 + 거리 계산 + 별칭/라벨 추출.
  const enriched = Array.from(groups.values()).map((g) => {
    const entry = entriesMap[g.key] || null;
    const alias = (entry?.alias || '').trim();
    const label = alias || g.address;
    const distanceM = validStoreCoord && entry
      ? haversineM(storeCoord, { lat: entry.lat, lng: entry.lng })
      : null;
    const totalDishes = g.menuSummary.reduce((s, m) => s + m.qty, 0);
    return {
      key: g.key,
      address: g.address,
      alias,
      label,
      distanceM,
      menuSummary: g.menuSummary,
      totalDishes,
      entryIds: g.entryIds,
    };
  });

  // 4) 주소불명(거리 null) 분리 — 별도 최상단 섹션. 라벨 가나다 정렬.
  const unknown = enriched
    .filter((g) => g.distanceM == null)
    .sort((a, b) => a.label.localeCompare(b.label, 'ko'));

  // 5) 거리 있는 항목 정렬 — sortMode 따라.
  const ranked = enriched
    .filter((g) => g.distanceM != null)
    .sort((a, b) =>
      sortMode === 'near' ? a.distanceM - b.distanceM : b.distanceM - a.distanceM
    )
    .map((g, idx) => ({ ...g, rank: idx + 1 }));

  return { ranked, unknown, sortMode, storeHasCoord: !!validStoreCoord };
}
