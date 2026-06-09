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
//
// deliveryAlias / deliveryPhone / deliveryPhones: 배달 손님 식별.
//   재출력 시 영수증/표기에 별칭 > 전번 > 주소 우선순위 적용용. 옛 entry 는 모두 빈값 → 주소만.
export function buildHistoryEntry({
  tableId,
  items,
  options,
  deliveryAddress,
  deliveryAlias,
  deliveryPhone,
  deliveryPhones,
  deliveryTime,
  deliveryTimeIsPM,
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
    deliveryAlias: deliveryAlias || '',
    deliveryPhone: deliveryPhone || '',
    deliveryPhones: Array.isArray(deliveryPhones) ? [...deliveryPhones] : null,
    deliveryTime: deliveryTime || '',
    deliveryTimeIsPM: deliveryTimeIsPM ?? true,
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

// 결제완료 되돌리기 — entry 자체는 보존하고 reverted 플래그만 박음.
// 매출 합계/집계는 reverted 인 entry 를 제외 (utils/payment.js).
// total 도 보정: revenue.total 누적값에서 entry.total 을 뺀다.
export function markHistoryReverted(prev, entryId) {
  const idx = (prev.history || []).findIndex((e) => e.id === entryId);
  if (idx < 0) return prev;
  const target = prev.history[idx];
  if (target.reverted) return prev;
  const nextHistory = prev.history.slice();
  nextHistory[idx] = { ...target, reverted: true, revertedAt: Date.now() };
  return {
    total: Math.max(0, prev.total - (Number(target.total) || 0)),
    history: nextHistory,
  };
}

export function findHistoryEntry(history, entryId) {
  return (history || []).find((e) => e.id === entryId) || null;
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

// 2026-05-21: 빈 슬롯 찾기 일반화 — 배달/예약/포장 type 별 prefix + 정적 카운트.
//   delivery → d1..d5 + 동적 확장 (d6+)
//   reservation → y1..y2 + 동적 (y3+)
//   takeout → p1..p2 + 동적 (p3+)
// "비어있다" = items 와 cartItems 둘 다 없음. 분할(d1#1) 자식 슬롯도 점유로 판정.
const TYPE_PREFIX = { delivery: 'd', reservation: 'y', takeout: 'p' };
const TYPE_STATIC_COUNT = { delivery: 5, reservation: 2, takeout: 2 };

export function findEmptySlotForType(orders, type) {
  const prefix = TYPE_PREFIX[type];
  if (!prefix) return null;
  const staticCount = TYPE_STATIC_COUNT[type] || 2;
  // 2026-06-05: 점유 판정에 발신자 정보(전화/별칭/주소)·예약(시간/인원) 포함.
  //   기존엔 메뉴(items/cart)만 봐서, "🕐 주문대기"(발신자만) / 빈 예약(시간·인원만)
  //   슬롯을 "빈 칸" 으로 재판정 → 다음 전화·예약이 같은 칸을 덮어쓰던 사고 처방.
  const slotOccupied = (o) =>
    !!o &&
    ((o.items?.length || 0) > 0 ||
      (o.cartItems?.length || 0) > 0 ||
      !!o.deliveryPhone ||
      !!o.deliveryAlias ||
      !!o.deliveryAddress ||
      !!o.deliveryTime ||
      (o.partySize || 0) > 0);
  const isUsed = (slotId) => {
    if (slotOccupied(orders?.[slotId])) return true;
    return Object.entries(orders || {}).some(
      ([oid, oo]) => oid.startsWith(`${slotId}#`) && slotOccupied(oo)
    );
  };
  for (let n = 1; n <= staticCount; n += 1) {
    const id = `${prefix}${n}`;
    if (!isUsed(id)) return id;
  }
  // 모두 차있으면 동적 확장 — 현재 점유된 prefix{n} 중 최대 n+1
  let maxN = staticCount;
  const re = new RegExp(`^${prefix}(\\d+)`);
  Object.keys(orders || {}).forEach((k) => {
    const m = re.exec(k);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n) && n > maxN) maxN = n;
    }
  });
  return `${prefix}${maxN + 1}`;
}

// 1.0.47 호환 wrapper — 배달 한정 호출처용. 신규 호출은 findEmptySlotForType 사용.
export function findEmptyDeliverySlot(orders) {
  return findEmptySlotForType(orders, 'delivery');
}

// 2026-06-09: 같은 발신자의 "주문대기"(메뉴 없이 발신자 정보만 박힌) 슬롯 찾기.
//   전화 자동 stash / "주문받기" 가 멀티기기(PC·아이패드가 각자 10초 타이머) 또는 CID
//   재수신으로 같은 전화를 d2·d3 에 중복으로 박던 사고 처방. submitPendingAsType 이 새
//   슬롯을 만들기 전에 이걸로 기존 주문대기 슬롯을 찾아 재사용 → 전화 1통 = 슬롯 1개(멱등).
//   phone 이 있으면 phone(정규화 digits) 만으로 판정 — 다른 번호 = 다른 손님이므로 alias/
//   address 폴백을 타지 않음. phone 없는 발신자(드묾)만 alias 또는 address 로 매칭.
//   메뉴가 담긴 슬롯(items/cartItems)은 이미 작업 중이라 제외.
export function findPendingCallSlot(orders, opts = {}) {
  const wantDigits = String(opts.phone || '').replace(/\D/g, '');
  const wantAlias = String(opts.alias || '').trim();
  const wantAddress = String(opts.address || '').trim();
  if (!wantDigits && !wantAlias && !wantAddress) return null;
  const isPendingCall = (o) =>
    !!o &&
    (o.items?.length || 0) === 0 &&
    (o.cartItems?.length || 0) === 0 &&
    (!!o.deliveryPhone || !!o.deliveryAlias || !!o.deliveryAddress);
  const matches = (o) => {
    if (wantDigits) {
      const oDigits = String(o.deliveryPhone || '').replace(/\D/g, '');
      return !!oDigits && oDigits === wantDigits;
    }
    if (wantAlias && String(o.deliveryAlias || '').trim() === wantAlias) return true;
    if (wantAddress && String(o.deliveryAddress || '').trim() === wantAddress) return true;
    return false;
  };
  const keys = Object.keys(orders || {});
  for (let i = 0; i < keys.length; i += 1) {
    const o = orders[keys[i]];
    if (isPendingCall(o) && matches(o)) return keys[i];
  }
  return null;
}

// 동일한 (id, options, cookState/portion states, sourceTableId)를 가진 슬롯들을 qty/largeQty 합산하여 병합.
// 1.0.35: sourceTableId 추가 — 단체(group, 묶음) 결성 후에도 각 손님 테이블별 슬롯이 살아남아야
// 1인/테이블별 결제 분리가 가능. 동일 메뉴라도 sourceTable 이 다르면 별도 슬롯 유지.
// 옛 데이터 (sourceTableId 없음) 끼리는 그대로 합쳐짐 (둘 다 undefined → '' === '').
export function normalizeSlots(items) {
  const result = [];
  for (const item of items) {
    if (!item || item.qty <= 0) continue;
    const opts = [...(item.options || [])].sort();
    const memo = item.memo || '';
    const cs = item.cookState || 'pending';
    const csn = item.cookStateNormal || cs;
    const csl = item.cookStateLarge || cs;
    const src = item.sourceTableId || '';
    const idx = result.findIndex((r) => {
      const rcs = r.cookState || 'pending';
      return (
        r.id === item.id &&
        rcs === cs &&
        (r.cookStateNormal || rcs) === csn &&
        (r.cookStateLarge || rcs) === csl &&
        (r.memo || '') === memo &&
        (r.sourceTableId || '') === src &&
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

// 1.0.37: sourceTableId 별로 슬롯 그룹화. 단체 묶음 후 분리 결제 시
// 어느 손님 몫 매출인지 집계용. defaultTableId 는 옛 슬롯(sourceTable 미박힘) 의 fallback.
// 반환: Map<sourceTableId, slots[]>.
export function groupItemsBySource(items, defaultTableId) {
  const map = new Map();
  for (const i of items || []) {
    const src = i.sourceTableId || defaultTableId;
    if (!map.has(src)) map.set(src, []);
    map.get(src).push(i);
  }
  return map;
}

// 1.0.37: sourceTable 별 소계. 분리 결제 모달의 손님별 금액 표시 + 회계 사무소
// 송부 시 CSV 분리 컬럼. 반환: { [sourceTableId]: total }.
export function computeSubtotalsBySource(items, defaultTableId) {
  const map = groupItemsBySource(items, defaultTableId);
  const result = {};
  for (const [src, slots] of map.entries()) {
    result[src] = computeItemsTotal(slots);
  }
  return result;
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
  // 1.0.34 fix: 기존 mergeLists 가 qty 만 합치고 largeQty/options/memo/cookState 무시.
  // 칼제비(대) 2개 + 칼제비(보통) 1개 가 모두 "보통 3개" 로 합쳐져 sizeUpcharge 손실 →
  // 가격 작아짐 (사장님 실제 사고: 47,000 기대 → 44,000 잘못). normalizeSlots 가 이미
  // 정확히 (id+options+memo+cookState 매칭, qty+largeQty 합산) 처리하므로 그것 사용.
  const mergeLists = (la, lb) => normalizeSlots([...la, ...lb]);
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
