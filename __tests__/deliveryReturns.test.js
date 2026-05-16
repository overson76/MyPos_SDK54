import {
  computeDeliveryReturns,
  resortRanked,
  getLastRoundCreatedAt,
  getNextRoundNo,
} from '../utils/deliveryReturns';

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
  test('알 수 없는 status entry 제외 (paymentStatus = pending 등)', () => {
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

  test('조리완료(status=ready) 도 회수 후보로 포함 — 2026-05-16 사장님 의도', () => {
    // 후불 배달 등에서 결제완료가 늦어 회수 차수에 안 잡히던 문제 해소.
    // 조리완료 = 라이더 출발 = 회수 시작 가능.
    const history = [
      payment({ id: 'r1', address: '하신번영로 25', ts: NOW - HOUR, items: [{ name: '칼국수', qty: 1 }], status: 'ready' }),
      payment({ id: 'p1', address: '하신번영로 200', ts: NOW - HOUR, items: [{ name: '비빔밥', qty: 1 }], status: 'paid' }),
    ];
    const r = computeDeliveryReturns({
      history,
      addressBook: book({
        '하신번영로 25': { lat: 35.085, lng: 128.972, alias: '진실보석' },
        '하신번영로 200': { lat: 35.09, lng: 128.975 },
      }),
      storeCoord: STORE,
      now: NOW,
    });
    // ready 1건 + paid 1건 = 총 2건이 ranked 에 들어감.
    expect(r.ranked.length).toBe(2);
    const aliases = r.ranked.map((it) => it.label);
    expect(aliases).toContain('진실보석');
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

describe('computeDeliveryReturns — drivingM 우선 사용', () => {
  test('entry.drivingM 캐시 + 매장 좌표 일치 → 도로 실거리', () => {
    const history = [
      payment({ id: 'p1', address: '주소A', ts: NOW - HOUR, items: [{ name: '칼국수', qty: 1 }] }),
    ];
    const r = computeDeliveryReturns({
      history,
      addressBook: book({
        '주소a': {
          lat: 35.09,
          lng: 128.97,
          drivingM: 2500,
          drivingFromLat: STORE.lat,
          drivingFromLng: STORE.lng,
        },
      }),
      storeCoord: STORE,
      now: NOW,
    });
    expect(r.ranked[0].distanceM).toBe(2500);
    expect(r.ranked[0].isDrivingDistance).toBe(true);
  });

  test('drivingM 있어도 매장 좌표 다르면 직선거리 fallback', () => {
    const history = [
      payment({ id: 'p1', address: '주소A', ts: NOW - HOUR, items: [{ name: '칼국수', qty: 1 }] }),
    ];
    const r = computeDeliveryReturns({
      history,
      addressBook: book({
        '주소a': {
          lat: 35.09,
          lng: 128.97,
          drivingM: 9999,
          drivingFromLat: 36.0, // 다른 매장 좌표 (현재 STORE 와 불일치)
          drivingFromLng: 127.0,
        },
      }),
      storeCoord: STORE,
      now: NOW,
    });
    expect(r.ranked[0].isDrivingDistance).toBe(false);
    expect(r.ranked[0].distanceM).not.toBe(9999);
  });

  test('coord 필드 노출 (지도 마커용)', () => {
    const history = [
      payment({ id: 'p1', address: '주소A', ts: NOW - HOUR, items: [{ name: '칼국수', qty: 1 }] }),
    ];
    const r = computeDeliveryReturns({
      history,
      addressBook: book({
        '주소a': { lat: 35.09, lng: 128.97 },
      }),
      storeCoord: STORE,
      now: NOW,
    });
    expect(r.ranked[0].coord).toEqual({ lat: 35.09, lng: 128.97 });
  });
});

describe('computeDeliveryReturns — sinceMs/untilMs (차수 진행중 계산)', () => {
  test('sinceMs 이후 entry 만', () => {
    const history = [
      payment({ id: 'old', address: '주소A', ts: 1000, items: [{ name: '칼국수', qty: 1 }] }),
      payment({ id: 'new', address: '주소B', ts: 5000, items: [{ name: '팥죽', qty: 1 }] }),
    ];
    const r = computeDeliveryReturns({
      history,
      addressBook: book({}),
      storeCoord: STORE,
      sinceMs: 3000,
      now: 10000,
    });
    expect(r.unknown.map((u) => u.address)).toEqual(['주소B']);
  });

  test('sinceMs/untilMs 명시 시 withinHours 무시', () => {
    const history = [
      // 24시간 훨씬 전이지만 sinceMs/untilMs 범위 안.
      payment({ id: 'old', address: '주소A', ts: 100, items: [{ name: '칼국수', qty: 1 }] }),
    ];
    const r = computeDeliveryReturns({
      history,
      addressBook: book({}),
      storeCoord: STORE,
      sinceMs: 50,
      untilMs: 200,
      now: NOW,
    });
    expect(r.unknown).toHaveLength(1);
  });
});

describe('resortRanked — 마감 차수 정렬 토글', () => {
  test('원거리 우선', () => {
    const ranked = [
      { key: 'a', distanceM: 1000 },
      { key: 'b', distanceM: 3000 },
      { key: 'c', distanceM: 500 },
    ];
    const r = resortRanked(ranked, 'far');
    expect(r.map((x) => x.key)).toEqual(['b', 'a', 'c']);
    expect(r.map((x) => x.rank)).toEqual([1, 2, 3]);
  });

  test('근거리 우선', () => {
    const ranked = [
      { key: 'a', distanceM: 1000 },
      { key: 'b', distanceM: 3000 },
      { key: 'c', distanceM: 500 },
    ];
    const r = resortRanked(ranked, 'near');
    expect(r.map((x) => x.key)).toEqual(['c', 'a', 'b']);
  });

  test('distanceM null 은 항상 끝으로', () => {
    const ranked = [
      { key: 'a', distanceM: 1000 },
      { key: 'b', distanceM: null },
    ];
    const r = resortRanked(ranked, 'far');
    expect(r[0].key).toBe('a');
    expect(r[1].key).toBe('b');
  });

  test('null/빈 배열 안전', () => {
    expect(resortRanked(null, 'far')).toEqual([]);
    expect(resortRanked([], 'far')).toEqual([]);
  });
});

describe('getLastRoundCreatedAt', () => {
  test('빈 rounds → null', () => {
    expect(getLastRoundCreatedAt({}, '2026-05-15')).toBe(null);
    expect(getLastRoundCreatedAt(null, '2026-05-15')).toBe(null);
  });

  test('같은 날 차수 중 최대 createdAt', () => {
    const rounds = {
      a: { date: '2026-05-15', createdAt: 1000 },
      b: { date: '2026-05-15', createdAt: 3000 },
      c: { date: '2026-05-14', createdAt: 5000 },
    };
    expect(getLastRoundCreatedAt(rounds, '2026-05-15')).toBe(3000);
  });
});

describe('getNextRoundNo', () => {
  test('빈 rounds → 1', () => {
    expect(getNextRoundNo({}, '2026-05-15')).toBe(1);
  });

  test('같은 날 2개 있으면 3', () => {
    const rounds = {
      a: { date: '2026-05-15' },
      b: { date: '2026-05-15' },
    };
    expect(getNextRoundNo(rounds, '2026-05-15')).toBe(3);
  });

  test('다른 날 차수 무시', () => {
    const rounds = {
      a: { date: '2026-05-14' },
      b: { date: '2026-05-14' },
    };
    expect(getNextRoundNo(rounds, '2026-05-15')).toBe(1);
  });
});
