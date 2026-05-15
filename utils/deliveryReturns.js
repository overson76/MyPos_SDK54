// 배달 회수(그릇 회수) 목록 빌더 — 순수 함수.
//
// 의도: 배달 완료 후 그릇 회수가 잊히기 쉬움. 출력물 들고 회수.
// 멀리부터 회수하면 라이더 동선 효율 — 한 번 멀리 간 김에 돌아오는 길에 가까운 곳 들름.
//
// 입력:
//   - history: revenue.history (결제완료 배달 entries)
//   - addressBook: { entries: { [key]: { lat, lng, drivingM, drivingFromLat, drivingFromLng, alias, ... } } }
//   - storeCoord: { lat, lng } | null
//   - now: 기준 시각 (default Date.now())
//   - sortMode: 'far' (원거리 우선, 기본) | 'near' (근거리 우선)
//   - withinHours: 회수 후보 시간 윈도우 (default 24시간)
//   - sinceMs: 이 시각 이후 entry 만 — 차수 진행중 계산용 (마지막 차수 createdAt)
//   - untilMs: 이 시각 이전 entry 만 — 특정 시간대 회수용
//
// 거리 정책:
//   - 우선: entry.drivingM (카카오 모빌리티 도로 실거리, 매장 좌표 일치 시)
//   - fallback: 직선거리(haversine) — 캐시 채워질 때까지 임시
//
// 출력:
//   {
//     ranked: [{ rank, key, label, alias, address, distanceM, isDrivingDistance, menuSummary, totalDishes, entryIds }],
//     unknown: [...],
//     sortMode,
//     storeHasCoord,
//   }

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
  sinceMs = null,
  untilMs = null,
} = {}) {
  const empty = { ranked: [], unknown: [], sortMode, storeHasCoord: !!storeCoord };
  if (!Array.isArray(history)) return empty;

  const windowMs = withinHours * HOUR_MS;
  const entriesMap = (addressBook && addressBook.entries) || {};
  const validStoreCoord =
    storeCoord && typeof storeCoord.lat === 'number' && typeof storeCoord.lng === 'number';

  // 1) 회수 대상 필터 — 배달 + 결제완료 + 미취소 + 시간 윈도우 / 차수 범위.
  const candidates = history.filter((e) => {
    if (!e || e.reverted) return false;
    if (e.paymentStatus !== 'paid') return false;
    if (!e.deliveryAddress) return false;
    const ts = e.clearedAt;
    if (typeof ts !== 'number') return false;
    // sinceMs / untilMs 가 명시되면 그 범위만 — 차수 진행중 계산용.
    if (typeof sinceMs === 'number' && ts <= sinceMs) return false;
    if (typeof untilMs === 'number' && ts > untilMs) return false;
    // 명시 안 됐으면 withinHours 윈도우 (default 24시간).
    if (typeof sinceMs !== 'number' && typeof untilMs !== 'number') {
      if (now - ts > windowMs) return false;
      if (now - ts < 0) return false;
    }
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
  //    drivingM 캐시(카카오 모빌리티 도로 실거리)가 매장 좌표 일치 시 우선 사용.
  //    없으면 직선거리(haversine) fallback — DeliveryReturnScreen 의 lazy fetch
  //    가 캐시 채우면 다음 렌더에 실거리로 자동 갱신.
  const enriched = Array.from(groups.values()).map((g) => {
    const entry = entriesMap[g.key] || null;
    const alias = (entry?.alias || '').trim();
    const label = alias || g.address;
    let distanceM = null;
    let isDrivingDistance = false;
    if (validStoreCoord && entry && typeof entry.lat === 'number' && typeof entry.lng === 'number') {
      const cachedDriving =
        typeof entry.drivingM === 'number' &&
        entry.drivingFromLat === storeCoord.lat &&
        entry.drivingFromLng === storeCoord.lng;
      if (cachedDriving) {
        distanceM = entry.drivingM;
        isDrivingDistance = true;
      } else {
        distanceM = haversineM(storeCoord, { lat: entry.lat, lng: entry.lng });
      }
    }
    const totalDishes = g.menuSummary.reduce((s, m) => s + m.qty, 0);
    return {
      key: g.key,
      address: g.address,
      alias,
      label,
      distanceM,
      isDrivingDistance,
      coord:
        entry && typeof entry.lat === 'number' && typeof entry.lng === 'number'
          ? { lat: entry.lat, lng: entry.lng }
          : null,
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

// 마감 차수의 snapshot.ranked 를 sortMode 로 재정렬 (snapshot 자체는 보존).
// 화면에서 같은 차수를 근거리/원거리로 토글할 때 사용 — 출력은 snapshot 그대로.
export function resortRanked(ranked, sortMode) {
  if (!Array.isArray(ranked)) return [];
  return [...ranked]
    .sort((a, b) => {
      const ad = typeof a.distanceM === 'number' ? a.distanceM : null;
      const bd = typeof b.distanceM === 'number' ? b.distanceM : null;
      if (ad == null && bd == null) return 0;
      if (ad == null) return 1;
      if (bd == null) return -1;
      return sortMode === 'near' ? ad - bd : bd - ad;
    })
    .map((it, idx) => ({ ...it, rank: idx + 1 }));
}

// 그날 마지막 차수의 createdAt — 진행중 차수의 sinceMs 기준.
// rounds: useDeliveryRounds 의 { [id]: round } 객체.
export function getLastRoundCreatedAt(rounds, date) {
  if (!rounds) return null;
  const list = Object.values(rounds).filter((r) => r && r.date === date);
  if (list.length === 0) return null;
  return list.reduce((max, r) => Math.max(max, r.createdAt || 0), 0);
}

// 그날 차수 개수 + 1 — 진행중 차수의 표시용 번호.
export function getNextRoundNo(rounds, date) {
  if (!rounds) return 1;
  return Object.values(rounds).filter((r) => r && r.date === date).length + 1;
}
