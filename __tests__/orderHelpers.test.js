import {
  capHistory,
  REVENUE_HISTORY_CAP,
  normalizeAddressKey,
  localDateString,
  genSlotId,
  normalizeSlots,
  resolveTableForAlert,
  mergeOrderParts,
  detectDynamicSlotPrefix,
  compactSlotsByPrefix,
  markHistoryReverted,
  findHistoryEntry,
} from '../utils/orderHelpers';

describe('capHistory', () => {
  test('한도 이하면 그대로', () => {
    const arr = [1, 2, 3];
    expect(capHistory(arr)).toBe(arr);
  });

  test('한도 초과시 끝에서 N개만 유지', () => {
    const arr = Array.from({ length: REVENUE_HISTORY_CAP + 5 }, (_, i) => i);
    const result = capHistory(arr);
    expect(result).toHaveLength(REVENUE_HISTORY_CAP);
    expect(result[0]).toBe(5);
    expect(result[result.length - 1]).toBe(REVENUE_HISTORY_CAP + 4);
  });
});

describe('normalizeAddressKey', () => {
  test('소문자 + 공백 정규화', () => {
    expect(normalizeAddressKey('  Seoul   GANGNAM  123 ')).toBe('seoul gangnam 123');
  });

  test('null/undefined 안전', () => {
    expect(normalizeAddressKey(null)).toBe('');
    expect(normalizeAddressKey(undefined)).toBe('');
  });

  test('한글 / 하이픈 보존', () => {
    expect(normalizeAddressKey('서울 강남 123-45')).toBe('서울 강남 123-45');
  });
});

describe('localDateString', () => {
  test('YYYY-MM-DD 패턴', () => {
    const s = localDateString();
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('타임스탬프 → 같은 일자', () => {
    const ts = new Date(2026, 0, 5, 10, 0, 0).getTime();
    expect(localDateString(ts)).toBe('2026-01-05');
  });
});

describe('genSlotId', () => {
  test('s- prefix 와 충분한 엔트로피', () => {
    const a = genSlotId();
    const b = genSlotId();
    expect(a).toMatch(/^s-/);
    expect(b).toMatch(/^s-/);
    expect(a).not.toBe(b);
  });
});

describe('normalizeSlots', () => {
  test('qty <= 0 인 항목은 제거', () => {
    expect(normalizeSlots([{ id: 'a', qty: 0 }])).toEqual([]);
    expect(normalizeSlots([{ id: 'a', qty: -1 }])).toEqual([]);
    expect(normalizeSlots([null, undefined])).toEqual([]);
  });

  test('동일 (id, options, memo, cookState) 합산', () => {
    const result = normalizeSlots([
      { id: 'a', qty: 2, largeQty: 1 },
      { id: 'a', qty: 3, largeQty: 0 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'a', qty: 5, largeQty: 1 });
  });

  test('options 가 다르면 별도 슬롯', () => {
    const result = normalizeSlots([
      { id: 'a', qty: 1, options: ['extra'] },
      { id: 'a', qty: 1, options: [] },
    ]);
    expect(result).toHaveLength(2);
  });

  test('options 정렬 후 비교 — 순서 차이는 동일 슬롯', () => {
    const result = normalizeSlots([
      { id: 'a', qty: 1, options: ['치즈', '매운맛'] },
      { id: 'a', qty: 1, options: ['매운맛', '치즈'] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].qty).toBe(2);
  });

  test('memo 가 다르면 별도 슬롯', () => {
    const result = normalizeSlots([
      { id: 'a', qty: 1, memo: '소스 따로' },
      { id: 'a', qty: 1, memo: '' },
    ]);
    expect(result).toHaveLength(2);
  });

  test('cookState 가 다르면 별도 슬롯', () => {
    const result = normalizeSlots([
      { id: 'a', qty: 1, cookState: 'pending' },
      { id: 'a', qty: 1, cookState: 'ready' },
    ]);
    expect(result).toHaveLength(2);
  });

  test('sourceTableId 가 다르면 별도 슬롯 (단체 묶기 후 1인 결제 분리 지원)', () => {
    const result = normalizeSlots([
      { id: 'a', qty: 2, sourceTableId: 't01' },
      { id: 'a', qty: 3, sourceTableId: 't02' },
    ]);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.sourceTableId === 't01').qty).toBe(2);
    expect(result.find((r) => r.sourceTableId === 't02').qty).toBe(3);
  });

  test('sourceTableId 같으면 합산', () => {
    const result = normalizeSlots([
      { id: 'a', qty: 2, sourceTableId: 't01' },
      { id: 'a', qty: 3, sourceTableId: 't01' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].qty).toBe(5);
  });

  test('sourceTableId 한쪽만 있으면 별도 슬롯', () => {
    const result = normalizeSlots([
      { id: 'a', qty: 1 },
      { id: 'a', qty: 2, sourceTableId: 't01' },
    ]);
    expect(result).toHaveLength(2);
  });

  test('1.0.34 — largeQty 가 있어도 sizeUpcharge 가 손실되지 않게 합산', () => {
    const a = [
      { id: 'a', qty: 2, largeQty: 2, sizeUpcharge: 2000, price: 10000 },
    ];
    const b = [{ id: 'a', qty: 1, largeQty: 0, price: 10000 }];
    const result = normalizeSlots([...a, ...b]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      qty: 3,
      largeQty: 2,
      sizeUpcharge: 2000,
    });
  });
});

describe('resolveTableForAlert', () => {
  test('일반 ID 는 테이블 그대로 (existing tables 중 하나)', () => {
    const t = resolveTableForAlert('t01');
    expect(t).toMatchObject({ id: 't01', label: '01' });
  });

  test('단체 ID (`#`) 는 부모 라벨에 idx 부착', () => {
    const t = resolveTableForAlert('t01#2');
    expect(t).toMatchObject({ id: 't01#2', label: '01-2', parentId: 't01' });
  });

  test('알 수 없는 부모 ID 는 null', () => {
    expect(resolveTableForAlert('xx#1')).toBeNull();
  });
});

describe('mergeOrderParts', () => {
  test('양쪽 모두 비어있으면 null', () => {
    expect(mergeOrderParts({}, {})).toBeNull();
  });

  test('items / cartItems 합쳐짐', () => {
    const a = { items: [{ id: 'a', qty: 1 }], cartItems: [] };
    const b = { items: [{ id: 'a', qty: 2 }], cartItems: [{ id: 'b', qty: 1 }] };
    const merged = mergeOrderParts(a, b);
    // 1.0.34 fix 후 normalizeSlots 가 옵션 보존 위해 options:[] 박음 — toMatchObject 로
    // 핵심 필드만 검증.
    expect(merged.items).toHaveLength(1);
    expect(merged.items[0]).toMatchObject({ id: 'a', qty: 3 });
    expect(merged.cartItems).toHaveLength(1);
    expect(merged.cartItems[0]).toMatchObject({ id: 'b', qty: 1 });
  });

  test('createdAt 은 둘 중 더 빠른 시각', () => {
    const merged = mergeOrderParts(
      { items: [{ id: 'a', qty: 1 }], createdAt: 200 },
      { items: [{ id: 'a', qty: 1 }], createdAt: 100 }
    );
    expect(merged.createdAt).toBe(100);
  });

  test('paymentStatus 는 둘 다 paid 일 때만 paid', () => {
    const both = mergeOrderParts(
      { items: [{ id: 'a', qty: 1 }], paymentStatus: 'paid' },
      { items: [{ id: 'a', qty: 1 }], paymentStatus: 'paid' }
    );
    expect(both.paymentStatus).toBe('paid');

    const one = mergeOrderParts(
      { items: [{ id: 'a', qty: 1 }], paymentStatus: 'paid' },
      { items: [{ id: 'a', qty: 1 }], paymentStatus: 'unpaid' }
    );
    expect(one.paymentStatus).toBe('unpaid');
  });

  test('status 는 둘 다 ready 일 때만 ready', () => {
    const merged = mergeOrderParts(
      { items: [{ id: 'a', qty: 1 }], status: 'ready' },
      { items: [{ id: 'a', qty: 1 }], status: 'preparing' }
    );
    expect(merged.status).toBe('preparing');
  });

  test('options 는 dedupe', () => {
    const merged = mergeOrderParts(
      { items: [{ id: 'a', qty: 1 }], options: ['포장'] },
      { items: [{ id: 'a', qty: 1 }], options: ['포장', '봉투'] }
    );
    expect(merged.options.sort()).toEqual(['봉투', '포장']);
  });

  test('1.0.35 — sourceTableId 가 박힌 슬롯은 합쳐도 별도 슬롯 유지 (1인 결제 토대)', () => {
    const merged = mergeOrderParts(
      { items: [{ id: 'a', qty: 1, sourceTableId: 't01' }] },
      { items: [{ id: 'a', qty: 2, sourceTableId: 't02' }] }
    );
    expect(merged.items).toHaveLength(2);
    expect(merged.items.find((i) => i.sourceTableId === 't01').qty).toBe(1);
    expect(merged.items.find((i) => i.sourceTableId === 't02').qty).toBe(2);
  });
});

describe('detectDynamicSlotPrefix', () => {
  test('예약/포장/배달 슬롯 prefix 인식', () => {
    expect(detectDynamicSlotPrefix('y1')).toBe('y');
    expect(detectDynamicSlotPrefix('y10')).toBe('y');
    expect(detectDynamicSlotPrefix('p3')).toBe('p');
    expect(detectDynamicSlotPrefix('d5')).toBe('d');
  });

  test('일반 테이블/방/분할 슬롯은 null', () => {
    expect(detectDynamicSlotPrefix('t01')).toBeNull();
    expect(detectDynamicSlotPrefix('r10')).toBeNull();
    expect(detectDynamicSlotPrefix('y2#1')).toBeNull();
    expect(detectDynamicSlotPrefix('')).toBeNull();
    expect(detectDynamicSlotPrefix(null)).toBeNull();
  });
});

describe('compactSlotsByPrefix', () => {
  const A = { items: [{ id: 'a', qty: 1 }] };
  const B = { items: [{ id: 'b', qty: 2 }] };
  const C = { items: [{ id: 'c', qty: 3 }] };
  const T = { items: [{ id: 't', qty: 1 }] }; // 일반 테이블 — 영향 받지 않아야 함

  test('빈자리 없으면 변경 없음', () => {
    const orders = { y1: A, y2: B };
    const { orders: next, mapping } = compactSlotsByPrefix(orders, 'y');
    expect(next).toBe(orders);
    expect(mapping.size).toBe(0);
  });

  test('y2 가 비고 y3 가 차 있으면 y3 → y2', () => {
    const orders = { y1: A, y3: C, t05: T };
    const { orders: next, mapping } = compactSlotsByPrefix(orders, 'y');
    expect(next.y1).toBe(A);
    expect(next.y2).toBe(C);
    expect(next.y3).toBeUndefined();
    expect(next.t05).toBe(T); // 다른 prefix 보존
    expect(mapping.get(3)).toBe(2);
  });

  test('y1 이 비고 y2/y3 가 차 있으면 y2→y1, y3→y2', () => {
    const orders = { y2: B, y3: C };
    const { orders: next, mapping } = compactSlotsByPrefix(orders, 'y');
    expect(next.y1).toBe(B);
    expect(next.y2).toBe(C);
    expect(next.y3).toBeUndefined();
    expect(mapping.get(2)).toBe(1);
    expect(mapping.get(3)).toBe(2);
  });

  test('포장 prefix 도 동일하게 동작', () => {
    const orders = { p1: A, p3: C };
    const { orders: next } = compactSlotsByPrefix(orders, 'p');
    expect(next.p1).toBe(A);
    expect(next.p2).toBe(C);
    expect(next.p3).toBeUndefined();
  });

  test('배달 prefix 도 동일하게 동작 (10 이상 자리수도 정렬 정상)', () => {
    const orders = { d1: A, d2: B, d10: C };
    const { orders: next } = compactSlotsByPrefix(orders, 'd');
    expect(next.d1).toBe(A);
    expect(next.d2).toBe(B);
    expect(next.d3).toBe(C);
    expect(next.d10).toBeUndefined();
  });

  test('분할 슬롯(y2#1) 은 영향 없음 — 그대로 유지', () => {
    const split = { items: [{ id: 's', qty: 1 }] };
    const orders = { y1: A, 'y2#1': split, y3: C };
    const { orders: next, mapping } = compactSlotsByPrefix(orders, 'y');
    expect(next.y1).toBe(A);
    expect(next.y2).toBe(C); // y3 → y2
    expect(next['y2#1']).toBe(split); // 분할은 그대로
    expect(next.y3).toBeUndefined();
    expect(mapping.get(3)).toBe(2);
  });

  test('빈 dict 는 변경 없음', () => {
    const orders = {};
    const { orders: next, mapping } = compactSlotsByPrefix(orders, 'y');
    expect(next).toBe(orders);
    expect(mapping.size).toBe(0);
  });
});

describe('markHistoryReverted', () => {
  const sample = {
    total: 30000,
    history: [
      { id: 'a', total: 10000 },
      { id: 'b', total: 20000 },
    ],
  };

  test('해당 entry 에 reverted=true / revertedAt 박고 total 차감', () => {
    const next = markHistoryReverted(sample, 'a');
    expect(next.history[0].reverted).toBe(true);
    expect(next.history[0].revertedAt).toBeGreaterThan(0);
    expect(next.history[1].reverted).toBeUndefined();
    expect(next.total).toBe(20000);
  });

  test('id 못 찾으면 그대로', () => {
    expect(markHistoryReverted(sample, 'z')).toBe(sample);
  });

  test('이미 reverted 면 그대로 (중복 차감 방지)', () => {
    const already = {
      total: 20000,
      history: [{ id: 'a', total: 10000, reverted: true, revertedAt: 1 }],
    };
    expect(markHistoryReverted(already, 'a')).toBe(already);
  });

  test('total 이 entry.total 보다 작으면 0 으로 클램프', () => {
    const skewed = {
      total: 5000,
      history: [{ id: 'a', total: 10000 }],
    };
    expect(markHistoryReverted(skewed, 'a').total).toBe(0);
  });
});

describe('findHistoryEntry', () => {
  const history = [{ id: 'a' }, { id: 'b' }];

  test('id 일치하는 entry 반환', () => {
    expect(findHistoryEntry(history, 'b')).toBe(history[1]);
  });

  test('없으면 null', () => {
    expect(findHistoryEntry(history, 'z')).toBe(null);
  });

  test('history 가 falsy 면 null', () => {
    expect(findHistoryEntry(undefined, 'a')).toBe(null);
    expect(findHistoryEntry(null, 'a')).toBe(null);
  });
});
