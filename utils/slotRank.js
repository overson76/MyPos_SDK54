// 동적 슬롯(배달 d / 예약 y / 포장 p) "도착 순서" 표시 계층 — 중앙 서비스.
//
// 배경(2026-07-10): 슬롯 저장 재정렬(compactSlots)을 무음 유실 사고로 제거한 뒤,
//   저장 키(d1..d5)는 고정이지만 화면 번호는 "받은 시각(createdAt)" 순으로 매겨
//   선착순(어느 전화가 먼저 왔는지)을 유지해야 한다. 배달 번호가 12곳(배달판/주방/
//   영수증/음성/지도/경로…)에 뜨는데 전부 resolveAnyTable / resolveTableForAlert 로
//   수렴 → 여기서 계산한 순위 라벨을 그 소스에 주입해 전 화면이 같은 번호를 쓴다.
//
// ⚠️ leaf 모듈 — tableData / orderHelpers / OrderContext 를 import 하지 않는다(순환 방지).
//   prefix→라벨은 여기 하드코딩(d/y/p 는 안정값). 순위맵은 OrderContext 가 orders 변경 시
//   setSlotRankMaps() 로 갱신하고, resolveAnyTable 이 rankedSlotLabel() 로 읽는다.
//   실패 모드는 "번호가 한 프레임 늦거나 이상함"(코스메틱)뿐 — 저장은 고정이라 유실 불가.

const PREFIX_LABEL = { d: '배달', y: '예약', p: '포장' };

// 슬롯 점유 판정 — findEmptySlotForType 과 동일 기준(발신자 정보만 있어도 점유).
export function slotOccupied(o) {
  return (
    !!o &&
    ((o.items?.length || 0) > 0 ||
      (o.cartItems?.length || 0) > 0 ||
      !!o.deliveryPhone ||
      !!o.deliveryAlias ||
      !!o.deliveryAddress ||
      !!o.deliveryTime ||
      (o.partySize || 0) > 0)
  );
}

// 점유 슬롯을 createdAt(받은 시각) 오름차순으로 { baseKey → 순위(1-based) } 계산.
//   분할 자식(d1#1)은 부모(d1)에 종속 = 자식 중 최소 createdAt.
//   createdAt 없는 옛 슬롯은 맨 뒤로 밀되 키 번호로 안정 정렬.
export function computeSlotRankMap(orders, prefix) {
  const o = orders || {};
  if (!prefix) return {};
  const baseRe = new RegExp(`^${prefix}\\d+$`);
  const info = {}; // baseKey → { ts, n }
  for (const key of Object.keys(o)) {
    const base = key.includes('#') ? key.split('#')[0] : key;
    if (!baseRe.test(base)) continue;
    if (!slotOccupied(o[key])) continue;
    const c = typeof o[key].createdAt === 'number' ? o[key].createdAt : null;
    const n = parseInt(base.slice(prefix.length), 10);
    if (!info[base]) {
      info[base] = { ts: c, n: Number.isNaN(n) ? 0 : n };
    } else if (c != null && (info[base].ts == null || c < info[base].ts)) {
      info[base].ts = c;
    }
  }
  const bases = Object.keys(info);
  bases.sort((a, b) => {
    const at = info[a].ts == null ? Infinity : info[a].ts;
    const bt = info[b].ts == null ? Infinity : info[b].ts;
    if (at !== bt) return at - bt;
    return info[a].n - info[b].n;
  });
  const rank = {};
  bases.forEach((base, i) => {
    rank[base] = i + 1;
  });
  return rank;
}

// ── 중앙 순위맵 (표시 전용 캐시) ──────────────────────────────
let _rankMaps = { d: {}, y: {}, p: {} };

// OrderContext 가 orders 변경 시 호출 — d/y/p 순위맵 재계산.
export function setSlotRankMaps(orders) {
  _rankMaps = {
    d: computeSlotRankMap(orders, 'd'),
    y: computeSlotRankMap(orders, 'y'),
    p: computeSlotRankMap(orders, 'p'),
  };
}

// tableId("d3" / 분할 "d3#1") → 도착순 라벨("배달2" / "배달2-1"). 순위 없거나 비동적이면 null.
export function rankedSlotLabel(tableId) {
  if (!tableId) return null;
  const raw = String(tableId);
  const hashAt = raw.indexOf('#');
  const base = hashAt >= 0 ? raw.slice(0, hashAt) : raw;
  const partIdx = hashAt >= 0 ? raw.slice(hashAt + 1) : '';
  const prefix = base[0];
  const labelPrefix = PREFIX_LABEL[prefix];
  if (!labelPrefix) return null;
  if (!/^\d+$/.test(base.slice(1))) return null;
  const rank = _rankMaps[prefix] && _rankMaps[prefix][base];
  if (!rank) return null;
  return partIdx ? `${labelPrefix}${rank}-${partIdx}` : `${labelPrefix}${rank}`;
}

// 테스트/디버그용 스냅샷.
export function _getSlotRankMaps() {
  return _rankMaps;
}
