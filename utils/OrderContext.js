import {
  createContext,
  useContext,
  useMemo,
  useState,
} from 'react';
import {
  sanitizeDeliveryAddress,
  sanitizeDeliveryTimeRaw,
} from './validate';
import {
  appendHistory,
  buildHistoryEntry,
  computeItemsTotal,
  genSlotId,
  normalizeSlots,
  resolveTableForAlert,
} from './orderHelpers';
import { addBreadcrumb } from './sentry';
import { useOrderPersistence } from './useOrderPersistence';
import { useOrderFirestoreSync } from './useOrderFirestoreSync';
import { useDeliveryAlerts } from './useDeliveryAlerts';
import { useAutoClearDelivery } from './useAutoClearDelivery';
import { useAddressBook } from './useAddressBook';
import { useRevenue } from './useRevenue';
import { useSplits } from './useSplits';
import { useGroups } from './useGroups';

const OrderContext = createContext(null);

// 주문 탭에서 테이블 선택 없이 먼저 담는 장바구니용 가상 tableId
export const PENDING_TABLE_ID = '__pending__';

const emptyOrder = {
  items: [],        // 주방/테이블에 보여지는 확정된 주문
  cartItems: [],    // 사용자가 편집 중인 장바구니 (주문/변경 클릭시에만 items로 커밋)
  confirmedItems: [],
  createdAt: null,
  status: 'preparing',
  paymentStatus: 'unpaid',
  options: [],
  deliveryAddress: '',
  deliveryTime: '',
  deliveryTimeIsPM: true, // 기본 오후
  deliveryAlerted10: false, // 10분 전 알림 발화 여부
  deliveryAlerted5: false,  // 5분 전 알림 발화 여부
  readyAt: null,    // 조리완료 시각 — 배달 자동 정리용
};

export function OrderProvider({ children }) {
  const [orders, setOrders] = useState({});
  const { splits, setSplits, isSplit, toggleSplit } = useSplits({ setOrders });
  const { groups, setGroups, getGroupFor, dissolveGroup, createGroup } =
    useGroups({ setOrders });
  const { revenue, setRevenue } = useRevenue();
  const {
    addressBook,
    setAddressBook,
    bumpAddress,
    markAddressDeliveredToday,
    pinAddress,
    deleteAddress,
    setAutoRemember,
  } = useAddressBook();

  useOrderPersistence({
    orders,
    setOrders,
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
    setOrders,
    splits,
    setSplits,
    groups,
    setGroups,
    revenue,
    setRevenue,
    addressBook,
    setAddressBook,
  });

  useDeliveryAlerts({ orders, setOrders });
  useAutoClearDelivery({ orders, setOrders, setRevenue, bumpAddress });

  const value = useMemo(() => {
    const addItem = (tableId, menuItem, preferredSlotId) => {
      if (!tableId) return;
      setOrders((prev) => {
        const existing = prev[tableId];
        // 장바구니는 items가 확정된 이후에도 편집 대상. 없으면 items로 초기화.
        const current =
          existing?.cartItems ??
          (existing?.items ? existing.items.map((i) => ({ ...i })) : []);
        // 옵션 없고 pending인 동일 메뉴 슬롯이 있으면 거기에 누적
        const idx = current.findIndex(
          (i) =>
            i.id === menuItem.id &&
            (i.options || []).length === 0 &&
            (i.cookState || 'pending') === 'pending' &&
            !i.cookStateNormal &&
            !i.cookStateLarge
        );
        let nextCart;
        if (idx >= 0) {
          nextCart = current.map((i, j) =>
            j === idx ? { ...i, qty: i.qty + 1 } : i
          );
        } else {
          nextCart = [
            ...current,
            {
              slotId: preferredSlotId || genSlotId(),
              id: menuItem.id,
              name: menuItem.name,
              price: menuItem.price,
              qty: 1,
              cookState: 'pending',
              largeQty: 0,
              sizeGroup: menuItem.sizeGroup || null,
              sizeUpcharge: menuItem.sizeUpcharge || 0,
              options: [],
            },
          ];
        }
        nextCart = normalizeSlots(nextCart);
        return {
          ...prev,
          [tableId]: {
            items: existing?.items ?? [],
            cartItems: nextCart,
            confirmedItems: existing?.confirmedItems ?? [],
            createdAt: existing?.createdAt ?? Date.now(),
            status: existing?.status ?? 'preparing',
            paymentStatus: existing?.paymentStatus ?? 'unpaid',
            options: existing?.options ?? [],
            deliveryAddress: existing?.deliveryAddress ?? '',
            deliveryTime: existing?.deliveryTime ?? '',
            deliveryTimeIsPM: existing?.deliveryTimeIsPM ?? true,
            deliveryAlerted: existing?.deliveryAlerted ?? false,
            readyAt: existing?.readyAt ?? null,
          },
        };
      });
    };

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

    // slotId 기반. 호환을 위해 2번째 인자로 slotId 또는 menuId 받음.
    // 장바구니(cartItems)에서만 감산. items는 주문/변경 클릭시에만 반영됨.
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
      let nextOrders;
      // 장바구니/items/confirmed 모두 비어야만 주문 완전 삭제
      const itemsEmpty = (existing.items || []).length === 0;
      const confirmedEmpty = (existing.confirmedItems || []).length === 0;
      if (nextCart.length === 0 && itemsEmpty && confirmedEmpty) {
        const { [tableId]: _, ...rest } = orders;
        nextOrders = rest;
      } else {
        nextOrders = {
          ...orders,
          [tableId]: { ...existing, cartItems: nextCart },
        };
      }
      setOrders(nextOrders);
      if (nextCart.length === 0 && itemsEmpty && confirmedEmpty) {
        maybeUnsplitAfter(tableId, nextOrders);
      }
    };

    const clearTable = (tableId) => {
      addBreadcrumb('order.clearTable', { tableId });
      // 단체(그룹)에 속해 있으면 리더 tableId로 통일하고, 비운 뒤 그룹 해제
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
      setOrders(nextOrders);
      maybeUnsplitAfter(targetId, nextOrders);
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
      setOrders((prev) => {
        if (!prev[tableId]) return prev;
        const nextItems = prev[tableId].items.map((i) => {
          const { cookStateNormal, cookStateLarge, ...rest } = i;
          return {
            ...rest,
            cookState: 'cooked',
            cooked: true,
          };
        });
        return {
          ...prev,
          [tableId]: {
            ...prev[tableId],
            status: 'ready',
            items: nextItems,
            confirmedItems: nextItems.map((i) => ({ ...i })),
            readyAt: Date.now(),
          },
        };
      });
    };

    const setDeliveryAddress = (tableId, address) => {
      const safe = sanitizeDeliveryAddress(address);
      setOrders((prev) => {
        const existing = prev[tableId];
        if (!existing) {
          return {
            ...prev,
            [tableId]: {
              ...emptyOrder,
              createdAt: Date.now(),
              deliveryAddress: safe,
            },
          };
        }
        return {
          ...prev,
          [tableId]: { ...existing, deliveryAddress: safe },
        };
      });
    };

    const setDeliveryTime = (tableId, time) => {
      const safe = sanitizeDeliveryTimeRaw(time);
      setOrders((prev) => {
        const existing = prev[tableId];
        if (!existing) {
          return {
            ...prev,
            [tableId]: {
              ...emptyOrder,
              createdAt: Date.now(),
              deliveryTime: safe,
            },
          };
        }
        return {
          ...prev,
          [tableId]: {
            ...existing,
            deliveryTime: safe,
            deliveryAlerted10: false,
            deliveryAlerted5: false,
          },
        };
      });
    };

    const setDeliveryTimeIsPM = (tableId, isPM) => {
      setOrders((prev) => {
        const existing = prev[tableId];
        if (!existing) {
          return {
            ...prev,
            [tableId]: {
              ...emptyOrder,
              createdAt: Date.now(),
              deliveryTimeIsPM: !!isPM,
            },
          };
        }
        return {
          ...prev,
          [tableId]: {
            ...existing,
            deliveryTimeIsPM: !!isPM,
            deliveryAlerted10: false,
            deliveryAlerted5: false,
          },
        };
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
      setOrders((prev) => {
        const next = { ...prev };
        next[toId] = { ...prev[fromId] };
        delete next[fromId];
        return next;
      });
      return true;
    };

    // 음식 클릭 3단계 순환: pending → cooking → cooked → pending
    const cycleItemCookState = (tableId, slotIdOrMenuId) => {
      setOrders((prev) => {
        const existing = prev[tableId];
        if (!existing) return prev;
        const nextItems = existing.items.map((i) => {
          if (i.slotId !== slotIdOrMenuId && i.id !== slotIdOrMenuId) return i;
          const cur = i.cookState || 'pending';
          const nextState =
            cur === 'pending'
              ? 'cooking'
              : cur === 'cooking'
              ? 'cooked'
              : 'pending';
          return {
            ...i,
            cookState: nextState,
            cooked: nextState === 'cooked',
          };
        });
        const allCooked =
          nextItems.length > 0 &&
          nextItems.every((i) => (i.cookState || 'pending') === 'cooked');
        return {
          ...prev,
          [tableId]: {
            ...existing,
            items: nextItems,
            status: allCooked ? 'ready' : 'preparing',
          },
        };
      });
    };

    const toggleItemCooked = cycleItemCookState; // 하위 호환

    // 특정 포션(보통/대)만 cookState 순환. 슬롯을 분리하지 않고 포션별 상태를
    // cookStateNormal / cookStateLarge 필드로 관리해 diff 스냅샷을 깨뜨리지 않음.
    const cycleItemCookStatePortion = (tableId, slotId, isLarge) => {
      setOrders((prev) => {
        const existing = prev[tableId];
        if (!existing) return prev;
        const source = existing.items.find((i) => i.slotId === slotId);
        if (!source) return prev;
        const lq = source.largeQty || 0;
        const nq = source.qty - lq;
        const hasBoth = lq > 0 && nq > 0;

        // 단일 포션이면 기존 cookState 토글
        if (!hasBoth) {
          const cur = source.cookState || 'pending';
          const nextState =
            cur === 'pending'
              ? 'cooking'
              : cur === 'cooking'
              ? 'cooked'
              : 'pending';
          const nextItems = existing.items.map((i) => {
            if (i.slotId !== slotId) return i;
            const { cookStateNormal, cookStateLarge, ...rest } = i;
            return {
              ...rest,
              cookState: nextState,
              cooked: nextState === 'cooked',
            };
          });
          const allCooked =
            nextItems.length > 0 &&
            nextItems.every(
              (i) => (i.cookState || 'pending') === 'cooked'
            );
          return {
            ...prev,
            [tableId]: {
              ...existing,
              items: nextItems,
              status: allCooked ? 'ready' : 'preparing',
            },
          };
        }

        // 두 포션이 모두 있는 경우 → 클릭한 포션의 상태만 토글
        const portionKey = isLarge ? 'cookStateLarge' : 'cookStateNormal';
        const otherKey = isLarge ? 'cookStateNormal' : 'cookStateLarge';
        const baseCookState = source.cookState || 'pending';
        const curPortion = source[portionKey] || baseCookState;
        const nextPortion =
          curPortion === 'pending'
            ? 'cooking'
            : curPortion === 'cooking'
            ? 'cooked'
            : 'pending';
        const otherPortion = source[otherKey] || baseCookState;

        const nextItems = existing.items.map((i) => {
          if (i.slotId !== slotId) return i;
          if (nextPortion === otherPortion) {
            // 두 포션 상태가 같아지면 cookState로 통합하고 포션 필드 제거
            const { cookStateNormal, cookStateLarge, ...rest } = i;
            return {
              ...rest,
              cookState: nextPortion,
              cooked: nextPortion === 'cooked',
            };
          }
          return {
            ...i,
            [portionKey]: nextPortion,
            [otherKey]: otherPortion,
            // 포션별로 나뉘어 있으면 cookState는 중립값으로 설정 (둘 중 아무거나)
            cookState: baseCookState,
          };
        });

        const slotIsAllCooked = (i) => {
          const ilq = i.largeQty || 0;
          const inq = i.qty - ilq;
          const both = ilq > 0 && inq > 0;
          if (both) {
            const n = i.cookStateNormal || i.cookState || 'pending';
            const l = i.cookStateLarge || i.cookState || 'pending';
            return n === 'cooked' && l === 'cooked';
          }
          return (i.cookState || 'pending') === 'cooked';
        };
        const allCooked =
          nextItems.length > 0 && nextItems.every(slotIsAllCooked);
        return {
          ...prev,
          [tableId]: {
            ...existing,
            items: nextItems,
            status: allCooked ? 'ready' : 'preparing',
          },
        };
      });
    };

    // 특정 slot qty 증가 (장바구니 + 버튼용). cartItems만 수정.
    const incrementSlotQty = (tableId, slotId) => {
      setOrders((prev) => {
        const existing = prev[tableId];
        if (!existing) return prev;
        const cart =
          existing.cartItems ??
          (existing.items ? existing.items.map((i) => ({ ...i })) : []);
        const nextCart = cart.map((i) =>
          i.slotId === slotId ? { ...i, qty: i.qty + 1 } : i
        );
        return { ...prev, [tableId]: { ...existing, cartItems: nextCart } };
      });
    };

    // 슬롯에서 N개를 분리해서 optionId가 토글된 새 슬롯 생성 (cartItems 대상)
    const splitOffWithOptionToggle = (
      tableId,
      slotId,
      count,
      optionId
    ) => {
      setOrders((prev) => {
        const existing = prev[tableId];
        if (!existing) return prev;
        const cart =
          existing.cartItems ??
          (existing.items ? existing.items.map((i) => ({ ...i })) : []);
        const source = cart.find((i) => i.slotId === slotId);
        if (!source) return prev;
        const n = Math.max(0, Math.min(source.qty, parseInt(count, 10) || 0));
        if (n === 0) return prev;
        const sourceOpts = source.options || [];
        const hasOpt = sourceOpts.includes(optionId);
        const newOpts = hasOpt
          ? sourceOpts.filter((o) => o !== optionId)
          : [...sourceOpts, optionId].sort();
        const newSlot = {
          ...source,
          slotId: genSlotId(),
          qty: n,
          options: newOpts,
          cookState: 'pending',
          largeQty: 0,
        };
        // 새 슬롯에는 포션 상태 제거
        delete newSlot.cookStateNormal;
        delete newSlot.cookStateLarge;
        let nextCart = cart
          .map((i) => {
            if (i.slotId !== slotId) return i;
            const newQty = i.qty - n;
            const newLarge = Math.min(i.largeQty || 0, Math.max(0, newQty));
            return { ...i, qty: newQty, largeQty: newLarge };
          })
          .filter((i) => i.qty > 0);
        nextCart.push(newSlot);
        return {
          ...prev,
          [tableId]: { ...existing, cartItems: normalizeSlots(nextCart) },
        };
      });
    };

    const toggleItemOption = (tableId, slotId, optionId) => {
      setOrders((prev) => {
        const existing = prev[tableId];
        if (!existing) return prev;
        const cart =
          existing.cartItems ??
          (existing.items ? existing.items.map((i) => ({ ...i })) : []);
        const nextCart = cart.map((i) => {
          if (i.slotId !== slotId) return i;
          const opts = i.options || [];
          const nextOpts = opts.includes(optionId)
            ? opts.filter((o) => o !== optionId)
            : [...opts, optionId].sort();
          return { ...i, options: nextOpts };
        });
        return {
          ...prev,
          [tableId]: { ...existing, cartItems: normalizeSlots(nextCart) },
        };
      });
    };

    const setItemMemo = (tableId, slotId, memo) => {
      setOrders((prev) => {
        const existing = prev[tableId];
        if (!existing) return prev;
        const cart =
          existing.cartItems ??
          (existing.items ? existing.items.map((i) => ({ ...i })) : []);
        const safe = (memo || '').slice(0, 60);
        const nextCart = cart.map((i) => {
          if (i.slotId !== slotId) return i;
          return { ...i, memo: safe };
        });
        return {
          ...prev,
          [tableId]: { ...existing, cartItems: normalizeSlots(nextCart) },
        };
      });
    };

    const setItemLargeQty = (tableId, slotIdOrMenuId, largeQty) => {
      setOrders((prev) => {
        const existing = prev[tableId];
        if (!existing) return prev;
        const cart =
          existing.cartItems ??
          (existing.items ? existing.items.map((i) => ({ ...i })) : []);
        const nextCart = cart.map((i) => {
          if (i.slotId !== slotIdOrMenuId && i.id !== slotIdOrMenuId) return i;
          const n = Math.max(0, Math.min(i.qty, parseInt(largeQty, 10) || 0));
          return { ...i, largeQty: n };
        });
        return {
          ...prev,
          [tableId]: { ...existing, cartItems: normalizeSlots(nextCart) },
        };
      });
    };

    // 주문/변경 클릭시: cartItems → items 커밋. 최초 주문 시 confirmedItems 설정.
    // 기존 items의 cookState는 slotId가 일치할 때 보존 (주방 상태 안 깨짐).
    const confirmOrder = (tableId) => {
      addBreadcrumb('order.confirm', {
        tableId,
        cartCount: (orders[tableId]?.cartItems || []).length,
      });
      // 배달 테이블이면 주문 확정 즉시 주소를 todayDelivered 로 마크 (카운트는 안 늘림 — 실제 배달 완료 시점에 +1).
      // 사용자 UX: 같은 주소로 또 주문하지 않게 칩에서 회색으로 즉시 밀어냄.
      const ex0 = orders[tableId];
      if (ex0?.deliveryAddress) {
        const tbl = resolveTableForAlert(tableId);
        if (tbl?.type === 'delivery') {
          markAddressDeliveredToday(ex0.deliveryAddress);
        }
      }
      setOrders((prev) => {
        const existing = prev[tableId];
        if (!existing) return prev;
        const cart =
          existing.cartItems ??
          (existing.items ? existing.items.map((i) => ({ ...i })) : []);
        const merged = cart.map((c) => {
          const old = (existing.items || []).find(
            (i) => i.slotId === c.slotId
          );
          if (old) {
            const preserved = { ...c };
            if (old.cookState !== undefined) preserved.cookState = old.cookState;
            if (old.cookStateNormal !== undefined)
              preserved.cookStateNormal = old.cookStateNormal;
            if (old.cookStateLarge !== undefined)
              preserved.cookStateLarge = old.cookStateLarge;
            if (old.cooked !== undefined) preserved.cooked = old.cooked;
            return preserved;
          }
          return { ...c, cookState: c.cookState || 'pending' };
        });
        const isFirstConfirm = (existing.confirmedItems || []).length === 0;
        // cooked 상태 재계산 (cart 변경으로 status 되돌릴 필요 있음)
        const slotAllCooked = (i) => {
          const lq = i.largeQty || 0;
          const nq = i.qty - lq;
          const both = lq > 0 && nq > 0;
          if (both) {
            const n = i.cookStateNormal || i.cookState || 'pending';
            const l = i.cookStateLarge || i.cookState || 'pending';
            return n === 'cooked' && l === 'cooked';
          }
          return (i.cookState || 'pending') === 'cooked';
        };
        const allCooked =
          merged.length > 0 && merged.every(slotAllCooked);
        return {
          ...prev,
          [tableId]: {
            ...existing,
            items: merged,
            cartItems: merged.map((i) => ({ ...i })),
            confirmedItems: isFirstConfirm
              ? merged.map((i) => ({ ...i }))
              : existing.confirmedItems,
            status: allCooked ? 'ready' : 'preparing',
            // 새 항목이 추가되어 조리 미완이면 readyAt 리셋
            readyAt: allCooked ? existing.readyAt : null,
          },
        };
      });
    };

    const toggleOption = (tableId, optionId) => {
      setOrders((prev) => {
        const existing = prev[tableId];
        const current = existing?.options || [];
        const next = current.includes(optionId)
          ? current.filter((o) => o !== optionId)
          : [...current, optionId];
        if (!existing) {
          return {
            ...prev,
            [tableId]: {
              items: [],
              createdAt: Date.now(),
              status: 'preparing',
              paymentStatus: 'unpaid',
              options: next,
            },
          };
        }
        return {
          ...prev,
          [tableId]: { ...existing, options: next },
        };
      });
    };

    const markPaid = (tableId) => {
      addBreadcrumb('order.markPaid', { tableId });
      setOrders((prev) => {
        if (!prev[tableId]) return prev;
        return {
          ...prev,
          [tableId]: { ...prev[tableId], paymentStatus: 'paid' },
        };
      });
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
    // 실제 테이블로 이관. 대상 테이블에 이미 장바구니가 있으면 병합.
    const migratePendingCart = (toTableId) => {
      if (!toTableId || toTableId === PENDING_TABLE_ID) return;
      setOrders((prev) => {
        const pending = prev[PENDING_TABLE_ID];
        if (!pending || !(pending.cartItems || []).length) return prev;
        const existing = prev[toTableId];
        const destCart =
          existing?.cartItems ??
          (existing?.items ? existing.items.map((i) => ({ ...i })) : []);
        const mergedCart = normalizeSlots([
          ...destCart,
          ...pending.cartItems.map((i) => ({ ...i, slotId: genSlotId() })),
        ]);
        const { [PENDING_TABLE_ID]: _removed, ...rest } = prev;
        if (existing) {
          return {
            ...rest,
            [toTableId]: { ...existing, cartItems: mergedCart },
          };
        }
        return {
          ...rest,
          [toTableId]: {
            ...emptyOrder,
            cartItems: mergedCart,
            createdAt: Date.now(),
          },
        };
      });
    };

    // PENDING 장바구니 비우기 — 비우기 버튼 등에서 사용
    const clearPendingCart = () => {
      setOrders((prev) => {
        if (!prev[PENDING_TABLE_ID]) return prev;
        const { [PENDING_TABLE_ID]: _removed, ...rest } = prev;
        return rest;
      });
    };

    return {
      orders,
      splits,
      revenue,
      addressBook,
      bumpAddress,
      pinAddress,
      deleteAddress,
      setAutoRemember,
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

export function useOrders() {
  const ctx = useContext(OrderContext);
  if (!ctx) throw new Error('useOrders must be used within OrderProvider');
  return ctx;
}
