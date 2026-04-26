import {
  capHistory,
  REVENUE_HISTORY_CAP,
  normalizeAddressKey,
  localDateString,
  sweepHistoryPII,
  PII_RETENTION_MS,
  genSlotId,
  normalizeSlots,
  resolveTableForAlert,
  mergeOrderParts,
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

describe('sweepHistoryPII', () => {
  const now = Date.now();

  test('보존 기간 내 항목은 deliveryAddress 유지', () => {
    const fresh = [
      { id: 1, total: 1000, deliveryAddress: '서울', clearedAt: now - 1000 },
    ];
    const result = sweepHistoryPII(fresh);
    expect(result[0].deliveryAddress).toBe('서울');
  });

  test('만료된 항목은 deliveryAddress / deliveryTime 제거 (총합/id 유지)', () => {
    const stale = [
      {
        id: 1,
        total: 1000,
        deliveryAddress: '서울',
        deliveryTime: '12:30',
        clearedAt: now - PII_RETENTION_MS - 1000,
      },
    ];
    const result = sweepHistoryPII(stale);
    expect(result[0]).toEqual({ id: 1, total: 1000, clearedAt: stale[0].clearedAt });
    expect(result[0].deliveryAddress).toBeUndefined();
    expect(result[0].deliveryTime).toBeUndefined();
  });

  test('변경이 없으면 원본 배열 그대로 반환 (참조 동일)', () => {
    const arr = [{ id: 1, total: 1000 }];
    expect(sweepHistoryPII(arr)).toBe(arr);
  });

  test('null/undefined 항목 안전 통과', () => {
    const arr = [null, { id: 1, total: 100 }];
    const result = sweepHistoryPII(arr);
    expect(result).toEqual(arr);
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
    expect(merged.items).toEqual([{ id: 'a', qty: 3 }]);
    expect(merged.cartItems).toEqual([{ id: 'b', qty: 1 }]);
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
});
