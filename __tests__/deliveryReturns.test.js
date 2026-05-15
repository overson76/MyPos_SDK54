import { computeDeliveryReturns } from '../utils/deliveryReturns';

// 부산 사하구 매장 좌표 (CLAUDE.md seedAddresses 와 같은 동네)
const STORE = { lat: 35.0844, lng: 128.9716 };

const NOW = new Date(2026, 4, 15, 18, 0).getTime();
const HOUR = 60 * 60 * 1000;

function payment({ id, address, ts, items, status = 'paid', reverted = false }) {
  return {
    id,
    tableId: 'd1',
    items: items.map((i) => ({ ...i })),
    deliveryAddress: address,
    paymentStatus: status,
    paymentMethod: 'cash',
    total: 0,
    clearedAt: ts,
    reverted,
  };
}

function book(entries) {
  return { entries };
}

describe('computeDeliveryReturns — 빈 입력 / 가드', () => {
  test('빈 history → 빈 결과', () => {
    const r = computeDeliveryReturns({ history: [], addressBook: book({}), storeCoord: STORE, now: NOW });
    expect(r.ranked).toEqual([]);
    expect(r.unknown).toEqual([]);
    expect(r.storeHasCoord).toBe(true);
  });

  test('storeCoord null → 모두 unknown 으로', () => {
    const history = [
      payment({ id: 'p1', address: '하신번영로 25', ts: NOW - HOUR, items: [{ name: '칼국수', qty: 1 }] }),
    ];
    const r = computeDeliveryReturns({
      history,
      addressBook: book({ '하신번영로 25': { key: '하신번영로 25', label: '하신번영로 25', lat: 35.085, lng: 128.972 } }),
      storeCoord: null,
      now: NOW,
    });
    expect(r.storeHasCoord).toBe(false);
    expect(r.ranked).toEqual([]);
    expect(r.unknown).toHaveLength(1);
    expect(r.unknown[0].label).toBe('하신번영로 25');
  });

  test('history null 안전', () => {
    expect(computeDeliveryReturns().ranked).toEqual([]);
  });
});

describe('computeDeliveryReturns — 필터링', () => {
  test('미결제 entry 제외 (paymentStatus !== paid)', () => {
    const history = [
      payment({ id: 'p1', address: '하신번영로 25', ts: NOW - HOUR, items: [{ name: '칼국수', qty: 1 }], status: 'pending' }),
    ];
    const r = computeDeliveryReturns({
      history,
      addressBook: book({ '하신번영로 25': { lat: 35.085, lng: 128.972 } }),
      storeCoord: STORE,
      now: NOW,
    });
    expect(r.ranked).toEqual([]);
    expect(r.unknown).toEqual([]);
  });

  test('reverted entry 제외 (결제 되돌리기)', () => {
    const history = [
      payment({ id: 'p1', address: '하신번영로 25', ts: NOW - HOUR, items: [{ name: '칼국수', qty: 1 }], reverted: true }),
    ];
    const r = computeDeliveryReturns({
      history,
      addressBook: book({ '하신번영로 25': { lat: 35.085, lng: 128.972 } }),
      storeCoord: STORE,
      now: NOW,
    });
    expect(r.ranked).toEqual([]);
  });

  test('deliveryAddress 없는 entry 제외 (홀/포장)', () => {
    const history = [
      { id: 'p1', items: [{ name: '칼국수', qty: 1 }], paymentStatus: 'paid', clearedAt: NOW - HOUR, deliveryAddress: '' },
    ];
    const r = computeDeliveryReturns({
      history,
      addressBook: book({}),
      storeCoord: STORE,
      now: NOW,
    });
    expect(r.ranked).toEqual([]);
    expect(r.unknown).toEqual([]);
  });

  test('24시간 초과 entry 제외 (default)', () => {
    const history = [
      payment({ id: 'old', address: '하신번영로 25', ts: NOW - 30 * HOUR, items: [{ name: '칼국수', qty: 1 }] }),
      payment({ id: 'recent', address: '하신번영로 25', ts: NOW - HOUR, items: [{ name: '팥죽', qty: 1 }] }),
    ];
    const r = computeDeliveryReturns({
      history,
      addressBook: book({ '하신번영로 25': { lat: 35.085, lng: 128.972 } }),
      storeCoord: STORE,
      now: NOW,
    });
    expect(r.ranked).toHaveLength(1);
    expect(r.ranked[0].menuSummary.map((m) => m.name)).toEqual(['팥죽']);
  });

  test('withinHours 커스텀 (예: 48시간)', () => {
    const history = [
      payment({ id: 'old', address: '하신번영로 25', ts: NOW - 30 * HOUR, items: [{ name: '칼국수', qty: 1 }] }),
    ];
    const r = computeDeliveryReturns({
      history,
      addressBook: book({ '하신번영로 25': { lat: 35.085, lng: 128.972 } }),
      storeCoord: STORE,
      now: NOW,
      withinHours: 48,
    });
    expect(r.ranked).toHaveLength(1);
  });
});

describe('computeDeliveryReturns — 그룹화 (같은 주소 합산)', () => {
  test('같은 주소 두 번 배달 → 메뉴 합산', () => {
    const history = [
      payment({ id: 'p1', address: '하신번영로 25', ts: NOW - 2 * HOUR, items: [{ name: '칼국수', qty: 2 }] }),
      payment({ id: 'p2', address: '하신번영로 25', ts: NOW - 1 * HOUR, items: [{ name: '칼국수', qty: 1 }, { name: '팥죽', qty: 1 }] }),
    ];
    const r = computeDeliveryReturns({
      history,
      addressBook: book({ '하신번영로 25': { lat: 35.085, lng: 128.972, alias: '진실보석' } }),
      storeCoord: STORE,
      now: NOW,
    });
    expect(r.ranked).toHaveLength(1);
    const g = r.ranked[0];
    expect(g.alias).toBe('진실보석');
    expect(g.label).toBe('진실보석');
    expect(g.totalDishes).toBe(4); // 2+1+1
    const calguksu = g.menuSummary.find((m) => m.name === '칼국수');
    expect(calguksu.qty).toBe(3);
    expect(g.entryIds).toEqual(['p1', 'p2']);
  });

  test('largeQty 도 그릇수에 합산', () => {
    const history = [
      payment({ id: 'p1', address: '하신번영로 25', ts: NOW - HOUR, items: [{ name: '새알팥', qty: 1, largeQty: 2 }] }),
    ];
    const r = computeDeliveryReturns({
      history,
      addressBook: book({ '하신번영로 25': { lat: 35.085, lng: 128.972 } }),
      storeCoord: STORE,
      now: NOW,
    });
    expect(r.ranked[0].totalDishes).toBe(3);
  });

  test('주소 정규화 — 대소문자/공백 다른 두 주문 같은 그룹', () => {
    const history = [
      payment({ id: 'p1', address: '하신번영로 25', ts: NOW - HOUR, items: [{ name: '칼국수', qty: 1 }] }),
      payment({ id: 'p2', address: '  하신번영로 25  ', ts: NOW - HOUR, items: [{ name: '팥죽', qty: 1 }] }),
    ];
    const r = computeDeliveryReturns({
      history,
      addressBook: book({ '하신번영로 25': { lat: 35.085, lng: 128.972 } }),
      storeCoord: STORE,
      now: NOW,
    });
    expect(r.ranked).toHaveLength(1);
    expect(r.ranked[0].totalDishes).toBe(2);
  });
});

describe('computeDeliveryReturns — 정렬 (근거리/원거리)', () => {
  test('원거리 우선 (default sortMode=far)', () => {
    const history = [
      payment({ id: 'p1', address: '근처', ts: NOW - HOUR, items: [{ name: '칼국수', qty: 1 }] }),
      payment({ id: 'p2', address: '먼곳', ts: NOW - HOUR, items: [{ name: '팥죽', qty: 1 }] }),
    ];
    const r = computeDeliveryReturns({
      history,
      addressBook: book({
        '근처': { lat: 35.085, lng: 128.972 }, // 매장에서 가까움
        '먼곳': { lat: 35.12, lng: 129.01 },   // 멀음
      }),
      storeCoord: STORE,
      now: NOW,
    });
    expect(r.ranked.map((g) => g.address)).toEqual(['먼곳', '근처']);
    expect(r.ranked[0].rank).toBe(1);
    expect(r.ranked[1].rank).toBe(2);
  });

  test('근거리 우선 (sortMode=near)', () => {
    const history = [
      payment({ id: 'p1', address: '근처', ts: NOW - HOUR, items: [{ name: '칼국수', qty: 1 }] }),
      payment({ id: 'p2', address: '먼곳', ts: NOW - HOUR, items: [{ name: '팥죽', qty: 1 }] }),
    ];
    const r = computeDeliveryReturns({
      history,
      addressBook: book({
        '근처': { lat: 35.085, lng: 128.972 },
        '먼곳': { lat: 35.12, lng: 129.01 },
      }),
      storeCoord: STORE,
      now: NOW,
      sortMode: 'near',
    });
    expect(r.ranked.map((g) => g.address)).toEqual(['근처', '먼곳']);
  });
});

describe('computeDeliveryReturns — 주소불명 분리', () => {
  test('주소록에 없는 entry → unknown', () => {
    const history = [
      payment({ id: 'p1', address: '하나자원', ts: NOW - HOUR, items: [{ name: '칼국수', qty: 1 }] }),
    ];
    const r = computeDeliveryReturns({
      history,
      addressBook: book({}),
      storeCoord: STORE,
      now: NOW,
    });
    expect(r.unknown).toHaveLength(1);
    expect(r.unknown[0].label).toBe('하나자원');
    expect(r.ranked).toEqual([]);
  });

  test('주소록에 있어도 lat/lng 없으면 unknown', () => {
    const history = [
      payment({ id: 'p1', address: '불고기', ts: NOW - HOUR, items: [{ name: '만두', qty: 1 }] }),
    ];
    const r = computeDeliveryReturns({
      history,
      addressBook: book({ '불고기': { key: '불고기', label: '불고기', alias: '불고기집' } }),
      storeCoord: STORE,
      now: NOW,
    });
    expect(r.unknown).toHaveLength(1);
    expect(r.unknown[0].label).toBe('불고기집'); // alias 있으면 alias
  });

  test('unknown 들 라벨 가나다 정렬', () => {
    const history = [
      payment({ id: 'p1', address: '불고기', ts: NOW - HOUR, items: [{ name: '칼국수', qty: 1 }] }),
      payment({ id: 'p2', address: '하나자원', ts: NOW - HOUR, items: [{ name: '팥죽', qty: 2 }] }),
      payment({ id: 'p3', address: '과자집', ts: NOW - HOUR, items: [{ name: '만두', qty: 1 }] }),
    ];
    const r = computeDeliveryReturns({
      history,
      addressBook: book({}),
      storeCoord: STORE,
      now: NOW,
    });
    expect(r.unknown.map((u) => u.label)).toEqual(['과자집', '불고기', '하나자원']);
  });

  test('주소불명 + 거리 있는 거 같이 있을 때 — 분리 보존', () => {
    const history = [
      payment({ id: 'p1', address: '주소록있음', ts: NOW - HOUR, items: [{ name: '칼국수', qty: 1 }] }),
      payment({ id: 'p2', address: '주소록없음', ts: NOW - HOUR, items: [{ name: '팥죽', qty: 1 }] }),
    ];
    const r = computeDeliveryReturns({
      history,
      addressBook: book({ '주소록있음': { lat: 35.09, lng: 128.97 } }),
      storeCoord: STORE,
      now: NOW,
    });
    expect(r.ranked).toHaveLength(1);
    expect(r.unknown).toHaveLength(1);
  });
});

describe('computeDeliveryReturns — 별칭 vs 주소 라벨 우선순위', () => {
  test('별칭 있으면 label = alias', () => {
    const history = [
      payment({ id: 'p1', address: '부산 사하구 하신번영로 25', ts: NOW - HOUR, items: [{ name: '칼국수', qty: 1 }] }),
    ];
    const r = computeDeliveryReturns({
      history,
      addressBook: book({
        '부산 사하구 하신번영로 25': {
          lat: 35.085,
          lng: 128.972,
          alias: '진실보석',
        },
      }),
      storeCoord: STORE,
      now: NOW,
    });
    expect(r.ranked[0].label).toBe('진실보석');
    expect(r.ranked[0].alias).toBe('진실보석');
    expect(r.ranked[0].address).toBe('부산 사하구 하신번영로 25');
  });

  test('별칭 없으면 label = address', () => {
    const history = [
      payment({ id: 'p1', address: '부산 사하구 하신번영로 25', ts: NOW - HOUR, items: [{ name: '칼국수', qty: 1 }] }),
    ];
    const r = computeDeliveryReturns({
      history,
      addressBook: book({
        '부산 사하구 하신번영로 25': { lat: 35.085, lng: 128.972 },
      }),
      storeCoord: STORE,
      now: NOW,
    });
    expect(r.ranked[0].label).toBe('부산 사하구 하신번영로 25');
    expect(r.ranked[0].alias).toBe('');
  });
});
