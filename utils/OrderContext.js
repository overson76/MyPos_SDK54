import {
  createContext,
  useContext,
  useMemo,
  useReducer,
} from 'react';
import {
  sanitizeDeliveryAddress,
  sanitizeDeliveryTimeRaw,
} from './validate';
import {
  appendHistory,
  buildHistoryEntry,
  computeItemsTotal,
  detectDynamicSlotPrefix,
  resolveTableForAlert,
} from './orderHelpers';
import { addBreadcrumb } from './sentry';
import {
  emptyOrder,
  orderReducer,
  PENDING_TABLE_ID,
} from './orderReducer';
import { useOrderPersistence } from './useOrderPersistence';
import { useOrderFirestoreSync } from './useOrderFirestoreSync';
import { useDeliveryAlerts } from './useDeliveryAlerts';
import { useAutoClearDelivery } from './useAutoClearDelivery';
import { useAddressBook } from './useAddressBook';
import { useRevenue } from './useRevenue';
import { useSplits } from './useSplits';
import { useGroups } from './useGroups';

const OrderContext = createContext(null);

// PENDING_TABLE_ID 의 단일 진실 소스는 orderReducer. 외부 호출처가 종전대로
// 'utils/OrderContext' 에서 import 할 수 있도록 re-export.
export { PENDING_TABLE_ID };

export function OrderProvider({ children }) {
  const [orders, dispatch] = useReducer(orderReducer, {});

  const { splits, setSplits, isSplit, toggleSplit } = useSplits({
    orders,
    dispatch,
  });
  const { groups, setGroups, getGroupFor, dissolveGroup, createGroup } =
    useGroups({ orders, dispatch });
  const { revenue, setRevenue } = useRevenue();
  const {
    addressBook,
    setAddressBook,
    bumpAddress,
    markAddressDeliveredToday,
    pinAddress,
    deleteAddress,
    setAutoRemember,
    setAlias,
    setPhone,
    addAddress,
  } = useAddressBook();

  useOrderPersistence({
    orders,
    dispatch,
    splits,
    setSplits,
    groups,
    setGroups,
    revenue,
    setRevenue,
    addressBook,
    setAddressBook,
  });

  // 매장 단위 클라우드 동기화 — orders / splits / groups / revenue / addressBook 전부.
  // AsyncStorage(useOrderPersistence) 와 듀얼로 동작 (안전 우선).
  useOrderFirestoreSync({
    orders,
    dispatch,
    splits,
    setSplits,
    groups,
    setGroups,
    revenue,
    setRevenue,
    addressBook,
    setAddressBook,
  });

  useDeliveryAlerts({ orders, dispatch });
  useAutoClearDelivery({ orders, dispatch, setRevenue, bumpAddress });

  const value = useMemo(() => {
    // 분할 정리 — dispatch 직후의 next orders 를 인자로 받아 #1/#2 둘 다 비었는지 검사.
    // dispatch 가 비동기로 보일 수 있어 wrapper 에서 next orders 를 미리 계산해 넘긴다.
    const maybeUnsplitAfter = (tableId, nextOrders) => {
      if (!tableId.includes('#')) return;
      const parentId = tableId.split('#')[0];
      if (!splits[parentId]) return;
      const p1 = nextOrders[`${parentId}#1`];
      const p2 = nextOrders[`${parentId}#2`];
      const empty = (o) =>
        !o ||
        ((o.items || []).length === 0 &&
          (o.cartItems || []).length === 0 &&
          (o.confirmedItems || []).length === 0);
      const bothEmpty = empty(p1) && empty(p2);
      if (bothEmpty) {
        setSplits((prev) => {
          const { [parentId]: _, ...rest } = prev;
          return rest;
        });
      }
    };

    const addItem = (tableId, menuItem, preferredSlotId) => {
      if (!tableId) return;
      dispatch({
        type: 'orders/addItem',
        tableId,
        menuItem,
        preferredSlotId,
      });
    };

    // 장바구니에서 1개 감산. cart/items/confirmed 모두 비면 테이블 삭제 + split 정리.
    // 빈 여부 판단을 wrapper 에서 미리 해야 maybeUnsplitAfter 의 nextOrders 인자가 채워짐.
    const removeItem = (tableId, slotIdOrMenuId) => {
      const existing = orders[tableId];
      if (!existing) return;
      const cart =
        existing.cartItems ??
        (existing.items ? existing.items.map((i) => ({ ...i })) : []);
      const nextCart = cart
        .map((i) => {
          const match =
            i.slotId === slotIdOrMenuId || i.id === slotIdOrMenuId;
          if (!match) return i;
          const nextQty = i.qty - 1;
          return {
            ...i,
            qty: nextQty,
            largeQty: Math.min(i.largeQty || 0, Math.max(0, nextQty)),
          };
        })
        .filter((i) => i.qty > 0);
      const itemsEmpty = (existing.items || []).length === 0;
      const confirmedEmpty = (existing.confirmedItems || []).length === 0;
      if (nextCart.length === 0 && itemsEmpty && confirmedEmpty) {
        const { [tableId]: _, ...nextOrders } = orders;
        dispatch({ type: 'orders/removeTable', tableId });
        maybeUnsplitAfter(tableId, nextOrders);
      } else {
        dispatch({
          type: 'orders/removeItemFromCart',
          tableId,
          slotIdOrMenuId,
        });
      }
    };

    // paymentMethod: 후불 결제(테이블 정리 시점에 결제) 시 결제수단 선택값.
    //   비우면 슬롯에 이미 저장된 paymentMethod (선불 시 markPaid 가 저장한 값) 사용.
    const clearTable = (tableId, paymentMethod = null) => {
      addBreadcrumb('order.clearTable', { tableId, paymentMethod });
      // 단체(그룹)에 속해 있으면 리더 tableId 로 통일하고, 비운 뒤 그룹 해제
      let targetId = tableId;
      let groupLeaderToDissolve = null;
      for (const [lid, members] of Object.entries(groups)) {
        if (members.includes(tableId) || lid === tableId) {
          targetId = lid;
          groupLeaderToDissolve = lid;
          break;
        }
      }
      const existing = orders[targetId];
      if (existing && (existing.items || []).length > 0) {
        const total = computeItemsTotal(existing.items);
        setRevenue((prev) =>
          appendHistory(
            prev,
            buildHistoryEntry({
              tableId: targetId,
              items: existing.items,
              options: existing.options,
              deliveryAddress: existing.deliveryAddress,
              deliveryTime: existing.deliveryTime,
              paymentStatus: existing.paymentStatus,
              paymentMethod: paymentMethod || existing.paymentMethod || null,
              total,
            })
          )
        );
        // 배달 주소록 카운트 — 수동 clear 도 동일하게 반영
        if (existing.deliveryAddress) {
          const tbl = resolveTableForAlert(targetId);
          if (tbl && tbl.type === 'delivery') {
            bumpAddress(existing.deliveryAddress);
          }
        }
      }
      const { [targetId]: _, ...nextOrders } = orders;
      dispatch({ type: 'orders/removeTable', tableId: targetId });
      maybeUnsplitAfter(targetId, nextOrders);
      // 동적 슬롯(예약/포장/배달) 이면 빈 번호 메꿈 —
      // 자리이동·포장결제완료·배달자동정리 경로와 동일한 처리. 분할 슬롯('y2#1') 은 prefix 매칭에서 자연 제외.
      const prefix = detectDynamicSlotPrefix(targetId);
      if (prefix) {
        dispatch({ type: 'orders/compactSlots', prefix });
      }
      if (groupLeaderToDissolve) {
        setGroups((prev) => {
          if (!prev[groupLeaderToDissolve]) return prev;
          const { [groupLeaderToDissolve]: _removed, ...rest } = prev;
          return rest;
        });
      }
    };

    const markReady = (tableId) => {
      addBreadcrumb('order.markReady', { tableId });
      dispatch({ type: 'orders/markReady', tableId });
    };

    const setDeliveryAddress = (tableId, address) => {
      const safeAddress = sanitizeDeliveryAddress(address);
      dispatch({
        type: 'orders/setDeliveryAddress',
        tableId,
        safeAddress,
      });
    };

    const setDeliveryTime = (tableId, time) => {
      const safeTime = sanitizeDeliveryTimeRaw(time);
      dispatch({
        type: 'orders/setDeliveryTime',
        tableId,
        safeTime,
      });
    };

    const setDeliveryTimeIsPM = (tableId, isPM) => {
      dispatch({
        type: 'orders/setDeliveryTimeIsPM',
        tableId,
        isPM,
      });
    };

    const moveOrder = (fromId, toId) => {
      if (!fromId || !toId || fromId === toId) return false;
      const src = orders[fromId];
      if (!src) return false;
      addBreadcrumb('table.moveOrder', { fromId, toId });
      const dst = orders[toId];
      const dstEmpty =
        !dst ||
        ((dst.items || []).length === 0 &&
          (dst.cartItems || []).length === 0 &&
          (dst.confirmedItems || []).length === 0);
      if (!dstEmpty) return false;
      dispatch({ type: 'orders/moveOrder', fromId, toId });
      // 자리이동 출처가 동적 슬롯(예약/포장/배달) 이면 빈 번호 메꿈.
      // 예: y2 가 t05 로 이동하면 y3 → y2, y4 → y3 ... 으로 재키잉.
      const prefix = detectDynamicSlotPrefix(fromId);
      if (prefix) {
        dispatch({ type: 'orders/compactSlots', prefix });
      }
      return true;
    };

    // 음식 클릭 3단계 순환: pending → cooking → cooked → pending
    const cycleItemCookState = (tableId, slotIdOrMenuId) => {
      dispatch({
        type: 'orders/cycleItemCookState',
        tableId,
        slotIdOrMenuId,
      });
    };

    const toggleItemCooked = cycleItemCookState; // 하위 호환

    // 특정 포션(보통/대) 만 cookState 순환 — reducer 가 cookStateNormal/Large 필드 관리.
    const cycleItemCookStatePortion = (tableId, slotId, isLarge) => {
      dispatch({
        type: 'orders/cycleItemCookStatePortion',
        tableId,
        slotId,
        isLarge,
      });
    };

    const incrementSlotQty = (tableId, slotId) => {
      dispatch({
        type: 'orders/incrementSlotQty',
        tableId,
        slotId,
      });
    };

    const splitOffWithOptionToggle = (tableId, slotId, count, optionId) => {
      dispatch({
        type: 'orders/splitOffWithOptionToggle',
        tableId,
        slotId,
        count,
        optionId,
      });
    };

    const toggleItemOption = (tableId, slotId, optionId) => {
      dispatch({
        type: 'orders/toggleItemOption',
        tableId,
        slotId,
        optionId,
      });
    };

    const setItemMemo = (tableId, slotId, memo) => {
      dispatch({
        type: 'orders/setItemMemo',
        tableId,
        slotId,
        memo,
      });
    };

    const setItemLargeQty = (tableId, slotIdOrMenuId, largeQty) => {
      dispatch({
        type: 'orders/setItemLargeQty',
        tableId,
        slotIdOrMenuId,
        largeQty,
      });
    };

    const confirmOrder = (tableId) => {
      addBreadcrumb('order.confirm', {
        tableId,
        cartCount: (orders[tableId]?.cartItems || []).length,
      });
      // 배달 테이블이면 주문 확정 즉시 주소를 todayDelivered 로 마크 (카운트는 +1 안 함 —
      // 실제 배달 완료 시점에 +1). 같은 주소로 또 주문하지 않게 칩에서 회색으로 즉시 밀어냄.
      const ex0 = orders[tableId];
      if (ex0?.deliveryAddress) {
        const tbl = resolveTableForAlert(tableId);
        if (tbl?.type === 'delivery') {
          markAddressDeliveredToday(ex0.deliveryAddress);
        }
      }
      dispatch({ type: 'orders/confirmOrder', tableId });
    };

    const toggleOption = (tableId, optionId) => {
      dispatch({ type: 'orders/toggleOption', tableId, optionId });
    };

    // paymentMethod: 'cash' | 'card' | 'transfer' | 'localCurrency' | null
    //   결제수단 선택 모달이 사용자 선택값을 전달. 미선택(null) 도 허용 — 회계엔 '미분류'.
    const markPaid = (tableId, paymentMethod = null) => {
      addBreadcrumb('order.markPaid', { tableId, paymentMethod });
      // 포장(p prefix) 은 결제 완료 = 픽업 종료 → 매출 기록 + 슬롯 제거 + compact.
      // 그 외(일반/배달/예약/분할) 는 기존 동작: paymentStatus 만 'paid' 로 변경.
      const prefix = detectDynamicSlotPrefix(tableId);
      if (prefix === 'p') {
        const existing = orders[tableId];
        if (existing && (existing.items || []).length > 0) {
          const total = computeItemsTotal(existing.items);
          setRevenue((prev) =>
            appendHistory(
              prev,
              buildHistoryEntry({
                tableId,
                items: existing.items,
                options: existing.options,
                paymentStatus: 'paid',
                paymentMethod,
                total,
              })
            )
          );
        }
        dispatch({ type: 'orders/removeTable', tableId });
        dispatch({ type: 'orders/compactSlots', prefix: 'p' });
        return;
      }
      dispatch({ type: 'orders/markPaid', tableId, paymentMethod });
    };

    const getOrder = (tableId) => orders[tableId] || emptyOrder;

    const getOrderTotal = (tableId) =>
      computeItemsTotal(orders[tableId]?.items);

    const getOrderQty = (tableId) => {
      const items = orders[tableId]?.items || [];
      return items.reduce((s, i) => s + i.qty, 0);
    };

    // 장바구니 기준 합계 — OrderScreen 에서 편집 중인 내역 표시용
    const getCartTotal = (tableId) => {
      const o = orders[tableId];
      if (!o) return 0;
      return computeItemsTotal(o.cartItems ?? o.items);
    };

    const getCartQty = (tableId) => {
      const o = orders[tableId];
      if (!o) return 0;
      const cart = o.cartItems ?? o.items ?? [];
      return cart.reduce((s, i) => s + i.qty, 0);
    };

    // 주문 탭에서 테이블 미선택으로 담은 장바구니(PENDING_TABLE_ID) 를
    // 실제 테이블로 이관. 대상 테이블에 이미 장바구니가 있으면 reducer 가 병합.
    const migratePendingCart = (toTableId) => {
      if (!toTableId || toTableId === PENDING_TABLE_ID) return;
      dispatch({ type: 'orders/migratePendingCart', toTableId });
    };

    // PENDING 장바구니 비우기 — 비우기 버튼 등에서 사용
    const clearPendingCart = () => {
      dispatch({ type: 'orders/clearPendingCart' });
    };

    return {
      orders,
      splits,
      revenue,
      addressBook,
      bumpAddress,
      markAddressDeliveredToday,
      pinAddress,
      deleteAddress,
      setAutoRemember,
      setAlias,
      setPhone,
      addAddress,
      isSplit,
      addItem,
      removeItem,
      clearTable,
      markReady,
      markPaid,
      confirmOrder,
      toggleOption,
      toggleItemCooked,
      cycleItemCookState,
      cycleItemCookStatePortion,
      toggleItemOption,
      incrementSlotQty,
      splitOffWithOptionToggle,
      setItemLargeQty,
      setItemMemo,
      setDeliveryAddress,
      setDeliveryTime,
      setDeliveryTimeIsPM,
      moveOrder,
      toggleSplit,
      getOrder,
      getOrderTotal,
      getOrderQty,
      getCartTotal,
      getCartQty,
      migratePendingCart,
      clearPendingCart,
      groups,
      createGroup,
      dissolveGroup,
      getGroupFor,
    };
  }, [orders, splits, revenue, groups, addressBook]);

  return (
    <OrderContext.Provider value={value}>{children}</OrderContext.Provider>
  );
}

// OrderProvider 언마운트 중(매장 떠나기/강퇴 → UNJOINED 전환)에 ctx가 null이 되면
// throw 대신 안전한 빈 기본값 반환 — iOS 새 아키텍처 크래시 방지.
const noop = () => {};
const ORDERS_FALLBACK = {
  orders: {}, splits: {}, revenue: { total: 0, history: [] },
  addressBook: { entries: {} }, groups: {},
  bumpAddress: noop, markAddressDeliveredToday: noop, pinAddress: noop,
  deleteAddress: noop, setAutoRemember: noop, setAlias: noop, setPhone: noop,
  addAddress: noop, isSplit: () => false,
  addItem: noop, removeItem: noop, clearTable: noop,
  markReady: noop, markPaid: noop, confirmOrder: noop,
  toggleOption: noop, toggleItemCooked: noop,
  cycleItemCookState: noop, cycleItemCookStatePortion: noop,
  toggleItemOption: noop, incrementSlotQty: noop,
  splitOffWithOptionToggle: noop, setItemLargeQty: noop, setItemMemo: noop,
  setDeliveryAddress: noop, setDeliveryTime: noop, setDeliveryTimeIsPM: noop,
  moveOrder: noop, toggleSplit: noop,
  getOrder: () => ({ items: [], cartItems: [], confirmedItems: [] }),
  getOrderTotal: () => 0, getOrderQty: () => 0,
  getCartTotal: () => 0, getCartQty: () => 0,
  migratePendingCart: noop, clearPendingCart: noop,
  createGroup: noop, dissolveGroup: noop, getGroupFor: () => null,
};

export function useOrders() {
  const ctx = useContext(OrderContext);
  if (!ctx) return ORDERS_FALLBACK;
  return ctx;
}
