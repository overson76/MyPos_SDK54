import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import { computeDiffRows } from './orderDiff';
import {
  sanitizeDeliveryAddress,
  sanitizeDeliveryTimeRaw,
} from './validate';
import {
  appendHistory,
  buildHistoryEntry,
  computeItemsTotal,
  computeSubtotalsBySource,
  detectDynamicSlotPrefix,
  findEmptyDeliverySlot,
  findEmptySlotForType,
  findPendingCallSlot,
  findHistoryEntry,
  groupItemsBySource,
  markHistoryReverted,
  normalizeAddressKey,
  resolveTableForAlert,
} from './orderHelpers';
import { resolveDeliveryIdentity } from './addressBookLookup';
import { isDrivingMSane, distanceKm } from './geocode';
import { addBreadcrumb } from './sentry';
import { resolveAnyTable } from './tableData';
import { setNotifyAddressBook } from './notify';
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
import { useStore } from './StoreContext';
import { useRevenue } from './useRevenue';
import { useSplits } from './useSplits';
import { useGroups } from './useGroups';

const OrderContext = createContext(null);

// PENDING_TABLE_ID 의 단일 진실 소스는 orderReducer. 외부 호출처가 종전대로
// 'utils/OrderContext' 에서 import 할 수 있도록 re-export.
export { PENDING_TABLE_ID };

export function OrderProvider({ children }) {
  const [orders, dispatch] = useReducer(orderReducer, {});

  // 1.0.20: 주문 확정 listeners — 자동 출력 hook(AutoPrintBridge) 등 외부 구독자.
  // ref 패턴으로 useMemo 의 deps 와 무관하게 stable. confirmOrder 가 호출 시 emit.
  const confirmListenersRef = useRef(new Set());
  const subscribeConfirmed = useCallback((cb) => {
    if (typeof cb !== 'function') return () => {};
    confirmListenersRef.current.add(cb);
    return () => {
      confirmListenersRef.current.delete(cb);
    };
  }, []);

  const { splits, setSplits, isSplit, toggleSplit } = useSplits({
    orders,
    dispatch,
  });
  const {
    groups,
    setGroups,
    getGroupFor,
    dissolveGroup,
    createGroup,
    getGroupMode,
    setGroupMode,
  } = useGroups({ orders, dispatch });
  const { revenue, setRevenue } = useRevenue();
  const {
    addressBook,
    setAddressBook,
    bumpAddress,
    markAddressDeliveredToday,
    pinAddress,
    deleteAddress,
    setAutoRemember,
    ignoreSimilarPair,
    setAlias,
    setPhone,
    setPhones,
    addPhone,
    removePhone,
    setCustomerRequest,
    addAddress,
    addPhoneOnly,
    editLabel,
    upsertEntryFromOrder,
    mergePhoneIntoEntry,
  } = useAddressBook();

  // 2026-05-28: drivingM sanity check 용 매장 좌표. StoreProvider 가 OrderProvider
  // 위에 mount 됨 (App.js JoinedAppTree). storeInfo.lat/lng 미설정이면 null —
  // isDrivingMSane 가 직선거리 모르면 절대값만 검증 (50km 상한).
  const { storeInfo: storeInfoForGuard } = useStore();
  const storeCoordForGuard = useMemo(() => {
    if (
      typeof storeInfoForGuard?.lat === 'number' &&
      typeof storeInfoForGuard?.lng === 'number'
    ) {
      return { lat: storeInfoForGuard.lat, lng: storeInfoForGuard.lng };
    }
    return null;
  }, [storeInfoForGuard?.lat, storeInfoForGuard?.lng]);

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
  useAutoClearDelivery({ orders, dispatch, setRevenue, bumpAddress, addressBook });

  // 음성 나레이션 모듈에 addressBook 캐시 sync — speak* 함수가 별칭/전번
  // 라벨을 그때그때 lookup 할 수 있게 (사장님 정책: 별칭 > 전번 > 주소).
  useEffect(() => {
    setNotifyAddressBook(addressBook);
  }, [addressBook]);

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

    // 1.0.35: sourceTableId 옵션 — 단체(group) 묶음 후 어느 손님 테이블이 시킨 건지
    // 명시. 없으면 tableId 자체. UI 측은 단체 leader 에 메뉴 추가 시 sourceTable
    // 선택 모달을 띄워 받음 (Phase 1.0.36).
    const addItem = (tableId, menuItem, preferredSlotId, sourceTableId) => {
      if (!tableId) return;
      dispatch({
        type: 'orders/addItem',
        tableId,
        menuItem,
        preferredSlotId,
        sourceTableId,
      });
    };

    // 2026-05-23: OrderScreen 진입 시 cartItems=[] && items.length>0 인 테이블을
    // 카트로 동기화. 호출자가 ref 가드로 진입 시 1 회만 호출 — 사장님이 - 키로
    // 비운 후 자동 복원되지 않도록 (그 케이스는 reducer 가드가 처리).
    const hydrateCartFromItems = (tableId) => {
      if (!tableId) return;
      dispatch({ type: 'orders/hydrateCartFromItems', tableId });
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
        // 별칭 > 전번 > 주소 우선순위를 재출력/표기 모두에 일관 적용하기 위해
        // history entry 에 식별자 같이 박음. 주문 객체에 명시 저장된 값 우선,
        // 없으면 주소록 lookup. 옛 history 는 빈값 → 주소만.
        const ident = resolveDeliveryIdentity(addressBook, existing.deliveryAddress, {
          alias: existing.deliveryAlias,
          phone: existing.deliveryPhone,
        });
        setRevenue((prev) =>
          appendHistory(
            prev,
            buildHistoryEntry({
              tableId: targetId,
              items: existing.items,
              options: existing.options,
              deliveryAddress: existing.deliveryAddress,
              deliveryAlias: ident.alias,
              deliveryPhone: ident.phone,
              deliveryPhones: ident.phones,
              deliveryTime: existing.deliveryTime,
              deliveryTimeIsPM: existing.deliveryTimeIsPM ?? true,
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
          // 2026-05-28: 결제완료 시점 안전망 — confirmOrder 시점 sync 가 어떤 이유로
          // 누락된 경우 (CID stash 슬롯과 작업 슬롯 어긋남, deliveryPhone 일시 누락 등)
          // 마지막으로 한 번 더 sync. upsertEntryFromOrder 는 멱등 — 이미 박힌 entry
          // 면 phones 중복 X, alias 빈 경우만 채움. delivery/takeout/reservation 모두.
          if (tbl && (tbl.type === 'delivery' || tbl.type === 'takeout' || tbl.type === 'reservation')) {
            upsertEntryFromOrder({
              address: existing.deliveryAddress,
              alias: existing.deliveryAlias || '',
              phone: existing.deliveryPhone || '',
            });
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

    // 1.0.37: 단체 묶음 후 테이블별 분리 결제 — 해당 sourceTable 의 슬롯만 history
    // 기록 + 제거. 모든 슬롯 비면 테이블 자체 제거 + group dissolve.
    // history entry 에 sourceTableId + isPartial 박힘 — 회계 사무소 송부 시 손님별
    // 분리 매출 식별 가능.
    const clearTableBySource = (tableId, sourceTableId, paymentMethod = null) => {
      addBreadcrumb('order.clearTableBySource', {
        tableId,
        sourceTableId,
        paymentMethod,
      });
      // 단체에 속해 있으면 리더 tableId 로 통일
      let targetId = tableId;
      let groupLeader = null;
      for (const [lid, members] of Object.entries(groups)) {
        if (members.includes(tableId) || lid === tableId) {
          targetId = lid;
          groupLeader = lid;
          break;
        }
      }
      const existing = orders[targetId];
      if (!existing) return;
      const matchedItems = (existing.items || []).filter(
        (i) => (i.sourceTableId || targetId) === sourceTableId
      );
      if (matchedItems.length > 0) {
        const total = computeItemsTotal(matchedItems);
        const ident = resolveDeliveryIdentity(addressBook, existing.deliveryAddress, {
          alias: existing.deliveryAlias,
          phone: existing.deliveryPhone,
        });
        setRevenue((prev) =>
          appendHistory(
            prev,
            buildHistoryEntry({
              tableId: targetId,
              items: matchedItems,
              options: existing.options,
              deliveryAddress: existing.deliveryAddress,
              deliveryAlias: ident.alias,
              deliveryPhone: ident.phone,
              deliveryPhones: ident.phones,
              deliveryTime: existing.deliveryTime,
              deliveryTimeIsPM: existing.deliveryTimeIsPM ?? true,
              paymentStatus: 'paid',
              paymentMethod,
              total,
              extraFields: { sourceTableId, isPartial: true },
            })
          )
        );
      }
      dispatch({
        type: 'orders/clearTableBySource',
        tableId: targetId,
        sourceTableId,
      });
      // 모든 슬롯 비었으면 group dissolve (테이블 자체는 reducer 가 제거)
      const remainingFilter = (i) =>
        (i.sourceTableId || targetId) !== sourceTableId;
      const remainingItems = (existing.items || []).filter(remainingFilter);
      const remainingCart = (existing.cartItems || []).filter(remainingFilter);
      const remainingConfirmed = (existing.confirmedItems || []).filter(
        remainingFilter
      );
      if (
        remainingItems.length === 0 &&
        remainingCart.length === 0 &&
        remainingConfirmed.length === 0 &&
        groupLeader
      ) {
        setGroups((prev) => {
          if (!prev[groupLeader]) return prev;
          const { [groupLeader]: _removed, ...rest } = prev;
          return rest;
        });
      }
    };

    const markReady = (tableId) => {
      addBreadcrumb('order.markReady', { tableId });
      dispatch({ type: 'orders/markReady', tableId });
    };

    // 2026-06-11: 주방 "조리중" 버튼 — 테이블 전체 항목 일괄 조리 시작/해제 (cooked 유지).
    const markCookingAll = (tableId, on = true) => {
      addBreadcrumb('order.markCookingAll', { tableId, on });
      dispatch({ type: 'orders/startCookingAll', tableId, on });
    };

    // 조리완료 실수 되돌리기 — 테이블이 살아있는 상태에서 status 만 'preparing' 으로 토글.
    // KitchenScreen 의 status!=='ready' 필터에 다시 걸려서 즉시 주문현황 목록에 복귀.
    const undoMarkReady = (tableId) => {
      if (!tableId) return false;
      const existing = orders[tableId];
      if (!existing || existing.status !== 'ready') return false;
      addBreadcrumb('order.undoMarkReady', { tableId });
      dispatch({ type: 'orders/undoMarkReady', tableId });
      return true;
    };

    // 결제완료/테이블비우기 되돌리기 — history entry 기반으로 테이블 부활.
    // 같은 tableId 가 이미 살아있으면(누가 새 주문 받음) 거부.
    // history entry 는 삭제 안 함 — reverted 플래그만 박아 매출 집계에서 제외.
    // 반환: { ok: true } | { ok: false, reason: 'notFound'|'occupied'|'alreadyReverted' }
    const revertHistoryEntry = (entryId) => {
      const entry = findHistoryEntry(revenue?.history, entryId);
      if (!entry) return { ok: false, reason: 'notFound' };
      if (entry.reverted) return { ok: false, reason: 'alreadyReverted' };
      const targetId = entry.tableId;
      if (orders[targetId]) return { ok: false, reason: 'occupied' };
      addBreadcrumb('order.revertHistory', { entryId, tableId: targetId });
      dispatch({ type: 'orders/restoreFromHistory', tableId: targetId, entry });
      setRevenue((prev) => markHistoryReverted(prev, entryId));
      return { ok: true };
    };

    const setDeliveryAddress = (tableId, address) => {
      const safeAddress = sanitizeDeliveryAddress(address);
      dispatch({
        type: 'orders/setDeliveryAddress',
        tableId,
        safeAddress,
      });
    };

    // 1.0.47: 배달 phone/alias 박기 — CID "주문받기" 흐름에서 PENDING_TABLE_ID 또는
    // 배달 슬롯에 발신번호/단골 별칭 미리 박을 때 사용. reducer 가 자체 sanitize.
    // 2026-06-12: 위치 인자 (tableId, phone, alias) 도 허용 — OrderScreen 3곳이 5/25부터
    //   위치 인자로 불러 문자열이 객체 구조분해되며 undefined → 슬롯 발신자 도장이
    //   조용히 지워지던 잠복 버그. 같은 실수가 재발해도 동작하도록 두 형태 모두 흡수.
    const setDeliveryContact = (tableId, phoneOrOpts, maybeAlias) => {
      const opts =
        phoneOrOpts && typeof phoneOrOpts === 'object'
          ? phoneOrOpts
          : { phone: phoneOrOpts, alias: maybeAlias };
      dispatch({
        type: 'orders/setDeliveryContact',
        tableId,
        phone: opts.phone || null,
        alias: opts.alias || null,
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

    // 예약 빠른 등록 — 메뉴 없이 인원 + 시간만으로 예약 슬롯 점유 (2026-06-04 사장님 요청).
    // partySize / time / isPM 중 주어진 값만 반영 (나머지는 reducer 가 기존값 유지).
    const setReservationInfo = (tableId, { partySize, time, isPM } = {}) => {
      const safeTime = time != null ? sanitizeDeliveryTimeRaw(time) : null;
      dispatch({
        type: 'orders/setReservationInfo',
        tableId,
        partySize: typeof partySize === 'number' ? partySize : undefined,
        safeTime,
        isPM: typeof isPM === 'boolean' ? isPM : undefined,
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

    const splitOffWithOptionToggle = (tableId, slotId, count, optionId, isLarge) => {
      dispatch({
        type: 'orders/splitOffWithOptionToggle',
        tableId,
        slotId,
        count,
        optionId,
        isLarge: !!isLarge,
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
      // 1.0.20: 자동 출력 hook 을 위해 호출 시점에 메타/diff 캡처. dispatch 후엔
      // confirmedItems 가 새 값으로 바뀌어 diff 가 모두 unchanged 가 되므로 의미 없음.
      // 1.0.32: 모든 출력 영수증 빌더 통일 — items / total 도 emit 에 포함.
      // 1.0.40: 첫 주문(특히 배달 d1/d2 슬롯) 시 items 는 아직 [] 이고 사용자가 담은
      // 메뉴는 cartItems 에만 있음. dispatch 후 cartItems → items 로 커밋되지만 emit
      // 시점엔 옛 스냅샷이라 itemsSnap 이 [] 로 잡혀 메뉴 없는 영수증이 출력되던 버그
      // (사장님 신고: "배달 주문 영수증에 메뉴 빠지고 배달지만 나옴"). cartItems 우선,
      // fallback 으로 items — 양쪽 매장(t01) / 배달(d1) 모두 정확.
      const orderSnap = orders[tableId];
      const wasConfirmed = (orderSnap?.confirmedItems?.length ?? 0) > 0;
      const tblForListener = resolveTableForAlert(tableId);
      const diffRows = orderSnap
        ? computeDiffRows(orderSnap.items, orderSnap.confirmedItems || [])
        : [];
      const itemsSnap =
        orderSnap?.cartItems ?? orderSnap?.items ?? [];
      const totalSnap = computeItemsTotal(itemsSnap);

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

      // 2026-05-27: 사장님 호소 "분명히 등록한 번호인데 새 전화로 인식" 영구 처방.
      // 배달/포장/예약 주문 확정 시 사장님 입력 phone + address (+alias) 자동
      // 주소록 entry sync — alias 박혀있어 AliasPromptModal 안 거치는 케이스에서도
      // 새 phone 이 entry.phones 에 자동 통합. 다음 같은 phone 전화 시 매칭 OK.
      // upsertEntryFromOrder 의 정책: 기존 entry 있으면 phones 추가 (중복 X) + alias
      // 빈 경우만 채움 (덮어쓰기 X), 새 entry 면 생성 + CID __phone:digits 자동 통합.
      //
      // 2026-05-28: 사장님 신고 "310-603 entry 에 phone 안 박힘" — phone 가드가
      // 너무 빡빡해서 deliveryPhone 슬롯이 어떤 이유로든 비면 entry 생성 자체가
      // 안 됐음. 사장님 시나리오 = CID 알림 떴고 주소만 짧게 입력. CID stash 슬롯
      // 안 쓰고 다른 슬롯 만들었거나 phoneNumber 가 LG U+ 일시 누락. 주소만 있어도
      // entry 생성하도록 가드 완화 — phone 빈 채로 박혀도 다음에 사장님이 직접 채우거나
      // 같은 주소 재주문 시 phone 통합됨.
      if (
        (tblForListener?.type === 'delivery' ||
          tblForListener?.type === 'takeout' ||
          tblForListener?.type === 'reservation') &&
        orderSnap?.deliveryAddress
      ) {
        upsertEntryFromOrder({
          address: orderSnap.deliveryAddress,
          alias: orderSnap.deliveryAlias || '',
          phone: orderSnap.deliveryPhone || '',
        });
      }

      // 1.0.44: 자동 출력 — 상황별 영수증을 위해 주소록 entry 조회로 손님번호/별칭/
      // 도로 실거리/예약시각 까지 함께 emit. 주소록은 useAddressBook 이 lat/lng/
      // drivingM 백그라운드 채움 — 처음 입력 직후 confirm 시엔 null 일 수 있음 (정상).
      // 2026-05-28: order 자체의 deliveryPhone/Alias 도 fallback — entry 가 phone 없는
      // 잠복 케이스에서 CID phone 이 출력물에 누락되던 사고 방어. 별칭→전번→주소 우선순위.
      const orderType = tblForListener?.type || 'regular';
      let customerPhone = orderSnap?.deliveryPhone || null;
      let customerAlias = orderSnap?.deliveryAlias || null;
      let drivingDistanceM = null;
      let drivingDurationSec = null;
      const addrForLookup = orderSnap?.deliveryAddress || '';
      if (orderType === 'delivery' && addrForLookup) {
        const akey = normalizeAddressKey(addrForLookup);
        const entry = akey ? addressBook?.entries?.[akey] : null;
        if (entry) {
          customerPhone = entry.phone || customerPhone;
          customerAlias = entry.alias || customerAlias;
          // 2026-05-28: drivingM sanity check — 잠복 비정상 entry (300km+) 가
          // 자동 출력 영수증 / 주문 emit 에 흘러가지 않도록. 매장좌표 + entry 좌표
          // 모두 있을 때만 직선거리 비교, 없으면 절대값 가드만.
          const straightKm =
            storeCoordForGuard &&
            typeof entry.lat === 'number' &&
            typeof entry.lng === 'number'
              ? distanceKm(storeCoordForGuard, { lat: entry.lat, lng: entry.lng })
              : null;
          if (isDrivingMSane(entry.drivingM, straightKm)) {
            drivingDistanceM = entry.drivingM;
            drivingDurationSec =
              typeof entry.drivingDurationSec === 'number'
                ? entry.drivingDurationSec
                : null;
          } else {
            drivingDistanceM = null;
            drivingDurationSec = null;
          }
        }
      }

      // 자동 출력 listeners 호출 — 다음 tick (영업 흐름 안 막게) + 캡처한 데이터 전달.
      // 1.0.32: 영수증 빌더 통일 — items / total 도 함께 emit.
      // 1.0.44: orderType + scheduledTime + customer/driving 필드 추가.
      if (confirmListenersRef.current.size > 0) {
        setTimeout(() => {
          for (const cb of confirmListenersRef.current) {
            try {
              cb({
                tableId,
                isFresh: !wasConfirmed,
                rows: diffRows,
                items: itemsSnap,
                total: totalSnap,
                isDelivery: orderType === 'delivery',
                orderType,
                deliveryAddress: orderSnap?.deliveryAddress || '',
                tableLabel: tblForListener?.label || tableId,
                scheduledTime: orderSnap?.deliveryTime || '',
                scheduledTimeIsPM: orderSnap?.deliveryTimeIsPM ?? true,
                customerPhone,
                customerAlias,
                drivingDistanceM,
                drivingDurationSec,
              });
            } catch {}
          }
        }, 0);
      }
    };

    const toggleOption = (tableId, optionId) => {
      dispatch({ type: 'orders/toggleOption', tableId, optionId });
    };

    // paymentMethod: 'cash' | 'card' | 'transfer' | 'localCurrency' | null
    //   결제수단 선택 모달이 사용자 선택값을 전달. 미선택(null) 도 허용 — 회계엔 '미분류'.
    const markPaid = (tableId, paymentMethod = null) => {
      addBreadcrumb('order.markPaid', { tableId, paymentMethod });
      // 1.0.23: 포장(p prefix) 도 일반 테이블처럼 paymentStatus 만 'paid' 로 변경.
      // 사장님 요청: "포장은 선불이 많기 때문에 선불결재 시 바로 사라지면 안 되고
      // 픽업완료 버튼을 눌렀을 때 사라지게". → 매출 기록 + 슬롯 제거는 별도 pickupComplete
      // 액션이 담당. (clearTable 또는 새 함수)
      dispatch({ type: 'orders/markPaid', tableId, paymentMethod });

      // 1.0.22: 단체(그룹) 의 일부였다면 결제 완료 시 그룹 자동 분리 — 사장님 의도
      // "본 테이블로 분리". clearTable 은 슬롯도 정리하지만 markPaid 는 결제 완료
      // 표시만 + 그룹 묶임만 해제 (items / 슬롯 그대로 유지). leader id 또는 멤버 id
      // 어느 쪽으로 호출돼도 매칭.
      for (const [lid, members] of Object.entries(groups)) {
        if (lid === tableId || (Array.isArray(members) && members.includes(tableId))) {
          dissolveGroup(lid);
          break;
        }
      }
    };

    const getOrder = (tableId) => orders[tableId] || emptyOrder;

    // 조리완료(readyAt 있음) + 아직 결제 안 된 배달 자리 목록.
    // 회수 차수에 결제완료 대신 조리완료 시점부터 포함하기 위한 어댑터.
    // 사장님 의도: 후불 배달이라 결제완료가 늦게 잡혀 회수 차수 누락되던 문제 해소.
    // history schema 와 통일 — { id, deliveryAddress, items, clearedAt, paymentStatus: 'ready', reverted: false }.
    const getReadyDeliveries = () => {
      const result = [];
      for (const [tableId, order] of Object.entries(orders || {})) {
        if (!order || tableId === PENDING_TABLE_ID) continue;
        if (!order.readyAt) continue;
        if (order.paid) continue; // 결제완료는 history 가 담당
        const table = resolveAnyTable(tableId);
        if (table?.type !== 'delivery') continue;
        const addr = (order.deliveryAddress || '').trim();
        if (!addr) continue;
        result.push({
          id: `ready:${tableId}`,
          tableId,
          deliveryAddress: addr,
          items: order.items || [],
          clearedAt: order.readyAt,
          paymentStatus: 'ready',
          reverted: false,
        });
      }
      return result;
    };

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

    // 1.0.47 → 2026-05-21: PENDING 장바구니 → 빈 슬롯 자동 배당 + 주소/전화/별칭 박기.
    //   type: 'delivery' | 'reservation' | 'takeout' — 사장님이 OrderTypePicker 모달에서 선택.
    //   d1..d5 / y1..y2 / p1..p2 정적 순서대로 빈 슬롯, 모두 차있으면 동적 확장.
    // 반환: 배당된 슬롯 ID (caller 가 setSelectedTable 호출해서 그 테이블로 진입)
    const submitPendingAsType = (type, opts = {}) => {
      const { deliveryAddress, deliveryPhone, deliveryAlias, migrateCart = true } = opts;
      // 2026-06-09: 전화 흐름(migrateCart=false: 10초 자동 stash / CID "주문받기")에서
      //   같은 발신자의 "주문대기" 슬롯이 이미 있으면 새 슬롯을 만들지 않고 재사용 —
      //   멀티기기 동시 stash / CID 재수신으로 같은 전화가 d2·d3 에 중복으로 박히던 사고
      //   처방. 전화 1통 = 슬롯 1개(멱등). 메뉴를 담기 시작한 슬롯은 findPendingCallSlot 이
      //   제외하므로, 같은 손님이 메뉴 담는 중 새 전화로 또 거는 의도적 2차 주문엔 영향 X.
      if (!migrateCart && (deliveryPhone || deliveryAlias || deliveryAddress)) {
        const reuseId = findPendingCallSlot(orders, {
          phone: deliveryPhone,
          alias: deliveryAlias,
          address: deliveryAddress,
        });
        if (reuseId) {
          // 기존 주문대기 슬롯에 최신 발신자 정보만 보강 (주소가 나중에 채워진 경우 등)
          if (deliveryAddress) {
            dispatch({
              type: 'orders/setDeliveryAddress',
              tableId: reuseId,
              safeAddress: sanitizeDeliveryAddress(deliveryAddress),
            });
          }
          if (deliveryPhone || deliveryAlias) {
            dispatch({
              type: 'orders/setDeliveryContact',
              tableId: reuseId,
              phone: deliveryPhone || null,
              alias: deliveryAlias || null,
            });
          }
          addBreadcrumb('order.submitPendingAsType.reuse', { type, reuseId });
          return reuseId;
        }
      }
      const targetId = findEmptySlotForType(orders, type);
      if (!targetId) return null;
      // 1단계: PENDING cart 있으면 슬롯으로 migrate. 없으면 빈 슬롯 그대로.
      // 2026-06-05: migrateCart=false (전화 자동 stash / CID "주문받기") 는 migrate 안 함 —
      //   사장님이 다른 손님 주문을 담는 중이어도 그 작업 카트를 가로채지 않게.
      //   OrderScreen "주문" 버튼만 기본 true (담은 메뉴를 슬롯으로 확정하는 정상 의도).
      if (migrateCart) {
        dispatch({ type: 'orders/migratePendingCart', toTableId: targetId });
      }
      // 2단계: 주소 박기 — setDeliveryAddress 헬퍼 재사용 (sanitize 포함)
      //   배달만 의미있지만 예약/포장도 들어와도 모델에 박힘 (영수증/카드 표시는 type 분기로 처리)
      if (deliveryAddress) {
        const safeAddress = sanitizeDeliveryAddress(deliveryAddress);
        dispatch({
          type: 'orders/setDeliveryAddress',
          tableId: targetId,
          safeAddress,
        });
      }
      // 3단계: phone / alias 박기 — 모든 type 에 의미있음 (단골 식별)
      if (deliveryPhone || deliveryAlias) {
        dispatch({
          type: 'orders/setDeliveryContact',
          tableId: targetId,
          phone: deliveryPhone || null,
          alias: deliveryAlias || null,
        });
      }
      addBreadcrumb('order.submitPendingAsType', {
        type,
        targetId,
        hasAddress: !!deliveryAddress,
        hasPhone: !!deliveryPhone,
      });
      return targetId;
    };

    // 1.0.47 호환 wrapper — 옛 호출처(테스트/외부) 안전. 신규는 submitPendingAsType 사용.
    const submitPendingAsDelivery = (opts = {}) =>
      submitPendingAsType('delivery', opts);

    return {
      orders,
      splits,
      revenue,
      addressBook,
      setAddressBook,
      bumpAddress,
      markAddressDeliveredToday,
      pinAddress,
      deleteAddress,
      setAutoRemember,
      ignoreSimilarPair,
      setAlias,
      setPhone,
      setPhones,
      addPhone,
      removePhone,
      setCustomerRequest,
      addAddress,
      addPhoneOnly,
      editLabel,
      upsertEntryFromOrder,
      mergePhoneIntoEntry,
      isSplit,
      addItem,
      removeItem,
      hydrateCartFromItems,
      clearTable,
      clearTableBySource,
      // 2026-05-28: 시연 / 매장 정리용 — 모든 슬롯 한 번에 제거.
      //   영업 중 실수 사고 방지 — AdminScreen 시연 섹션의 확인 모달 거침.
      //   local dispatch + Firestore 직접 batch.delete (양방향). onSnapshot 가
      //   옛 데이터 다시 hydrate 하는 사고 방지.
      clearAllSlots: async () => {
        addBreadcrumb('order.clearAllSlots', { count: Object.keys(orders).length });
        dispatch({ type: 'orders/clearAllSlots' });
        setGroups({});
        setSplits({});
        // Firestore 직접 비우기
        try {
          const { getFirestore: getFs } = await import('./firebase');
          const db = getFs();
          const sid = storeInfoForGuard?.storeId;
          if (!db || !sid) return;
          const storeRef = db.collection('stores').doc(sid);
          const snap = await storeRef.collection('orders').get();
          const batch = db.batch();
          snap.forEach((doc) => batch.delete(doc.ref));
          if (snap.size > 0) await batch.commit();
        } catch (e) {
          if (typeof console !== 'undefined') console.warn('[clearAllSlots] Firestore 비우기 실패', e);
        }
      },
      // 1.0.37: 분리 결제 / 영수증 빌더에서 sourceTable 별 소계 표시용.
      computeSubtotalsBySource: (items, defaultTableId) =>
        computeSubtotalsBySource(items, defaultTableId),
      groupItemsBySource: (items, defaultTableId) =>
        groupItemsBySource(items, defaultTableId),
      markReady,
      markCookingAll,
      undoMarkReady,
      revertHistoryEntry,
      markPaid,
      confirmOrder,
      subscribeConfirmed,
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
      setDeliveryContact,
      setDeliveryTime,
      setDeliveryTimeIsPM,
      setReservationInfo,
      moveOrder,
      toggleSplit,
      getOrder,
      getOrderTotal,
      getOrderQty,
      getCartTotal,
      getCartQty,
      getReadyDeliveries,
      migratePendingCart,
      clearPendingCart,
      submitPendingAsDelivery,
      submitPendingAsType,
      groups,
      createGroup,
      dissolveGroup,
      getGroupFor,
      getGroupMode,
      setGroupMode,
    };
  }, [orders, splits, revenue, groups, addressBook, getGroupMode, setGroupMode]);

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
  setAddressBook: noop,
  bumpAddress: noop, markAddressDeliveredToday: noop, pinAddress: noop,
  deleteAddress: noop, setAutoRemember: noop, ignoreSimilarPair: noop, setAlias: noop, setPhone: noop,
  setPhones: noop, addPhone: noop, removePhone: noop,
  setCustomerRequest: noop,
  addAddress: noop, addPhoneOnly: noop, editLabel: noop,
  upsertEntryFromOrder: () => null, mergePhoneIntoEntry: () => false,
  isSplit: () => false,
  addItem: noop, removeItem: noop, hydrateCartFromItems: noop,
  clearTable: noop, clearTableBySource: noop,
  computeSubtotalsBySource: () => ({}), groupItemsBySource: () => new Map(),
  markReady: noop, markCookingAll: noop, undoMarkReady: () => false,
  revertHistoryEntry: () => ({ ok: false, reason: 'notFound' }),
  markPaid: noop, confirmOrder: noop, subscribeConfirmed: () => () => {},
  toggleOption: noop, toggleItemCooked: noop,
  cycleItemCookState: noop, cycleItemCookStatePortion: noop,
  toggleItemOption: noop, incrementSlotQty: noop,
  splitOffWithOptionToggle: noop, setItemLargeQty: noop, setItemMemo: noop,
  setDeliveryAddress: noop, setDeliveryContact: noop, setDeliveryTime: noop, setDeliveryTimeIsPM: noop, setReservationInfo: noop,
  moveOrder: noop, toggleSplit: noop,
  getOrder: () => ({ items: [], cartItems: [], confirmedItems: [] }),
  getOrderTotal: () => 0, getOrderQty: () => 0,
  getCartTotal: () => 0, getCartQty: () => 0,
  getReadyDeliveries: () => [],
  migratePendingCart: noop, clearPendingCart: noop, submitPendingAsDelivery: () => null,
  submitPendingAsType: () => null,
  createGroup: noop, dissolveGroup: noop, getGroupFor: () => null,
  getGroupMode: () => 'shared', setGroupMode: noop,
};

export function useOrders() {
  const ctx = useContext(OrderContext);
  if (!ctx) return ORDERS_FALLBACK;
  return ctx;
}
