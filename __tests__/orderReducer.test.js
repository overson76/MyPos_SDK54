import {
  emptyOrder,
  orderReducer,
  PENDING_TABLE_ID,
} from '../utils/orderReducer';

const menu = {
  id: 'm1',
  name: '김치찌개',
  price: 8000,
  sizeGroup: 'soup',
  sizeUpcharge: 2000,
};

function makeOrder(overrides = {}) {
  return {
    ...emptyOrder,
    createdAt: 1000,
    ...overrides,
  };
}

describe('orderReducer · default / hydrate', () => {
  test('알 수 없는 action 은 state 동일 참조 반환', () => {
    const s = { t1: makeOrder() };
    expect(orderReducer(s, { type: 'unknown' })).toBe(s);
  });

  test('hydrate 가 payload 로 교체', () => {
    const s = {};
    const payload = { t1: makeOrder() };
    expect(orderReducer(s, { type: 'orders/hydrate', payload })).toBe(payload);
  });

  test('hydrate payload 가 falsy 면 변화 없음', () => {
    const s = { t1: makeOrder() };
    expect(orderReducer(s, { type: 'orders/hydrate', payload: null })).toBe(s);
    expect(orderReducer(s, { type: 'orders/hydrate' })).toBe(s);
  });

});

describe('orderReducer · addItem', () => {
  test('빈 테이블에 메뉴 추가하면 cart 에 1개', () => {
    const next = orderReducer({}, {
      type: 'orders/addItem',
      tableId: 't1',
      menuItem: menu,
    });
    expect(next.t1.cartItems).toHaveLength(1);
    expect(next.t1.cartItems[0]).toMatchObject({
      id: 'm1',
      name: '김치찌개',
      qty: 1,
      cookState: 'pending',
    });
  });

  test('동일 메뉴 추가시 같은 슬롯에 qty 누적', () => {
    let s = orderReducer({}, {
      type: 'orders/addItem',
      tableId: 't1',
      menuItem: menu,
    });
    s = orderReducer(s, {
      type: 'orders/addItem',
      tableId: 't1',
      menuItem: menu,
    });
    expect(s.t1.cartItems).toHaveLength(1);
    expect(s.t1.cartItems[0].qty).toBe(2);
  });

  test('tableId 없으면 변화 없음', () => {
    const s = {};
    expect(orderReducer(s, {
      type: 'orders/addItem',
      tableId: '',
      menuItem: menu,
    })).toBe(s);
  });

  test('이미 cooked 상태인 동일 메뉴는 누적 안 됨 — 새 슬롯 생성', () => {
    let s = orderReducer({}, {
      type: 'orders/addItem',
      tableId: 't1',
      menuItem: menu,
    });
    // 첫 슬롯을 cooked 로
    s.t1 = {
      ...s.t1,
      cartItems: [{ ...s.t1.cartItems[0], cookState: 'cooked' }],
    };
    s = orderReducer(s, {
      type: 'orders/addItem',
      tableId: 't1',
      menuItem: menu,
    });
    expect(s.t1.cartItems).toHaveLength(2);
  });

  test('1.0.35 — addItem 에 sourceTableId 명시 안 하면 tableId 와 동일하게 자동 박힘', () => {
    const next = orderReducer({}, {
      type: 'orders/addItem',
      tableId: 't1',
      menuItem: menu,
    });
    expect(next.t1.cartItems[0].sourceTableId).toBe('t1');
  });

  test('1.0.35 — sourceTableId 명시하면 그 값으로 박힘 (단체 결성 후 손님 테이블 추적)', () => {
    const next = orderReducer({}, {
      type: 'orders/addItem',
      tableId: 't1',
      menuItem: menu,
      sourceTableId: 't3',
    });
    expect(next.t1.cartItems[0].sourceTableId).toBe('t3');
  });

  test('1.0.35 — 같은 메뉴라도 sourceTableId 다르면 별도 슬롯', () => {
    let s = orderReducer({}, {
      type: 'orders/addItem',
      tableId: 't1',
      menuItem: menu,
      sourceTableId: 't1',
    });
    s = orderReducer(s, {
      type: 'orders/addItem',
      tableId: 't1',
      menuItem: menu,
      sourceTableId: 't2',
    });
    expect(s.t1.cartItems).toHaveLength(2);
  });

  test('1.0.35 — 같은 sourceTableId 면 누적', () => {
    let s = orderReducer({}, {
      type: 'orders/addItem',
      tableId: 't1',
      menuItem: menu,
      sourceTableId: 't2',
    });
    s = orderReducer(s, {
      type: 'orders/addItem',
      tableId: 't1',
      menuItem: menu,
      sourceTableId: 't2',
    });
    expect(s.t1.cartItems).toHaveLength(1);
    expect(s.t1.cartItems[0].qty).toBe(2);
  });
});

describe('orderReducer · removeItemFromCart / removeTable', () => {
  test('cart 의 슬롯 qty 1 감소', () => {
    let s = orderReducer({}, {
      type: 'orders/addItem',
      tableId: 't1',
      menuItem: menu,
    });
    s = orderReducer(s, {
      type: 'orders/addItem',
      tableId: 't1',
      menuItem: menu,
    });
    const slotId = s.t1.cartItems[0].slotId;
    s = orderReducer(s, {
      type: 'orders/removeItemFromCart',
      tableId: 't1',
      slotIdOrMenuId: slotId,
    });
    expect(s.t1.cartItems[0].qty).toBe(1);
  });

  test('qty 가 0 이 되면 슬롯 제거', () => {
    let s = orderReducer({}, {
      type: 'orders/addItem',
      tableId: 't1',
      menuItem: menu,
    });
    const slotId = s.t1.cartItems[0].slotId;
    s = orderReducer(s, {
      type: 'orders/removeItemFromCart',
      tableId: 't1',
      slotIdOrMenuId: slotId,
    });
    expect(s.t1.cartItems).toEqual([]);
  });

  test('removeTable 이 키 삭제', () => {
    const s = { t1: makeOrder(), t2: makeOrder() };
    const next = orderReducer(s, {
      type: 'orders/removeTable',
      tableId: 't1',
    });
    expect(next).toEqual({ t2: s.t2 });
  });

  test('없는 테이블 removeTable 은 변화 없음', () => {
    const s = { t1: makeOrder() };
    expect(orderReducer(s, {
      type: 'orders/removeTable',
      tableId: 'tX',
    })).toBe(s);
  });
});

describe('orderReducer · markReady / markPaid', () => {
  test('markReady 가 모든 items 를 cooked + status ready', () => {
    const s = {
      t1: makeOrder({
        items: [{ slotId: 's1', cookState: 'pending', qty: 1 }],
      }),
    };
    const next = orderReducer(s, { type: 'orders/markReady', tableId: 't1' });
    expect(next.t1.status).toBe('ready');
    expect(next.t1.items[0].cookState).toBe('cooked');
    expect(next.t1.items[0].cooked).toBe(true);
    expect(next.t1.readyAt).toBeGreaterThan(0);
    expect(next.t1.confirmedItems[0].cookState).toBe('cooked');
  });

  test('markPaid 가 paymentStatus 만 변경', () => {
    const s = { t1: makeOrder() };
    const next = orderReducer(s, { type: 'orders/markPaid', tableId: 't1' });
    expect(next.t1.paymentStatus).toBe('paid');
  });

  test('없는 테이블에 markReady/markPaid 는 noop', () => {
    const s = { t1: makeOrder() };
    expect(orderReducer(s, { type: 'orders/markReady', tableId: 'x' })).toBe(s);
    expect(orderReducer(s, { type: 'orders/markPaid', tableId: 'x' })).toBe(s);
  });
});

describe('orderReducer · undoMarkReady', () => {
  test('ready 인 테이블을 다시 preparing 으로 되돌리고 cookState 를 cooking 으로', () => {
    const s = {
      t1: makeOrder({
        status: 'ready',
        items: [{ slotId: 's1', cookState: 'cooked', cooked: true, qty: 1 }],
        readyAt: 5000,
      }),
    };
    const next = orderReducer(s, { type: 'orders/undoMarkReady', tableId: 't1' });
    expect(next.t1.status).toBe('preparing');
    expect(next.t1.items[0].cookState).toBe('cooking');
    expect(next.t1.items[0].cooked).toBe(false);
    expect(next.t1.readyAt).toBe(null);
  });

  test('없는 테이블에 undoMarkReady 는 noop', () => {
    const s = { t1: makeOrder({ status: 'ready' }) };
    expect(orderReducer(s, { type: 'orders/undoMarkReady', tableId: 'x' })).toBe(s);
  });

  test('cookStateNormal/Large 도 정리되어 cookState=cooking 으로 단일화', () => {
    const s = {
      t1: makeOrder({
        status: 'ready',
        items: [
          {
            slotId: 's1',
            qty: 2,
            largeQty: 1,
            cookState: 'cooked',
            cookStateNormal: 'cooked',
            cookStateLarge: 'cooked',
            cooked: true,
          },
        ],
        readyAt: 5000,
      }),
    };
    const next = orderReducer(s, { type: 'orders/undoMarkReady', tableId: 't1' });
    expect(next.t1.items[0].cookState).toBe('cooking');
    expect(next.t1.items[0].cookStateNormal).toBeUndefined();
    expect(next.t1.items[0].cookStateLarge).toBeUndefined();
  });
});

describe('orderReducer · restoreFromHistory', () => {
  const entry = {
    id: 't5-1700000000000',
    tableId: 't5',
    items: [
      { slotId: 'h1', id: 'm1', name: '김치찌개', price: 8000, qty: 2 },
    ],
    options: ['opt-x'],
    deliveryAddress: '서울시 강남구',
    deliveryTime: '오후 7시',
    paymentStatus: 'paid',
    paymentMethod: 'cash',
    total: 16000,
    clearedAt: 1700000000000,
  };

  test('비어있는 테이블에 history entry 의 items 로 복원', () => {
    const next = orderReducer({}, {
      type: 'orders/restoreFromHistory',
      tableId: 't5',
      entry,
    });
    expect(next.t5.items).toHaveLength(1);
    expect(next.t5.items[0].name).toBe('김치찌개');
    expect(next.t5.cartItems).toHaveLength(1);
    expect(next.t5.confirmedItems).toHaveLength(1);
    expect(next.t5.options).toEqual(['opt-x']);
    expect(next.t5.deliveryAddress).toBe('서울시 강남구');
    expect(next.t5.paymentStatus).toBe('unpaid');
    expect(next.t5.paymentMethod).toBe(null);
    expect(next.t5.status).toBe('preparing');
    expect(next.t5.readyAt).toBe(null);
  });

  test('이미 살아있는 테이블에는 복원 안 함 (덮어쓰기 방지)', () => {
    const s = { t5: makeOrder({ items: [{ slotId: 'live', qty: 1 }] }) };
    expect(orderReducer(s, {
      type: 'orders/restoreFromHistory',
      tableId: 't5',
      entry,
    })).toBe(s);
  });

  test('인자 누락 시 noop', () => {
    const s = {};
    expect(orderReducer(s, { type: 'orders/restoreFromHistory' })).toBe(s);
    expect(orderReducer(s, { type: 'orders/restoreFromHistory', tableId: 't1' })).toBe(s);
  });
});

describe('orderReducer · delivery setters', () => {
  test('setDeliveryAddress 가 빈 테이블에 emptyOrder 로 생성', () => {
    const next = orderReducer({}, {
      type: 'orders/setDeliveryAddress',
      tableId: 'd1',
      safeAddress: '서울시 강남구',
    });
    expect(next.d1.deliveryAddress).toBe('서울시 강남구');
    expect(next.d1.items).toEqual([]);
  });

  test('setDeliveryTime 이 알림 플래그 리셋', () => {
    const s = {
      d1: makeOrder({
        deliveryTime: '0420',
        deliveryAlerted10: true,
        deliveryAlerted5: true,
      }),
    };
    const next = orderReducer(s, {
      type: 'orders/setDeliveryTime',
      tableId: 'd1',
      safeTime: '0500',
    });
    expect(next.d1.deliveryTime).toBe('0500');
    expect(next.d1.deliveryAlerted10).toBe(false);
    expect(next.d1.deliveryAlerted5).toBe(false);
  });

  test('setDeliveryTimeIsPM 도 알림 플래그 리셋', () => {
    const s = {
      d1: makeOrder({
        deliveryTimeIsPM: true,
        deliveryAlerted10: true,
        deliveryAlerted5: true,
      }),
    };
    const next = orderReducer(s, {
      type: 'orders/setDeliveryTimeIsPM',
      tableId: 'd1',
      isPM: false,
    });
    expect(next.d1.deliveryTimeIsPM).toBe(false);
    expect(next.d1.deliveryAlerted10).toBe(false);
  });
});

describe('orderReducer · moveOrder', () => {
  test('fromId 의 주문이 toId 로 이동', () => {
    const src = makeOrder({ items: [{ slotId: 's1', qty: 1 }] });
    const next = orderReducer(
      { t1: src },
      { type: 'orders/moveOrder', fromId: 't1', toId: 't2' }
    );
    expect(next.t1).toBeUndefined();
    expect(next.t2.items).toEqual(src.items);
  });

  test('fromId 가 없으면 변화 없음', () => {
    const s = {};
    expect(orderReducer(s, {
      type: 'orders/moveOrder',
      fromId: 'x',
      toId: 'y',
    })).toBe(s);
  });
});

describe('orderReducer · compactSlots', () => {
  test('y2 가 비고 y3 차 있으면 y3 → y2', () => {
    const A = makeOrder({ items: [{ slotId: 's1', qty: 1 }] });
    const C = makeOrder({ items: [{ slotId: 's3', qty: 3 }] });
    const next = orderReducer(
      { y1: A, y3: C },
      { type: 'orders/compactSlots', prefix: 'y' }
    );
    expect(next.y1).toBe(A);
    expect(next.y2).toBe(C);
    expect(next.y3).toBeUndefined();
  });

  test('빈자리 없으면 동일 객체 반환', () => {
    const A = makeOrder({ items: [{ slotId: 's1', qty: 1 }] });
    const B = makeOrder({ items: [{ slotId: 's2', qty: 2 }] });
    const s = { y1: A, y2: B };
    expect(
      orderReducer(s, { type: 'orders/compactSlots', prefix: 'y' })
    ).toBe(s);
  });

  test('prefix 없으면 변화 없음', () => {
    const s = { y1: makeOrder({ items: [{ slotId: 's', qty: 1 }] }) };
    expect(orderReducer(s, { type: 'orders/compactSlots' })).toBe(s);
  });
});

describe('orderReducer · cycleItemCookState', () => {
  test('pending → cooking', () => {
    const s = {
      t1: makeOrder({
        items: [{ slotId: 's1', cookState: 'pending', qty: 1 }],
      }),
    };
    const next = orderReducer(s, {
      type: 'orders/cycleItemCookState',
      tableId: 't1',
      slotIdOrMenuId: 's1',
    });
    expect(next.t1.items[0].cookState).toBe('cooking');
    expect(next.t1.status).toBe('preparing');
  });

  test('cooked → pending → status preparing', () => {
    const s = {
      t1: makeOrder({
        items: [{ slotId: 's1', cookState: 'cooked', qty: 1 }],
        status: 'ready',
      }),
    };
    const next = orderReducer(s, {
      type: 'orders/cycleItemCookState',
      tableId: 't1',
      slotIdOrMenuId: 's1',
    });
    expect(next.t1.items[0].cookState).toBe('pending');
    expect(next.t1.status).toBe('preparing');
  });

  test('모든 슬롯 cooked → status ready', () => {
    const s = {
      t1: makeOrder({
        items: [
          { slotId: 's1', cookState: 'cooking', qty: 1 },
          { slotId: 's2', cookState: 'cooked', qty: 1 },
        ],
      }),
    };
    const next = orderReducer(s, {
      type: 'orders/cycleItemCookState',
      tableId: 't1',
      slotIdOrMenuId: 's1',
    });
    expect(next.t1.status).toBe('ready');
  });
});

describe('orderReducer · cycleItemCookStatePortion', () => {
  test('단일 포션이면 cookState 토글', () => {
    const s = {
      t1: makeOrder({
        items: [
          { slotId: 's1', qty: 2, largeQty: 0, cookState: 'pending' },
        ],
      }),
    };
    const next = orderReducer(s, {
      type: 'orders/cycleItemCookStatePortion',
      tableId: 't1',
      slotId: 's1',
      isLarge: false,
    });
    expect(next.t1.items[0].cookState).toBe('cooking');
  });

  test('두 포션 다 있으면 클릭한 포션만 토글', () => {
    const s = {
      t1: makeOrder({
        items: [
          { slotId: 's1', qty: 2, largeQty: 1, cookState: 'pending' },
        ],
      }),
    };
    const next = orderReducer(s, {
      type: 'orders/cycleItemCookStatePortion',
      tableId: 't1',
      slotId: 's1',
      isLarge: true,
    });
    expect(next.t1.items[0].cookStateLarge).toBe('cooking');
    expect(next.t1.items[0].cookStateNormal).toBe('pending');
  });

  test('두 포션 상태 같아지면 cookState 통합 + 포션 필드 제거', () => {
    const s = {
      t1: makeOrder({
        items: [
          {
            slotId: 's1',
            qty: 2,
            largeQty: 1,
            cookState: 'pending',
            cookStateNormal: 'cooking',
            cookStateLarge: 'pending',
          },
        ],
      }),
    };
    const next = orderReducer(s, {
      type: 'orders/cycleItemCookStatePortion',
      tableId: 't1',
      slotId: 's1',
      isLarge: true,
    });
    expect(next.t1.items[0].cookState).toBe('cooking');
    expect(next.t1.items[0].cookStateNormal).toBeUndefined();
    expect(next.t1.items[0].cookStateLarge).toBeUndefined();
  });
});

describe('orderReducer · cart 편집', () => {
  test('incrementSlotQty 가 cart 의 해당 슬롯 qty +1', () => {
    const s = {
      t1: makeOrder({
        cartItems: [{ slotId: 's1', qty: 1, options: [] }],
      }),
    };
    const next = orderReducer(s, {
      type: 'orders/incrementSlotQty',
      tableId: 't1',
      slotId: 's1',
    });
    expect(next.t1.cartItems[0].qty).toBe(2);
  });

  test('toggleItemOption 이 옵션 추가/제거', () => {
    const s = {
      t1: makeOrder({
        cartItems: [{ slotId: 's1', qty: 1, options: [] }],
      }),
    };
    let next = orderReducer(s, {
      type: 'orders/toggleItemOption',
      tableId: 't1',
      slotId: 's1',
      optionId: 'spicy',
    });
    expect(next.t1.cartItems[0].options).toEqual(['spicy']);
    next = orderReducer(next, {
      type: 'orders/toggleItemOption',
      tableId: 't1',
      slotId: 's1',
      optionId: 'spicy',
    });
    expect(next.t1.cartItems[0].options).toEqual([]);
  });

  test('setItemMemo 가 60자 슬라이스', () => {
    const s = {
      t1: makeOrder({
        cartItems: [{ slotId: 's1', qty: 1, options: [] }],
      }),
    };
    const longMemo = 'x'.repeat(100);
    const next = orderReducer(s, {
      type: 'orders/setItemMemo',
      tableId: 't1',
      slotId: 's1',
      memo: longMemo,
    });
    expect(next.t1.cartItems[0].memo).toHaveLength(60);
  });

  test('setItemLargeQty 가 qty 한도로 clamp', () => {
    const s = {
      t1: makeOrder({
        cartItems: [{ slotId: 's1', qty: 3, options: [], largeQty: 0 }],
      }),
    };
    const next = orderReducer(s, {
      type: 'orders/setItemLargeQty',
      tableId: 't1',
      slotIdOrMenuId: 's1',
      largeQty: '99',
    });
    expect(next.t1.cartItems[0].largeQty).toBe(3);
  });

  test('splitOffWithOptionToggle 가 N개 분리해서 옵션 토글된 새 슬롯 생성', () => {
    const s = {
      t1: makeOrder({
        cartItems: [
          { slotId: 's1', id: 'm1', qty: 3, options: [], largeQty: 0 },
        ],
      }),
    };
    const next = orderReducer(s, {
      type: 'orders/splitOffWithOptionToggle',
      tableId: 't1',
      slotId: 's1',
      count: 2,
      optionId: 'spicy',
    });
    expect(next.t1.cartItems).toHaveLength(2);
    const original = next.t1.cartItems.find((i) => i.slotId === 's1');
    const newSlot = next.t1.cartItems.find((i) => i.slotId !== 's1');
    expect(original.qty).toBe(1);
    expect(newSlot.qty).toBe(2);
    expect(newSlot.options).toEqual(['spicy']);
  });
});

describe('orderReducer · confirmOrder', () => {
  test('cart → items 커밋, 첫 확정시 confirmedItems 도 같이 설정', () => {
    const s = {
      t1: makeOrder({
        cartItems: [{ slotId: 's1', qty: 2, cookState: 'pending' }],
      }),
    };
    const next = orderReducer(s, {
      type: 'orders/confirmOrder',
      tableId: 't1',
    });
    expect(next.t1.items).toHaveLength(1);
    expect(next.t1.items[0].slotId).toBe('s1');
    expect(next.t1.confirmedItems).toHaveLength(1);
  });

  test('기존 items 의 cookState 보존 (slotId 일치시)', () => {
    const s = {
      t1: makeOrder({
        items: [{ slotId: 's1', qty: 1, cookState: 'cooked' }],
        cartItems: [{ slotId: 's1', qty: 2, cookState: 'pending' }],
        confirmedItems: [{ slotId: 's1', qty: 1, cookState: 'cooked' }],
      }),
    };
    const next = orderReducer(s, {
      type: 'orders/confirmOrder',
      tableId: 't1',
    });
    expect(next.t1.items[0].cookState).toBe('cooked');
    expect(next.t1.items[0].qty).toBe(2); // cart 의 qty 가 우선
  });

  test('첫 확정 후 추가 cart 변경시 confirmedItems 보존', () => {
    const s = {
      t1: makeOrder({
        items: [{ slotId: 's1', qty: 1, cookState: 'pending' }],
        cartItems: [
          { slotId: 's1', qty: 1, cookState: 'pending' },
          { slotId: 's2', qty: 1, cookState: 'pending' },
        ],
        confirmedItems: [{ slotId: 's1', qty: 1, cookState: 'pending' }],
      }),
    };
    const next = orderReducer(s, {
      type: 'orders/confirmOrder',
      tableId: 't1',
    });
    expect(next.t1.items).toHaveLength(2);
    expect(next.t1.confirmedItems).toHaveLength(1); // 보존
  });

  test('모든 슬롯 cooked 면 status ready, 아니면 readyAt 리셋', () => {
    const s = {
      t1: makeOrder({
        cartItems: [{ slotId: 's1', qty: 1, cookState: 'pending' }],
        readyAt: 12345,
      }),
    };
    const next = orderReducer(s, {
      type: 'orders/confirmOrder',
      tableId: 't1',
    });
    expect(next.t1.status).toBe('preparing');
    expect(next.t1.readyAt).toBeNull();
  });

  // 2026-05-21 회귀 방지 — 사장님 신고 "입력중 ↔ 주문상태 무한 토글" 의 근본 원인.
  // 확정 후 cartItems 는 *반드시* 빈 배열이어야 OrderScreen 의 cart 가 비어 보이고,
  // 사장님이 슬롯 재진입했을 때 옛 메뉴 다시 안 보임.
  test('확정 후 cartItems 가 빈 배열로 초기화되어야 한다', () => {
    const s = {
      t1: makeOrder({
        cartItems: [
          { slotId: 's1', qty: 2, cookState: 'pending' },
          { slotId: 's2', qty: 1, cookState: 'pending' },
        ],
      }),
    };
    const next = orderReducer(s, {
      type: 'orders/confirmOrder',
      tableId: 't1',
    });
    expect(next.t1.items).toHaveLength(2); // 주방으로 커밋
    expect(next.t1.cartItems).toEqual([]); // 장바구니는 비어야 한다
  });

  test('재확정시에도 cartItems 는 비어야 한다 (변경 누름 흐름)', () => {
    const s = {
      t1: makeOrder({
        items: [{ slotId: 's1', qty: 1, cookState: 'cooked' }],
        cartItems: [
          { slotId: 's1', qty: 1, cookState: 'cooked' },
          { slotId: 's2', qty: 1, cookState: 'pending' }, // 사장님이 추가한 메뉴
        ],
        confirmedItems: [{ slotId: 's1', qty: 1, cookState: 'cooked' }],
      }),
    };
    const next = orderReducer(s, {
      type: 'orders/confirmOrder',
      tableId: 't1',
    });
    expect(next.t1.items).toHaveLength(2);
    expect(next.t1.cartItems).toEqual([]); // 추가 변경 후에도 cart 정리
  });

  // 1.0.52 안전 가드 — cart=[] (사용자가 한 개도 안 담음) & items 있으면 confirm 무시.
  // 가드 없으면 cartFromExisting fallback 이 items 카피로 잡아 머지가 일어나지만,
  // "비어있는 cart 로 confirm" 자체가 의도된 흐름이 아니므로 state 보존이 더 안전.
  // (사장님 보고: "주문 후 변경 시 기존 주문내역 다 지워짐" — 자동확정/외부 호출 우회 차단)
  test('cart=[] & items 있으면 state 보존, items 손대지 않음', () => {
    const s = {
      t1: makeOrder({
        items: [{ slotId: 's1', qty: 1, cookState: 'pending' }],
        cartItems: [],
        confirmedItems: [{ slotId: 's1', qty: 1, cookState: 'pending' }],
      }),
    };
    const next = orderReducer(s, {
      type: 'orders/confirmOrder',
      tableId: 't1',
    });
    // items 보존 (의도치 않은 삭제 차단)
    expect(next.t1.items).toHaveLength(1);
    expect(next.t1.items[0].slotId).toBe('s1');
    // cartItems 는 그대로 빈 배열 (변경 없음)
    expect(next.t1.cartItems).toEqual([]);
  });
});

describe('orderReducer · cartFromExisting fallback (1.0.52)', () => {
  // cart 가 빈 배열이어도 items 카피로 fallback → 새 메뉴 추가 시 기존 items 위에 추가.
  // 사장님 시나리오: confirm 후 cartItems=[] 인 상태에서 OrderScreen 재진입 → 새 메뉴 클릭.
  test('cart=[] 상태에서 addItem 하면 items 카피 + 새 슬롯이 cart 가 됨', () => {
    const s = {
      t1: makeOrder({
        items: [{ slotId: 's1', id: 'm0', qty: 1, cookState: 'pending' }],
        cartItems: [],
        confirmedItems: [{ slotId: 's1', id: 'm0', qty: 1, cookState: 'pending' }],
      }),
    };
    const next = orderReducer(s, {
      type: 'orders/addItem',
      tableId: 't1',
      menuItem: menu,
    });
    // cart 에 기존 s1 보존 + 새 메뉴(m1) 슬롯 = 총 2
    expect(next.t1.cartItems.length).toBe(2);
    const hasS1 = next.t1.cartItems.some((i) => i.slotId === 's1');
    const hasNewMenu = next.t1.cartItems.some((i) => i.id === 'm1');
    expect(hasS1).toBe(true);
    expect(hasNewMenu).toBe(true);
  });
});

// 2026-05-21 회귀 방지 — 사장님 룰 "배달은 조리완료와 동시에 자동 배달회수 등록".
// cycleItemCookStatePortion 이 모든 슬롯 cooked 시 readyAt 도 같이 set 해야 함.
// 옛 코드는 status='ready' 만 set 하고 readyAt null → getReadyDeliveries 가 skip
// → 회수 목록 텅 비는 버그.
describe('orderReducer · cycleItemCookStatePortion + readyAt 자동 set', () => {
  test('마지막 슬롯이 cooked 되면 readyAt 자동 set + status ready', () => {
    const s = {
      d1: makeOrder({
        items: [
          { slotId: 's1', qty: 1, cookState: 'cooked' },
          { slotId: 's2', qty: 1, cookState: 'cooking' },
        ],
      }),
    };
    // s2 를 cooking → cooked 로 순환
    let next = orderReducer(s, {
      type: 'orders/cycleItemCookStatePortion',
      tableId: 'd1',
      slotId: 's2',
      isLarge: false,
    });
    // 첫 cycle 은 cooking → cooked 가 아닐 수 있음. nextCookState 확인을 위해 한 번 더
    while (next.d1.items.find((i) => i.slotId === 's2').cookState !== 'cooked') {
      next = orderReducer(next, {
        type: 'orders/cycleItemCookStatePortion',
        tableId: 'd1',
        slotId: 's2',
        isLarge: false,
      });
    }
    expect(next.d1.status).toBe('ready');
    expect(typeof next.d1.readyAt).toBe('number');
    expect(next.d1.readyAt).toBeGreaterThan(0);
  });

  test('일부만 cooked 면 readyAt null 유지', () => {
    const s = {
      d1: makeOrder({
        items: [
          { slotId: 's1', qty: 1, cookState: 'pending' },
          { slotId: 's2', qty: 1, cookState: 'pending' },
        ],
      }),
    };
    const next = orderReducer(s, {
      type: 'orders/cycleItemCookStatePortion',
      tableId: 'd1',
      slotId: 's1',
      isLarge: false,
    });
    expect(next.d1.status).toBe('preparing');
    expect(next.d1.readyAt).toBeNull();
  });

  test('이미 ready 상태에서 다른 슬롯도 cooked 토글되어도 readyAt 보존 (덮어쓰기 안 함)', () => {
    const fixedReadyAt = 999;
    const s = {
      d1: makeOrder({
        items: [
          { slotId: 's1', qty: 1, cookState: 'cooked' },
          { slotId: 's2', qty: 1, cookState: 'cooked' },
        ],
        readyAt: fixedReadyAt,
        status: 'ready',
      }),
    };
    // 이미 cooked 인 s1 을 또 토글 → cycle 한 바퀴
    let next = orderReducer(s, {
      type: 'orders/cycleItemCookStatePortion',
      tableId: 'd1',
      slotId: 's1',
      isLarge: false,
    });
    // 만약 모든 슬롯 여전히 cooked 라면 readyAt 보존
    const allStillCooked = next.d1.items.every(
      (i) => (i.cookState || 'pending') === 'cooked'
    );
    if (allStillCooked) {
      expect(next.d1.readyAt).toBe(fixedReadyAt);
    }
  });
});

describe('orderReducer · toggleOption (테이블 옵션)', () => {
  test('빈 테이블에 옵션 추가하면 새 주문 생성', () => {
    const next = orderReducer({}, {
      type: 'orders/toggleOption',
      tableId: 't1',
      optionId: 'service',
    });
    expect(next.t1.options).toEqual(['service']);
  });

  test('이미 있는 옵션 다시 토글하면 제거', () => {
    const s = { t1: makeOrder({ options: ['service'] }) };
    const next = orderReducer(s, {
      type: 'orders/toggleOption',
      tableId: 't1',
      optionId: 'service',
    });
    expect(next.t1.options).toEqual([]);
  });
});

describe('orderReducer · pending cart 이관', () => {
  test('migratePendingCart 가 PENDING 의 cart 를 toTable 에 합침', () => {
    const s = {
      [PENDING_TABLE_ID]: makeOrder({
        cartItems: [{ slotId: 'p1', id: 'm1', qty: 1, options: [] }],
      }),
    };
    const next = orderReducer(s, {
      type: 'orders/migratePendingCart',
      toTableId: 't1',
    });
    expect(next[PENDING_TABLE_ID]).toBeUndefined();
    expect(next.t1.cartItems).toHaveLength(1);
  });

  test('1.0.35 — migratePendingCart 시 sourceTableId 가 PENDING 이면 toTable 로 치환', () => {
    const s = {
      [PENDING_TABLE_ID]: makeOrder({
        cartItems: [
          {
            slotId: 'p1',
            id: 'm1',
            qty: 1,
            options: [],
            sourceTableId: PENDING_TABLE_ID,
          },
        ],
      }),
    };
    const next = orderReducer(s, {
      type: 'orders/migratePendingCart',
      toTableId: 't1',
    });
    expect(next.t1.cartItems[0].sourceTableId).toBe('t1');
  });

  test('1.0.35 — migratePendingCart 시 sourceTableId 가 없으면 toTable 로 채움', () => {
    const s = {
      [PENDING_TABLE_ID]: makeOrder({
        cartItems: [{ slotId: 'p1', id: 'm1', qty: 1, options: [] }],
      }),
    };
    const next = orderReducer(s, {
      type: 'orders/migratePendingCart',
      toTableId: 't1',
    });
    expect(next.t1.cartItems[0].sourceTableId).toBe('t1');
  });

  test('clearPendingCart 가 PENDING 키 제거', () => {
    const s = { [PENDING_TABLE_ID]: makeOrder() };
    const next = orderReducer(s, { type: 'orders/clearPendingCart' });
    expect(next[PENDING_TABLE_ID]).toBeUndefined();
  });
});

describe('orderReducer · 배달 알림 / 자동 정리', () => {
  test('markDeliveryAlerted 가 플래그 set', () => {
    const s = { d1: makeOrder() };
    const next = orderReducer(s, {
      type: 'orders/markDeliveryAlerted',
      tableId: 'd1',
      flagKey: 'deliveryAlerted5',
    });
    expect(next.d1.deliveryAlerted5).toBe(true);
  });

  test('markDeliveryAlerted 가 이미 set 이면 noop', () => {
    const s = { d1: makeOrder({ deliveryAlerted5: true }) };
    expect(orderReducer(s, {
      type: 'orders/markDeliveryAlerted',
      tableId: 'd1',
      flagKey: 'deliveryAlerted5',
    })).toBe(s);
  });

  test('autoClearDelivery 가 다중 tableId 일괄 제거', () => {
    const s = {
      d1: makeOrder(),
      d2: makeOrder(),
      h1: makeOrder(),
    };
    const next = orderReducer(s, {
      type: 'orders/autoClearDelivery',
      tableIds: ['d1', 'd2'],
    });
    expect(next.d1).toBeUndefined();
    expect(next.d2).toBeUndefined();
    expect(next.h1).toBe(s.h1);
  });

  test('autoClearDelivery 가 빈 배열이면 noop', () => {
    const s = { d1: makeOrder() };
    expect(orderReducer(s, {
      type: 'orders/autoClearDelivery',
      tableIds: [],
    })).toBe(s);
  });
});

describe('orderReducer · split / unsplit / createGroupMerge', () => {
  test('splitTable 이 parent → parent#1 로 옮김', () => {
    const s = { t1: makeOrder({ items: [{ slotId: 's1', qty: 1 }] }) };
    const next = orderReducer(s, {
      type: 'orders/splitTable',
      parentId: 't1',
    });
    expect(next.t1).toBeUndefined();
    expect(next['t1#1']).toBeDefined();
  });

  test('unsplitTable 이 #1/#2 제거 후 merged 를 parent 에', () => {
    const s = {
      't1#1': makeOrder({ items: [{ slotId: 's1', qty: 1 }] }),
      't1#2': makeOrder(),
    };
    const merged = makeOrder({ items: [{ slotId: 's1', qty: 1 }] });
    const next = orderReducer(s, {
      type: 'orders/unsplitTable',
      parentId: 't1',
      merged,
    });
    expect(next['t1#1']).toBeUndefined();
    expect(next['t1#2']).toBeUndefined();
    expect(next.t1).toBe(merged);
  });

  test('unsplitTable 이 merged 없으면 parent 도 안 만듦', () => {
    const s = { 't1#1': makeOrder(), 't1#2': makeOrder() };
    const next = orderReducer(s, {
      type: 'orders/unsplitTable',
      parentId: 't1',
      merged: null,
    });
    expect(next.t1).toBeUndefined();
  });

  test('createGroupMerge 가 비-리더 멤버 제거 + leader 에 mergedLeader', () => {
    const s = { t1: makeOrder(), t2: makeOrder(), t3: makeOrder() };
    const mergedLeader = makeOrder({
      items: [{ slotId: 's1', qty: 1 }],
    });
    const next = orderReducer(s, {
      type: 'orders/createGroupMerge',
      leaderId: 't1',
      memberIds: ['t1', 't2', 't3'],
      mergedLeader,
    });
    expect(next.t1).toBe(mergedLeader);
    expect(next.t2).toBeUndefined();
    expect(next.t3).toBeUndefined();
  });
});

describe('orderReducer · clearTableBySource (1.0.37 분리 결제)', () => {
  test('해당 sourceTable 의 슬롯만 제거, 다른 손님 슬롯은 보존', () => {
    const s = {
      t1: makeOrder({
        items: [
          { slotId: 'a1', qty: 1, sourceTableId: 't1' },
          { slotId: 'a2', qty: 2, sourceTableId: 't2' },
        ],
        cartItems: [
          { slotId: 'a1', qty: 1, sourceTableId: 't1' },
          { slotId: 'a2', qty: 2, sourceTableId: 't2' },
        ],
        confirmedItems: [],
      }),
    };
    const next = orderReducer(s, {
      type: 'orders/clearTableBySource',
      tableId: 't1',
      sourceTableId: 't1',
    });
    expect(next.t1).toBeDefined();
    expect(next.t1.items).toHaveLength(1);
    expect(next.t1.items[0].sourceTableId).toBe('t2');
    expect(next.t1.cartItems).toHaveLength(1);
  });

  test('모든 슬롯 비면 테이블 자체 제거', () => {
    const s = {
      t1: makeOrder({
        items: [{ slotId: 'a1', qty: 1, sourceTableId: 't1' }],
        cartItems: [{ slotId: 'a1', qty: 1, sourceTableId: 't1' }],
        confirmedItems: [{ slotId: 'a1', qty: 1, sourceTableId: 't1' }],
      }),
    };
    const next = orderReducer(s, {
      type: 'orders/clearTableBySource',
      tableId: 't1',
      sourceTableId: 't1',
    });
    expect(next.t1).toBeUndefined();
  });

  test('없는 테이블이면 noop', () => {
    const s = { t2: makeOrder() };
    expect(
      orderReducer(s, {
        type: 'orders/clearTableBySource',
        tableId: 't1',
        sourceTableId: 't1',
      })
    ).toBe(s);
  });

  test('sourceTableId 없는 옛 슬롯은 tableId fallback', () => {
    const s = {
      t1: makeOrder({
        items: [
          { slotId: 'a1', qty: 1 }, // sourceTableId 없음 → t1 fallback
          { slotId: 'a2', qty: 2, sourceTableId: 't2' },
        ],
      }),
    };
    const next = orderReducer(s, {
      type: 'orders/clearTableBySource',
      tableId: 't1',
      sourceTableId: 't1',
    });
    // a1 (fallback=t1) 만 제거됨
    expect(next.t1.items).toHaveLength(1);
    expect(next.t1.items[0].slotId).toBe('a2');
  });
});

// 2026-05-23 회귀 방지 — 사장님 신고 "주문 후 카트 비어 보임 + - 키 0까지 누르면 1로 남음"
// 의 근본 원인: OrderScreen 의 옛 cart 표시 fallback (cartItems=[]일 때 items 로 대체).
// 처방은 OrderScreen 의 useEffect 가 hydrateCartFromItems 1회 호출 — reducer 측 가드.
describe('orderReducer · hydrateCartFromItems (재진입 시 카트 동기화)', () => {
  test('cartItems=[] && items 있으면 items 카피로 cartItems 채움', () => {
    const s = {
      t1: makeOrder({
        items: [
          { slotId: 's1', id: 'm1', name: '김치찌개', qty: 2, cookState: 'pending' },
          { slotId: 's2', id: 'm2', name: '비빔밥', qty: 1, cookState: 'cooked' },
        ],
        cartItems: [],
      }),
    };
    const next = orderReducer(s, {
      type: 'orders/hydrateCartFromItems',
      tableId: 't1',
    });
    expect(next.t1.cartItems).toHaveLength(2);
    expect(next.t1.cartItems[0].slotId).toBe('s1');
    expect(next.t1.cartItems[0].qty).toBe(2);
    // 카피여야 함 (참조 공유 X) — 사장님이 cart 수정해도 items 안 바뀌게
    expect(next.t1.cartItems[0]).not.toBe(s.t1.items[0]);
    // items 는 그대로
    expect(next.t1.items).toBe(s.t1.items);
  });

  test('cartItems 가 이미 채워져 있으면 변화 없음 (사장님이 - 로 비운 직후 자동 복원 차단)', () => {
    const s = {
      t1: makeOrder({
        items: [{ slotId: 's1', qty: 2 }],
        cartItems: [{ slotId: 's1', qty: 1 }],
      }),
    };
    const next = orderReducer(s, {
      type: 'orders/hydrateCartFromItems',
      tableId: 't1',
    });
    expect(next).toBe(s);
  });

  test('items 비어있으면 변화 없음 (hydrate 할 source 없음)', () => {
    const s = {
      t1: makeOrder({ items: [], cartItems: [] }),
    };
    const next = orderReducer(s, {
      type: 'orders/hydrateCartFromItems',
      tableId: 't1',
    });
    expect(next).toBe(s);
  });

  test('존재하지 않는 tableId 면 변화 없음', () => {
    const s = { t1: makeOrder({ items: [{ slotId: 's1', qty: 1 }] }) };
    const next = orderReducer(s, {
      type: 'orders/hydrateCartFromItems',
      tableId: 't999',
    });
    expect(next).toBe(s);
  });

  test('사장님 시나리오: 진입 hydrate → - 키 2회 → cart 비고 items 그대로', () => {
    // 1) 진입 시점 — items=[X qty=2], cartItems=[]
    let s = {
      t1: makeOrder({
        items: [{ slotId: 's1', id: 'm1', qty: 2, cookState: 'pending' }],
        cartItems: [],
      }),
    };
    // 2) effect hydrate 호출
    s = orderReducer(s, {
      type: 'orders/hydrateCartFromItems',
      tableId: 't1',
    });
    expect(s.t1.cartItems).toEqual([
      expect.objectContaining({ slotId: 's1', qty: 2 }),
    ]);
    // 3) - 1번 → qty 1
    s = orderReducer(s, {
      type: 'orders/removeItemFromCart',
      tableId: 't1',
      slotIdOrMenuId: 's1',
    });
    expect(s.t1.cartItems).toEqual([
      expect.objectContaining({ slotId: 's1', qty: 1 }),
    ]);
    // 4) - 2번 → cart 슬롯 제거 (qty 0 → filter)
    s = orderReducer(s, {
      type: 'orders/removeItemFromCart',
      tableId: 't1',
      slotIdOrMenuId: 's1',
    });
    expect(s.t1.cartItems).toEqual([]);
    // 5) items 는 그대로 — 사장님이 "변경" 안 누르면 확정분 보존
    expect(s.t1.items).toHaveLength(1);
    expect(s.t1.items[0].qty).toBe(2);
  });
});

describe('orderReducer · splitOffWithOptionToggle (대/보통 portion)', () => {
  // 팥죽 대1 + 보통1 (qty 2, largeQty 1)
  const baseState = () => ({
    t1: {
      items: [],
      cartItems: [
        {
          slotId: 's1',
          id: 'patjuk',
          name: '팥죽',
          qty: 2,
          largeQty: 1,
          options: [],
          price: 11000,
          sizeUpcharge: 2000,
        },
      ],
      confirmedItems: [],
    },
  });

  // 2026-06-04 사장님 신고: "팥죽 대에 면적게 선택하면 보통에 박힌다".
  test('대 portion 에 옵션 분리 → 대1(옵션) + 보통1 (버그 처방)', () => {
    const next = orderReducer(baseState(), {
      type: 'orders/splitOffWithOptionToggle',
      tableId: 't1',
      slotId: 's1',
      count: 1,
      optionId: 'opt_myeon',
      isLarge: true,
    });
    const cart = next.t1.cartItems;
    const withOpt = cart.find((i) => (i.options || []).includes('opt_myeon'));
    const without = cart.find((i) => !(i.options || []).includes('opt_myeon'));
    expect(withOpt).toBeTruthy();
    expect(withOpt.largeQty).toBe(1); // 대에 옵션이 붙어야!
    expect(withOpt.qty).toBe(1);
    expect(without.largeQty).toBe(0); // 보통 잔여
    expect(without.qty).toBe(1);
  });

  test('보통 portion 에 옵션 분리 → 보통1(옵션) + 대1 유지', () => {
    const next = orderReducer(baseState(), {
      type: 'orders/splitOffWithOptionToggle',
      tableId: 't1',
      slotId: 's1',
      count: 1,
      optionId: 'opt_myeon',
      isLarge: false,
    });
    const cart = next.t1.cartItems;
    const withOpt = cart.find((i) => (i.options || []).includes('opt_myeon'));
    const without = cart.find((i) => !(i.options || []).includes('opt_myeon'));
    expect(withOpt.largeQty).toBe(0); // 보통에 옵션
    expect(without.largeQty).toBe(1); // 대 잔여
  });

  test('isLarge 인데 count 가 large 수량 초과 → large 한도로 clamp', () => {
    // 대 1개뿐인데 2개 분리 시도 → n = min(largeQty 1, 2) = 1
    const next = orderReducer(baseState(), {
      type: 'orders/splitOffWithOptionToggle',
      tableId: 't1',
      slotId: 's1',
      count: 2,
      optionId: 'opt_myeon',
      isLarge: true,
    });
    const cart = next.t1.cartItems;
    const withOpt = cart.find((i) => (i.options || []).includes('opt_myeon'));
    expect(withOpt.qty).toBe(1);
    expect(withOpt.largeQty).toBe(1);
  });
});

describe('orderReducer · setReservationInfo (예약 빠른 등록)', () => {
  test('빈 슬롯에 인원+시간 → 메뉴 없이 새 예약 order 생성', () => {
    const next = orderReducer(
      {},
      {
        type: 'orders/setReservationInfo',
        tableId: 'y1',
        partySize: 4,
        safeTime: '700',
        isPM: true,
      }
    );
    expect(next.y1).toBeTruthy();
    expect(next.y1.partySize).toBe(4);
    expect(next.y1.deliveryTime).toBe('700');
    expect(next.y1.deliveryTimeIsPM).toBe(true);
    expect(next.y1.items).toEqual([]);
    expect(next.y1.confirmedItems).toEqual([]);
    expect(typeof next.y1.createdAt).toBe('number');
  });

  test('시간만 변경 — 인원은 기존값 유지', () => {
    const s = {
      y1: makeOrder({ partySize: 2, deliveryTime: '600', deliveryTimeIsPM: false }),
    };
    const next = orderReducer(s, {
      type: 'orders/setReservationInfo',
      tableId: 'y1',
      partySize: undefined,
      safeTime: '730',
      isPM: true,
    });
    expect(next.y1.partySize).toBe(2);
    expect(next.y1.deliveryTime).toBe('730');
    expect(next.y1.deliveryTimeIsPM).toBe(true);
  });

  test('safeTime null 이면 기존 시간 유지 (인원만 갱신)', () => {
    const s = {
      y1: makeOrder({ partySize: 0, deliveryTime: '500', deliveryTimeIsPM: true }),
    };
    const next = orderReducer(s, {
      type: 'orders/setReservationInfo',
      tableId: 'y1',
      partySize: 5,
      safeTime: null,
      isPM: undefined,
    });
    expect(next.y1.partySize).toBe(5);
    expect(next.y1.deliveryTime).toBe('500');
    expect(next.y1.deliveryTimeIsPM).toBe(true);
  });

  test('기존 메뉴 있는 예약에 정보 추가 — 메뉴 보존', () => {
    const s = {
      y1: makeOrder({
        confirmedItems: [{ id: 'm1', qty: 1 }],
        items: [{ id: 'm1', qty: 1 }],
      }),
    };
    const next = orderReducer(s, {
      type: 'orders/setReservationInfo',
      tableId: 'y1',
      partySize: 3,
      safeTime: '800',
      isPM: true,
    });
    expect(next.y1.partySize).toBe(3);
    expect(next.y1.confirmedItems).toHaveLength(1);
  });

  test('tableId 없으면 state 동일 참조', () => {
    const s = { y1: makeOrder() };
    expect(orderReducer(s, { type: 'orders/setReservationInfo' })).toBe(s);
  });
});

describe('orderReducer · startCookingAll (주방 "조리중" 일괄 버튼)', () => {
  const cookItems = () => [
    { id: 'm1', qty: 2, largeQty: 0, cookState: 'pending' },
    { id: 'm2', qty: 1, largeQty: 0, cookState: 'cooked' },
    { id: 'm3', qty: 1, largeQty: 0 }, // cookState 없음 = pending 취급
  ];

  test('on=true: pending → cooking, cooked 는 유지', () => {
    const s = { t1: makeOrder({ items: cookItems() }) };
    const next = orderReducer(s, {
      type: 'orders/startCookingAll',
      tableId: 't1',
      on: true,
    });
    const [a, b, c] = next.t1.items;
    expect(a.cookState).toBe('cooking');
    expect(b.cookState).toBe('cooked'); // 완료 표시 보존
    expect(c.cookState).toBe('cooking');
  });

  test('on=false: cooking → pending 으로 해제, cooked 유지', () => {
    const s = {
      t1: makeOrder({
        items: [
          { id: 'm1', qty: 1, largeQty: 0, cookState: 'cooking' },
          { id: 'm2', qty: 1, largeQty: 0, cookState: 'cooked' },
        ],
      }),
    };
    const next = orderReducer(s, {
      type: 'orders/startCookingAll',
      tableId: 't1',
      on: false,
    });
    expect(next.t1.items[0].cookState).toBe('pending');
    expect(next.t1.items[1].cookState).toBe('cooked');
  });

  test('대/보통 분리 슬롯은 cookStateNormal/Large 각각 적용', () => {
    const s = {
      t1: makeOrder({
        items: [
          {
            id: 'm1',
            qty: 3,
            largeQty: 1, // 대1 + 보통2 = 포션 분리
            cookStateNormal: 'pending',
            cookStateLarge: 'cooked',
          },
        ],
      }),
    };
    const next = orderReducer(s, {
      type: 'orders/startCookingAll',
      tableId: 't1',
      on: true,
    });
    expect(next.t1.items[0].cookStateNormal).toBe('cooking');
    expect(next.t1.items[0].cookStateLarge).toBe('cooked'); // 완료 포션 보존
  });

  test('status / readyAt 은 건드리지 않음', () => {
    const s = {
      t1: makeOrder({
        items: [{ id: 'm1', qty: 1, largeQty: 0, cookState: 'pending' }],
        status: 'preparing',
        readyAt: null,
      }),
    };
    const next = orderReducer(s, {
      type: 'orders/startCookingAll',
      tableId: 't1',
      on: true,
    });
    expect(next.t1.status).toBe('preparing');
    expect(next.t1.readyAt).toBe(null);
  });

  test('items 없는 테이블 / 없는 테이블은 state 동일 참조', () => {
    const empty = { t1: makeOrder({ items: [] }) };
    expect(
      orderReducer(empty, { type: 'orders/startCookingAll', tableId: 't1' })
    ).toBe(empty);
    expect(
      orderReducer(empty, { type: 'orders/startCookingAll', tableId: 'tX' })
    ).toBe(empty);
  });
});
