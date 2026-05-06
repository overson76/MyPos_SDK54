import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LIST,
  PAYMENT_METHOD_UNSPECIFIED,
  paymentMethodLabel,
  splitVatIncluded,
  addVatExcluded,
  summarizeByPaymentMethod,
  historyToCsv,
  summarizeDaily,
  summarizeMonthly,
} from '../utils/payment';

describe('paymentMethodLabel', () => {
  test('알려진 코드는 한국어 라벨', () => {
    expect(paymentMethodLabel('cash')).toBe('현금');
    expect(paymentMethodLabel('card')).toBe('카드');
    expect(paymentMethodLabel('transfer')).toBe('계좌이체');
    expect(paymentMethodLabel('localCurrency')).toBe('지역화폐');
  });
  test('null / undefined / unspecified → 미분류', () => {
    expect(paymentMethodLabel(null)).toBe('미분류');
    expect(paymentMethodLabel(undefined)).toBe('미분류');
    expect(paymentMethodLabel(PAYMENT_METHOD_UNSPECIFIED)).toBe('미분류');
  });
  test('모르는 코드 → 미분류', () => {
    expect(paymentMethodLabel('crypto')).toBe('미분류');
  });
});

describe('splitVatIncluded', () => {
  test('11000원 (부가세 포함) → 공급가액 10000 + 부가세 1000', () => {
    const r = splitVatIncluded(11000);
    expect(r.total).toBe(11000);
    expect(r.supply).toBe(10000);
    expect(r.vat).toBe(1000);
  });
  test('소수점 반올림 안전 — 합 = total 항상 보장', () => {
    // 1000 / 1.1 = 909.09... → 909
    // 1000 - 909 = 91
    const r = splitVatIncluded(1000);
    expect(r.supply + r.vat).toBe(1000);
    expect(r.supply).toBe(909);
    expect(r.vat).toBe(91);
  });
  test('0 → 0/0/0', () => {
    expect(splitVatIncluded(0)).toEqual({ total: 0, supply: 0, vat: 0 });
  });
  test('null/undefined 안전', () => {
    expect(splitVatIncluded(null)).toEqual({ total: 0, supply: 0, vat: 0 });
    expect(splitVatIncluded(undefined)).toEqual({ total: 0, supply: 0, vat: 0 });
  });
});

describe('addVatExcluded', () => {
  test('공급가액 10000 → 11000 (부가세 1000)', () => {
    const r = addVatExcluded(10000);
    expect(r.supply).toBe(10000);
    expect(r.vat).toBe(1000);
    expect(r.total).toBe(11000);
  });
  test('0 → 0/0/0', () => {
    expect(addVatExcluded(0)).toEqual({ supply: 0, vat: 0, total: 0 });
  });
});

describe('summarizeByPaymentMethod', () => {
  const sample = [
    { total: 10000, paymentMethod: 'cash' },
    { total: 5000, paymentMethod: 'cash' },
    { total: 20000, paymentMethod: 'card' },
    { total: 7000, paymentMethod: 'transfer' },
    { total: 3000 }, // 옛 데이터 — paymentMethod 없음
    { total: 1500, paymentMethod: 'crypto' }, // 모르는 코드
  ];

  test('각 결제수단 합계 + 건수', () => {
    const r = summarizeByPaymentMethod(sample);
    expect(r.cash).toEqual({ count: 2, total: 15000 });
    expect(r.card).toEqual({ count: 1, total: 20000 });
    expect(r.transfer).toEqual({ count: 1, total: 7000 });
    expect(r.localCurrency).toEqual({ count: 0, total: 0 });
  });
  test('paymentMethod 없는 옛 데이터는 unspecified', () => {
    const r = summarizeByPaymentMethod(sample);
    // 'crypto' 같은 모르는 코드 + null 모두 unspecified
    expect(r.unspecified.count).toBe(2);
    expect(r.unspecified.total).toBe(4500);
  });
  test('빈 배열 / null', () => {
    const empty = summarizeByPaymentMethod([]);
    PAYMENT_METHOD_LIST.forEach((c) => {
      expect(empty[c]).toEqual({ count: 0, total: 0 });
    });
    expect(summarizeByPaymentMethod(null).cash).toEqual({ count: 0, total: 0 });
  });
});

describe('historyToCsv', () => {
  test('헤더 + 한 행 직렬화', () => {
    const csv = historyToCsv([
      {
        clearedAt: new Date('2026-04-29T14:30:00').getTime(),
        tableId: '1',
        items: [
          { name: '치킨', qty: 2, price: 10000 },
          { name: '콜라', qty: 1, price: 2000 },
        ],
        paymentMethod: 'card',
        paymentStatus: 'paid',
        deliveryAddress: '',
        total: 22000,
      },
    ]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('시점,테이블,메뉴,결제수단,결제상태,배달주소,합계,공급가액,부가세');
    // 메뉴는 "치킨×2,콜라×1" — 콤마 포함이라 큰따옴표로 감싸짐
    expect(lines[1]).toContain('"치킨×2,콜라×1"');
    expect(lines[1]).toContain('카드');
    expect(lines[1]).toContain('결제완료');
    expect(lines[1]).toContain('22000');
    // VAT 분리: 22000 / 1.1 = 20000 + 2000
    expect(lines[1]).toContain('20000');
    expect(lines[1]).toContain('2000');
  });

  test('빈 history → 헤더만', () => {
    const csv = historyToCsv([]);
    expect(csv.split('\n').length).toBe(1);
  });

  test('CSV 셀 escape — 큰따옴표 두 번', () => {
    const csv = historyToCsv([
      {
        clearedAt: 0,
        tableId: '1',
        items: [{ name: '메뉴 "특별"', qty: 1, price: 1000 }],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        deliveryAddress: '',
        total: 1000,
      },
    ]);
    expect(csv).toContain('"메뉴 ""특별""×1"');
  });

  test('paymentMethod 없는 옛 데이터 → 미분류', () => {
    const csv = historyToCsv([
      {
        clearedAt: 0,
        tableId: '1',
        items: [{ name: 'X', qty: 1, price: 1000 }],
        paymentStatus: 'paid',
        total: 1000,
      },
    ]);
    expect(csv).toContain('미분류');
  });
});

describe('summarizeDaily', () => {
  const sample = [
    {
      clearedAt: new Date('2026-04-29T12:30:00').getTime(),
      items: [
        { name: '치킨', qty: 2, price: 10000 },
        { name: '콜라', qty: 1, price: 2000 },
      ],
      total: 22000,
      paymentMethod: 'card',
    },
    {
      clearedAt: new Date('2026-04-29T18:45:00').getTime(),
      items: [{ name: '치킨', qty: 1, price: 10000 }],
      total: 10000,
      paymentMethod: 'cash',
    },
  ];

  test('byMenu — 메뉴별 수량/매출, 매출 내림차순', () => {
    const { byMenu } = summarizeDaily(sample);
    expect(byMenu[0].name).toBe('치킨');
    expect(byMenu[0].qty).toBe(3);
    expect(byMenu[0].total).toBe(30000);
    expect(byMenu[1].name).toBe('콜라');
    expect(byMenu[1].qty).toBe(1);
    expect(byMenu[1].total).toBe(2000);
  });

  test('byHour — 시간대별 건수/매출 (24시간 배열)', () => {
    const { byHour } = summarizeDaily(sample);
    expect(byHour.length).toBe(24);
    expect(byHour[12].count).toBe(1);
    expect(byHour[12].total).toBe(22000);
    expect(byHour[18].count).toBe(1);
    expect(byHour[18].total).toBe(10000);
    expect(byHour[0].count).toBe(0);
  });

  test('byPayment — summarizeByPaymentMethod 와 동일', () => {
    const { byPayment } = summarizeDaily(sample);
    expect(byPayment.card).toEqual({ count: 1, total: 22000 });
    expect(byPayment.cash).toEqual({ count: 1, total: 10000 });
  });

  test('빈 history', () => {
    const { byMenu, byHour, byPayment } = summarizeDaily([]);
    expect(byMenu).toEqual([]);
    expect(byHour.every((h) => h.count === 0)).toBe(true);
    expect(byPayment.cash.total).toBe(0);
  });
});

describe('summarizeMonthly', () => {
  // 4월 29일(수), 4월 28일(화), 4월 27일(월) — 3일치
  const sample = [
    {
      clearedAt: new Date('2026-04-29T12:30:00').getTime(), // 수요일
      items: [{ name: '치킨', qty: 2, price: 10000 }],
      total: 20000,
      paymentMethod: 'card',
    },
    {
      clearedAt: new Date('2026-04-29T18:30:00').getTime(), // 같은 수요일
      items: [{ name: '콜라', qty: 1, price: 2000 }],
      total: 2000,
      paymentMethod: 'cash',
    },
    {
      clearedAt: new Date('2026-04-28T12:00:00').getTime(), // 화요일
      items: [{ name: '치킨', qty: 1, price: 10000 }],
      total: 10000,
      paymentMethod: 'card',
    },
    {
      clearedAt: new Date('2026-04-27T12:00:00').getTime(), // 월요일
      items: [{ name: '피자', qty: 1, price: 15000 }],
      total: 15000,
      paymentMethod: 'transfer',
    },
  ];

  test('byMenu — 메뉴별 매출 내림차순', () => {
    const { byMenu } = summarizeMonthly(sample);
    expect(byMenu[0].name).toBe('치킨');
    expect(byMenu[0].qty).toBe(3);
    expect(byMenu[0].total).toBe(30000);
    expect(byMenu[1].name).toBe('피자');
    expect(byMenu[2].name).toBe('콜라');
  });

  test('byDayOfWeek — 7개 요일 (일~토 순서)', () => {
    const { byDayOfWeek } = summarizeMonthly(sample);
    expect(byDayOfWeek.length).toBe(7);
    expect(byDayOfWeek[0].label).toBe('일');
    expect(byDayOfWeek[6].label).toBe('토');

    // 월요일(1): 1건 / 15000
    expect(byDayOfWeek[1].count).toBe(1);
    expect(byDayOfWeek[1].total).toBe(15000);
    // 화요일(2): 1건 / 10000
    expect(byDayOfWeek[2].count).toBe(1);
    expect(byDayOfWeek[2].total).toBe(10000);
    // 수요일(3): 2건 / 22000
    expect(byDayOfWeek[3].count).toBe(2);
    expect(byDayOfWeek[3].total).toBe(22000);
    // 일요일(0): 0건
    expect(byDayOfWeek[0].count).toBe(0);
  });

  test('totalDays — 영업일 카운트 (중복 날짜는 1일)', () => {
    const { totalDays } = summarizeMonthly(sample);
    // 4/29 두 건은 같은 날 → 영업일 3일
    expect(totalDays).toBe(3);
  });

  test('byPayment — summarizeByPaymentMethod 와 동일', () => {
    const { byPayment } = summarizeMonthly(sample);
    expect(byPayment.card.count).toBe(2);
    expect(byPayment.card.total).toBe(30000);
    expect(byPayment.cash.count).toBe(1);
    expect(byPayment.transfer.count).toBe(1);
  });

  test('빈 history', () => {
    const r = summarizeMonthly([]);
    expect(r.byMenu).toEqual([]);
    expect(r.byDayOfWeek.every((d) => d.count === 0)).toBe(true);
    expect(r.totalDays).toBe(0);
  });
});

describe('PAYMENT_METHODS / PAYMENT_METHOD_LIST', () => {
  test('LIST 가 모든 키를 커버', () => {
    PAYMENT_METHOD_LIST.forEach((code) => {
      expect(PAYMENT_METHODS[code]).toBeDefined();
    });
  });
  test('현재 한국 매장 기본 4종', () => {
    expect(PAYMENT_METHOD_LIST).toEqual(['cash', 'card', 'transfer', 'localCurrency']);
  });
});

describe('reverted entry — 모든 집계에서 제외', () => {
  const sample = [
    {
      id: 'a',
      total: 10000,
      paymentMethod: 'cash',
      clearedAt: new Date(2025, 0, 15, 12, 0).getTime(),
      items: [{ name: '김치찌개', qty: 1, price: 10000 }],
    },
    {
      id: 'b',
      total: 20000,
      paymentMethod: 'card',
      clearedAt: new Date(2025, 0, 15, 13, 0).getTime(),
      items: [{ name: '비빔밥', qty: 2, price: 10000 }],
      reverted: true,
      revertedAt: new Date(2025, 0, 15, 14, 0).getTime(),
    },
    {
      id: 'c',
      total: 5000,
      paymentMethod: 'cash',
      clearedAt: new Date(2025, 0, 15, 14, 0).getTime(),
      items: [{ name: '콜라', qty: 1, price: 5000 }],
    },
  ];

  test('summarizeByPaymentMethod — reverted 제외', () => {
    const r = summarizeByPaymentMethod(sample);
    expect(r.cash.count).toBe(2);
    expect(r.cash.total).toBe(15000);
    expect(r.card.count).toBe(0);
    expect(r.card.total).toBe(0);
  });

  test('summarizeDaily — reverted 의 메뉴/시간대 모두 제외', () => {
    const r = summarizeDaily(sample);
    const names = r.byMenu.map((m) => m.name);
    expect(names).toContain('김치찌개');
    expect(names).toContain('콜라');
    expect(names).not.toContain('비빔밥');
    expect(r.byHour[13].count).toBe(0);
    expect(r.byHour[12].count).toBe(1);
    expect(r.byHour[14].count).toBe(1);
  });

  test('summarizeMonthly — reverted entry 의 메뉴/요일 제외', () => {
    const r = summarizeMonthly(sample);
    expect(r.totalDays).toBe(1);
    expect(r.byMenu.find((m) => m.name === '비빔밥')).toBeUndefined();
  });

  test('historyToCsv — reverted row 는 합계 0 + 되돌림 컬럼 표시', () => {
    const csv = historyToCsv(sample);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('되돌림');
    const bLine = lines.find((l) => l.includes('비빔밥'));
    expect(bLine).toBeDefined();
    const cols = bLine.split(',');
    expect(cols[6]).toBe('0'); // 합계 0
    expect(cols[cols.length - 1]).toMatch(/^"?Y/);
  });

  test('historyToCsv — 정상 row 는 되돌림 컬럼 빈값', () => {
    const csv = historyToCsv(sample);
    const lines = csv.split('\n');
    const aLine = lines.find((l) => l.includes('김치찌개'));
    const cols = aLine.split(',');
    expect(cols[cols.length - 1]).toBe('');
  });
});
