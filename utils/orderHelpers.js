// OrderContext 의 순수 helper 모음.
// React 의존성 없이 입력 → 출력만 다루는 함수. 단위 테스트 가능.
import { resolveAnyTable } from './tableData';

// 매출 history 메모리 누적 방지 — 최근 N건만 유지
export const REVENUE_HISTORY_CAP = 1000;
export function capHistory(h) {
  return h.length > REVENUE_HISTORY_CAP ? h.slice(-REVENUE_HISTORY_CAP) : h;
}

// 주문 항목 총액 — 보통가 × qty + (대 가산금 × largeQty).
// 옵션 가산금 정책 변경시 여기 한 곳만 손대도록 도메인 헬퍼화.
export function computeItemsTotal(items) {
  return (items || []).reduce(
    (s, i) =>
      s + i.price * i.qty + (i.sizeUpcharge || 0) * (i.largeQty || 0),
    0
  );
}

// 매출 history 한 건 빌더 — 정리(clearTable) / 자동 배달 정리에서 동일 모양으로 push.
// extraFields 로 autoDelivered 같은 옵션 필드 병합.
//
// paymentMethod: 결제수단 코드 ('cash' | 'card' | 'transfer' | 'localCurrency').
//   미선택 / 옛 데이터는 null. utils/payment.js 가 'unspecified'(미분류) 로 집계.
//   회계 / CSV 익스포트 / 결제수단별 매출 분석에 사용.
export function buildHistoryEntry({
  tableId,
  items,
  options,
  deliveryAddress,
  deliveryTime,
  paymentStatus,
  paymentMethod,
  total,
  extraFields,
}) {
  return {
    id: `${tableId}-${Date.now()}`,
    tableId,
    items: (items || []).map((i) => ({ ...i })),
    options: [...(options || [])],
    deliveryAddress: deliveryAddress || '',
    deliveryTime: deliveryTime || '',
    paymentStatus,
    paymentMethod: paymentMethod || null,
    total,
    clearedAt: Date.now(),
    ...(extraFields || {}),
  };
}

export function appendHistory(prev, entry) {
  return {
    total: prev.total + entry.total,
    history: capHistory([...prev.history, entry]),
  };
}

// 배달 주소록 키 정규화.
// 보수적: trim + 연속 공백 1개로 축소 + 소문자화. 하이픈/숫자/한글은 보존.
export function normalizeAddressKey(label) {
  return String(label || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function localDateString(ts = Date.now()) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function genSlotId() {
  return `s-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

// 동적 슬롯(예약 y / 포장 p / 배달 d) prefix 인식.
// 'y3' → 'y', 'p10' → 'p', 't01' → null, 'y2#1' → null (분할 슬롯 제외).
// utils/tableData.js 의 DYNAMIC_SLOT_PREFIX 와 키 정합.
export function detectDynamicSlotPrefix(tableId) {
  if (!tableId) return null;
  const m = /^([ypd])(\d+)$/.exec(tableId);
  return m ? m[1] : null;
}

// 동적 슬롯 빈자리 메꿈(compact). y2 가 비고 y3 가 차 있으면 y3 → y2.
// 분할(y2#1) / 그룹은 본 helper 가 건드리지 않음 — 해당 슬롯 자체는 mapping 에서 제외돼
// 원래 키로 유지됨. 추후 필요시 확장.
// 반환: { orders: 새 dict, mapping: Map(oldNum → newNum) }.
export function compactSlotsByPrefix(orders, prefix) {
  const re = new RegExp(`^${prefix}(\\d+)$`);
  const occupied = Object.keys(orders)
    .map((k) => {
      const m = re.exec(k);
      return m ? { key: k, n: parseInt(m[1], 10), order: orders[k] } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.n - b.n);

  const mapping = new Map();
  occupied.forEach((entry, i) => {
    const newN = i + 1;
    if (entry.n !== newN) mapping.set(entry.n, newN);
  });

  if (mapping.size === 0) return { orders, mapping };

  const next = { ...orders };
  for (const entry of occupied) {
    if (mapping.has(entry.n)) delete next[entry.key];
  }
  for (const entry of occupied) {
    if (mapping.has(entry.n)) {
      next[`${prefix}${mapping.get(entry.n)}`] = entry.order;
    }
  }
  return { orders: next, mapping };
}

// 동일한 (id, options, cookState/portion states)을 가진 슬롯들을 qty/largeQty 합산하여 병합
export function normalizeSlots(items) {
  const result = [];
  for (const item of items) {
    if (!item || item.qty <= 0) continue;
    const opts = [...(item.options || [])].sort();
    const memo = item.memo || '';
    const cs = item.cookState || 'pending';
    const csn = item.cookStateNormal || cs;
    const csl = item.cookStateLarge || cs;
    const idx = result.findIndex((r) => {
      const rcs = r.cookState || 'pending';
      return (
        r.id === item.id &&
        rcs === cs &&
        (r.cookStateNormal || rcs) === csn &&
        (r.cookStateLarge || rcs) === csl &&
        (r.memo || '') === memo &&
        JSON.stringify([...(r.options || [])].sort()) === JSON.stringify(opts)
      );
    });
    if (idx >= 0) {
      const merged = {
        ...result[idx],
        qty: result[idx].qty + item.qty,
        largeQty: (result[idx].largeQty || 0) + (item.largeQty || 0),
      };
      result[idx] = merged;
    } else {
      result.push({ ...item, options: opts });
    }
  }
  return result;
}

// 단체석(`#` 포함) 처리: 부모 테이블에서 라벨 파생.
export function resolveTableForAlert(tableId) {
  if (tableId.includes('#')) {
    const [pid, idx] = tableId.split('#');
    const parent = resolveAnyTable(pid);
    if (!parent) return null;
    return {
      ...parent,
      id: tableId,
      label: `${parent.label}-${idx}`,
      parentId: pid,
    };
  }
  return resolveAnyTable(tableId);
}

// 단체석 그룹 합치기 — 두 테이블의 주문/장바구니/매출 상태를 병합.
export function mergeOrderParts(a, b) {
  const aItems = a?.items || [];
  const bItems = b?.items || [];
  const aCart = a?.cartItems || [];
  const bCart = b?.cartItems || [];
  if (
    aItems.length === 0 &&
    bItems.length === 0 &&
    aCart.length === 0 &&
    bCart.length === 0
  )
    return null;
  const mergeLists = (la, lb) => {
    const map = new Map();
    [...la, ...lb].forEach((i) => {
      const existing = map.get(i.id);
      if (existing) {
        map.set(i.id, { ...existing, qty: existing.qty + i.qty });
      } else {
        map.set(i.id, { ...i });
      }
    });
    return Array.from(map.values());
  };
  const createdAts = [a?.createdAt, b?.createdAt].filter(Boolean);
  return {
    items: mergeLists(aItems, bItems),
    cartItems: mergeLists(aCart, bCart),
    confirmedItems: mergeLists(a?.confirmedItems || [], b?.confirmedItems || []),
    createdAt: createdAts.length ? Math.min(...createdAts) : Date.now(),
    status:
      a?.status === 'ready' && b?.status === 'ready' ? 'ready' : 'preparing',
    paymentStatus:
      a?.paymentStatus === 'paid' && b?.paymentStatus === 'paid'
        ? 'paid'
        : 'unpaid',
    options: Array.from(
      new Set([...(a?.options || []), ...(b?.options || [])])
    ),
    readyAt: a?.readyAt || b?.readyAt || null,
  };
}
