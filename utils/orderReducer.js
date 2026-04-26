// orders state 의 pure reducer.
// React 의존성 0 — 단위 테스트 가능 (`__tests__/orderReducer.test.js`).
// cross-domain 부수효과 (revenue, addressBook, splits, groups 갱신 / breadcrumb / sentry) 는
// 여기 담지 않고 wrapper 레벨에서 dispatch 전후로 처리.

import { genSlotId, normalizeSlots } from './orderHelpers';

// 주문 탭에서 테이블 선택 없이 먼저 담는 장바구니용 가상 tableId
export const PENDING_TABLE_ID = '__pending__';

export const emptyOrder = {
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
  deliveryAlerted10: false,
  deliveryAlerted5: false,
  readyAt: null,
};

// 슬롯 한 칸의 모든 포션이 cooked 인지 — cycleItemCookStatePortion / confirmOrder 공통 사용.
function slotIsAllCooked(i) {
  const lq = i.largeQty || 0;
  const nq = i.qty - lq;
  const both = lq > 0 && nq > 0;
  if (both) {
    const n = i.cookStateNormal || i.cookState || 'pending';
    const l = i.cookStateLarge || i.cookState || 'pending';
    return n === 'cooked' && l === 'cooked';
  }
  return (i.cookState || 'pending') === 'cooked';
}

// cookState 3단계 순환 — pending → cooking → cooked → pending
function nextCookState(cur) {
  return cur === 'pending'
    ? 'cooking'
    : cur === 'cooking'
    ? 'cooked'
    : 'pending';
}

function cartFromExisting(existing) {
  return (
    existing?.cartItems ??
    (existing?.items ? existing.items.map((i) => ({ ...i })) : [])
  );
}

export function orderReducer(state, action) {
  switch (action.type) {
    case 'orders/hydrate': {
      // payload 가 falsy 면 변화 없음 — useOrderPersistence 가드와 별개로 안전하게.
      return action.payload && typeof action.payload === 'object'
        ? action.payload
        : state;
    }

    // 마이그레이션 동안 setOrders((prev) => ...) 패턴을 그대로 dispatch 로 흘려보내기 위한 임시 어댑터.
    // 5단계에서 모든 호출처가 정식 action 으로 이전된 후 제거.
    case 'orders/setOrdersCompat': {
      const { updater } = action;
      return typeof updater === 'function' ? updater(state) : updater;
    }

    case 'orders/addItem': {
      const { tableId, menuItem, preferredSlotId } = action;
      if (!tableId) return state;
      const existing = state[tableId];
      const current = cartFromExisting(existing);
      // 옵션 없고 pending 인 동일 메뉴 슬롯이 있으면 거기에 누적
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
        ...state,
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
    }

    // cart 에서 1개 감산. items/confirmed 까지 모두 비면 호출자 (wrapper) 가
    // removeTable 까지 dispatch 하도록 분리. 여기서는 cart 만 손댐.
    case 'orders/removeItemFromCart': {
      const { tableId, slotIdOrMenuId } = action;
      const existing = state[tableId];
      if (!existing) return state;
      const cart = cartFromExisting(existing);
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
      return {
        ...state,
        [tableId]: { ...existing, cartItems: nextCart },
      };
    }

    case 'orders/removeTable': {
      const { tableId } = action;
      if (!(tableId in state)) return state;
      const { [tableId]: _, ...rest } = state;
      return rest;
    }

    case 'orders/markReady': {
      const { tableId } = action;
      if (!state[tableId]) return state;
      const nextItems = state[tableId].items.map((i) => {
        const { cookStateNormal, cookStateLarge, ...rest } = i;
        return { ...rest, cookState: 'cooked', cooked: true };
      });
      return {
        ...state,
        [tableId]: {
          ...state[tableId],
          status: 'ready',
          items: nextItems,
          confirmedItems: nextItems.map((i) => ({ ...i })),
          readyAt: Date.now(),
        },
      };
    }

    case 'orders/markPaid': {
      const { tableId } = action;
      if (!state[tableId]) return state;
      return {
        ...state,
        [tableId]: { ...state[tableId], paymentStatus: 'paid' },
      };
    }

    case 'orders/setDeliveryAddress': {
      const { tableId, safeAddress } = action;
      const existing = state[tableId];
      if (!existing) {
        return {
          ...state,
          [tableId]: {
            ...emptyOrder,
            createdAt: Date.now(),
            deliveryAddress: safeAddress,
          },
        };
      }
      return {
        ...state,
        [tableId]: { ...existing, deliveryAddress: safeAddress },
      };
    }

    case 'orders/setDeliveryTime': {
      const { tableId, safeTime } = action;
      const existing = state[tableId];
      if (!existing) {
        return {
          ...state,
          [tableId]: {
            ...emptyOrder,
            createdAt: Date.now(),
            deliveryTime: safeTime,
          },
        };
      }
      return {
        ...state,
        [tableId]: {
          ...existing,
          deliveryTime: safeTime,
          deliveryAlerted10: false,
          deliveryAlerted5: false,
        },
      };
    }

    case 'orders/setDeliveryTimeIsPM': {
      const { tableId, isPM } = action;
      const existing = state[tableId];
      if (!existing) {
        return {
          ...state,
          [tableId]: {
            ...emptyOrder,
            createdAt: Date.now(),
            deliveryTimeIsPM: !!isPM,
          },
        };
      }
      return {
        ...state,
        [tableId]: {
          ...existing,
          deliveryTimeIsPM: !!isPM,
          deliveryAlerted10: false,
          deliveryAlerted5: false,
        },
      };
    }

    // moveOrder 의 검증 (fromId 존재, toId 비어있음) 은 wrapper 가 처리하고
    // 여기 도달하면 무조건 이동.
    case 'orders/moveOrder': {
      const { fromId, toId } = action;
      if (!state[fromId]) return state;
      const next = { ...state };
      next[toId] = { ...state[fromId] };
      delete next[fromId];
      return next;
    }

    case 'orders/cycleItemCookState': {
      const { tableId, slotIdOrMenuId } = action;
      const existing = state[tableId];
      if (!existing) return state;
      const nextItems = existing.items.map((i) => {
        if (i.slotId !== slotIdOrMenuId && i.id !== slotIdOrMenuId) return i;
        const nextState = nextCookState(i.cookState || 'pending');
        return { ...i, cookState: nextState, cooked: nextState === 'cooked' };
      });
      const allCooked =
        nextItems.length > 0 &&
        nextItems.every((i) => (i.cookState || 'pending') === 'cooked');
      return {
        ...state,
        [tableId]: {
          ...existing,
          items: nextItems,
          status: allCooked ? 'ready' : 'preparing',
        },
      };
    }

    // 포션별 (보통/대) cookState 토글 — 슬롯 분리 없이 cookStateNormal/Large 필드 관리.
    // 두 포션 상태가 같아지면 cookState 로 통합하고 포션 필드 제거 (diff 스냅샷 안 깨짐).
    case 'orders/cycleItemCookStatePortion': {
      const { tableId, slotId, isLarge } = action;
      const existing = state[tableId];
      if (!existing) return state;
      const source = existing.items.find((i) => i.slotId === slotId);
      if (!source) return state;
      const lq = source.largeQty || 0;
      const nq = source.qty - lq;
      const hasBoth = lq > 0 && nq > 0;

      if (!hasBoth) {
        const nextState = nextCookState(source.cookState || 'pending');
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
          nextItems.every((i) => (i.cookState || 'pending') === 'cooked');
        return {
          ...state,
          [tableId]: {
            ...existing,
            items: nextItems,
            status: allCooked ? 'ready' : 'preparing',
          },
        };
      }

      const portionKey = isLarge ? 'cookStateLarge' : 'cookStateNormal';
      const otherKey = isLarge ? 'cookStateNormal' : 'cookStateLarge';
      const baseCookState = source.cookState || 'pending';
      const nextPortion = nextCookState(source[portionKey] || baseCookState);
      const otherPortion = source[otherKey] || baseCookState;

      const nextItems = existing.items.map((i) => {
        if (i.slotId !== slotId) return i;
        if (nextPortion === otherPortion) {
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
          cookState: baseCookState,
        };
      });

      const allCooked =
        nextItems.length > 0 && nextItems.every(slotIsAllCooked);
      return {
        ...state,
        [tableId]: {
          ...existing,
          items: nextItems,
          status: allCooked ? 'ready' : 'preparing',
        },
      };
    }

    case 'orders/incrementSlotQty': {
      const { tableId, slotId } = action;
      const existing = state[tableId];
      if (!existing) return state;
      const cart = cartFromExisting(existing);
      const nextCart = cart.map((i) =>
        i.slotId === slotId ? { ...i, qty: i.qty + 1 } : i
      );
      return {
        ...state,
        [tableId]: { ...existing, cartItems: nextCart },
      };
    }

    case 'orders/splitOffWithOptionToggle': {
      const { tableId, slotId, count, optionId } = action;
      const existing = state[tableId];
      if (!existing) return state;
      const cart = cartFromExisting(existing);
      const source = cart.find((i) => i.slotId === slotId);
      if (!source) return state;
      const n = Math.max(0, Math.min(source.qty, parseInt(count, 10) || 0));
      if (n === 0) return state;
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
        ...state,
        [tableId]: { ...existing, cartItems: normalizeSlots(nextCart) },
      };
    }

    case 'orders/toggleItemOption': {
      const { tableId, slotId, optionId } = action;
      const existing = state[tableId];
      if (!existing) return state;
      const cart = cartFromExisting(existing);
      const nextCart = cart.map((i) => {
        if (i.slotId !== slotId) return i;
        const opts = i.options || [];
        const nextOpts = opts.includes(optionId)
          ? opts.filter((o) => o !== optionId)
          : [...opts, optionId].sort();
        return { ...i, options: nextOpts };
      });
      return {
        ...state,
        [tableId]: { ...existing, cartItems: normalizeSlots(nextCart) },
      };
    }

    case 'orders/setItemMemo': {
      const { tableId, slotId, memo } = action;
      const existing = state[tableId];
      if (!existing) return state;
      const cart = cartFromExisting(existing);
      const safe = (memo || '').slice(0, 60);
      const nextCart = cart.map((i) =>
        i.slotId === slotId ? { ...i, memo: safe } : i
      );
      return {
        ...state,
        [tableId]: { ...existing, cartItems: normalizeSlots(nextCart) },
      };
    }

    case 'orders/setItemLargeQty': {
      const { tableId, slotIdOrMenuId, largeQty } = action;
      const existing = state[tableId];
      if (!existing) return state;
      const cart = cartFromExisting(existing);
      const nextCart = cart.map((i) => {
        if (i.slotId !== slotIdOrMenuId && i.id !== slotIdOrMenuId) return i;
        const n = Math.max(0, Math.min(i.qty, parseInt(largeQty, 10) || 0));
        return { ...i, largeQty: n };
      });
      return {
        ...state,
        [tableId]: { ...existing, cartItems: normalizeSlots(nextCart) },
      };
    }

    // cartItems → items 커밋. 최초 주문 시 confirmedItems 설정.
    // 기존 items 의 cookState 는 slotId 일치 시 보존 (주방 상태 안 깨짐).
    case 'orders/confirmOrder': {
      const { tableId } = action;
      const existing = state[tableId];
      if (!existing) return state;
      const cart = cartFromExisting(existing);
      const merged = cart.map((c) => {
        const old = (existing.items || []).find((i) => i.slotId === c.slotId);
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
      const allCooked = merged.length > 0 && merged.every(slotIsAllCooked);
      return {
        ...state,
        [tableId]: {
          ...existing,
          items: merged,
          cartItems: merged.map((i) => ({ ...i })),
          confirmedItems: isFirstConfirm
            ? merged.map((i) => ({ ...i }))
            : existing.confirmedItems,
          status: allCooked ? 'ready' : 'preparing',
          // 새 항목 추가로 조리 미완이면 readyAt 리셋
          readyAt: allCooked ? existing.readyAt : null,
        },
      };
    }

    case 'orders/toggleOption': {
      const { tableId, optionId } = action;
      const existing = state[tableId];
      const current = existing?.options || [];
      const next = current.includes(optionId)
        ? current.filter((o) => o !== optionId)
        : [...current, optionId];
      if (!existing) {
        return {
          ...state,
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
        ...state,
        [tableId]: { ...existing, options: next },
      };
    }

    case 'orders/migratePendingCart': {
      const { toTableId } = action;
      if (!toTableId || toTableId === PENDING_TABLE_ID) return state;
      const pending = state[PENDING_TABLE_ID];
      if (!pending || !(pending.cartItems || []).length) return state;
      const existing = state[toTableId];
      const destCart = cartFromExisting(existing);
      const mergedCart = normalizeSlots([
        ...destCart,
        ...pending.cartItems.map((i) => ({ ...i, slotId: genSlotId() })),
      ]);
      const { [PENDING_TABLE_ID]: _removed, ...rest } = state;
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
    }

    case 'orders/clearPendingCart': {
      if (!state[PENDING_TABLE_ID]) return state;
      const { [PENDING_TABLE_ID]: _removed, ...rest } = state;
      return rest;
    }

    // 배달 알림 발화 플래그 — useDeliveryAlerts 가 dispatch.
    case 'orders/markDeliveryAlerted': {
      const { tableId, flagKey } = action;
      if (!state[tableId] || state[tableId][flagKey]) return state;
      return {
        ...state,
        [tableId]: { ...state[tableId], [flagKey]: true },
      };
    }

    // 배달 자동 정리 — useAutoClearDelivery 가 toClear 계산 후 일괄 dispatch.
    case 'orders/autoClearDelivery': {
      const { tableIds } = action;
      if (!tableIds || tableIds.length === 0) return state;
      const next = { ...state };
      let changed = false;
      for (const tid of tableIds) {
        if (tid in next) {
          delete next[tid];
          changed = true;
        }
      }
      return changed ? next : state;
    }

    // 테이블 분할 — useSplits 가 dispatch. parent 가 있으면 #1 로 옮김.
    case 'orders/splitTable': {
      const { parentId } = action;
      if (!state[parentId]) return state;
      const next = { ...state };
      next[`${parentId}#1`] = state[parentId];
      delete next[parentId];
      return next;
    }

    // 분할 해제 — merged 가 있으면 parentId 로 복원, 없으면 둘 다 제거.
    case 'orders/unsplitTable': {
      const { parentId, merged } = action;
      const next = { ...state };
      delete next[`${parentId}#1`];
      delete next[`${parentId}#2`];
      if (merged) next[parentId] = merged;
      else delete next[parentId];
      return next;
    }

    // 단체 결성 — leader 에 멤버 주문 모두 병합. mergedLeader 는 wrapper 에서 미리 계산.
    case 'orders/createGroupMerge': {
      const { leaderId, memberIds, mergedLeader } = action;
      const next = { ...state };
      for (let i = 1; i < memberIds.length; i++) {
        delete next[memberIds[i]];
      }
      if (mergedLeader) next[leaderId] = mergedLeader;
      return next;
    }

    default:
      return state;
  }
}
