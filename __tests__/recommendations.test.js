import {
  computeRecommendations,
  recommendationsToGrid,
  RECOMMENDATION_CATEGORY,
} from '../utils/recommendations';

// 헬퍼 — history entry 빌더 (실제 buildHistoryEntry 모양과 동일)
function entry({ ts, items, deliveryAddress = '', reverted = false }) {
  return {
    id: `e-${ts}`,
    tableId: 'd1',
    items: items.map((i) => ({ ...i })),
    deliveryAddress,
    paymentMethod: 'cash',
    total: 0,
    clearedAt: ts,
    reverted,
  };
}

const MENUS = [
  { id: 1, name: '칼국수', price: 9000 },
  { id: 2, name: '부대찌개', price: 11000 },
  { id: 3, name: '비빔밥', price: 9000 },
  { id: 4, name: '단종메뉴', price: 8000 }, // 카탈로그에는 있지만 history 에 없음
];

// 기준 시각 — 2026-05-15 (금요일) 12:00 (점심 시간대)
const NOW = new Date(2026, 4, 15, 12, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

describe('computeRecommendations — 빈 입력 안전', () => {
  test('빈 history → 빈 결과', () => {
    expect(computeRecommendations({ history: [], menus: MENUS, now: NOW })).toEqual([]);
  });

  test('빈 menus → 빈 결과', () => {
    const history = [entry({ ts: NOW - DAY, items: [{ name: '칼국수', qty: 1 }] })];
    expect(computeRecommendations({ history, menus: [], now: NOW })).toEqual([]);
  });

  test('null/undefined 입력 안전', () => {
    expect(computeRecommendations({ history: null, menus: MENUS, now: NOW })).toEqual([]);
    expect(computeRecommendations({ history: [], menus: undefined, now: NOW })).toEqual([]);
    expect(computeRecommendations()).toEqual([]);
  });
});

describe('computeRecommendations — 점수 계산', () => {
  test('인기도만 — 시간대/단골 매칭 없을 때 qty 합계 순', () => {
    // 둘 다 시간대 외(자정) — 인기도만 작동
    const midnight = new Date(2026, 4, 14, 0, 0).getTime();
    const history = [
      entry({ ts: midnight, items: [{ name: '칼국수', qty: 1 }] }),
      entry({ ts: midnight, items: [{ name: '부대찌개', qty: 3 }] }),
    ];
    const result = computeRecommendations({ history, menus: MENUS, now: NOW });
    expect(result[0].name).toBe('부대찌개');
    expect(result[0].score).toBe(3); // 3 * W_POPULAR
    expect(result[1].name).toBe('칼국수');
    expect(result[1].score).toBe(1);
  });

  test('시간대 매칭이 인기도를 역전 — 가중치 W_TIME=3', () => {
    // 칼국수 qty=2 점심대 매칭 → 2 + 6 = 8
    // 부대찌개 qty=5 저녁대 (시간대 X) → 5
    const lunch = new Date(2026, 4, 14, 12, 30).getTime();
    const dinner = new Date(2026, 4, 14, 18, 0).getTime();
    const history = [
      entry({ ts: lunch, items: [{ name: '칼국수', qty: 2 }] }),
      entry({ ts: dinner, items: [{ name: '부대찌개', qty: 5 }] }),
    ];
    const result = computeRecommendations({ history, menus: MENUS, now: NOW });
    expect(result[0].name).toBe('칼국수');
    expect(result[0].score).toBe(8);
    expect(result[1].name).toBe('부대찌개');
    expect(result[1].score).toBe(5);
  });

  test('단골 매칭 — 같은 배달주소에서 시킨 메뉴 우대 (W_REGULAR=5)', () => {
    const lunch = new Date(2026, 4, 14, 12, 30).getTime();
    const history = [
      // 우리 손님 (서울 강남) — 비빔밥 1개. 시간대 + 단골 매칭.
      // 점수 = 1 + 3(시간) + 5(단골) = 9
      entry({
        ts: lunch,
        items: [{ name: '비빔밥', qty: 1 }],
        deliveryAddress: '서울 강남 123',
      }),
      // 다른 손님 — 칼국수 2개. 시간대만 매칭.
      // 점수 = 2 + 6 = 8
      entry({
        ts: lunch,
        items: [{ name: '칼국수', qty: 2 }],
        deliveryAddress: '서울 종로 456',
      }),
    ];
    const result = computeRecommendations({
      history,
      menus: MENUS,
      now: NOW,
      customerAddressKey: '서울 강남 123',
    });
    expect(result[0].name).toBe('비빔밥');
    expect(result[0].score).toBe(9);
    expect(result[1].name).toBe('칼국수');
    expect(result[1].score).toBe(8);
  });

  test('단골 매칭 — 주소 키 정규화 (대소문자/공백)', () => {
    const lunch = new Date(2026, 4, 14, 12, 30).getTime();
    const history = [
      entry({
        ts: lunch,
        items: [{ name: '비빔밥', qty: 1 }],
        deliveryAddress: '  Seoul   Gangnam  123 ',
      }),
    ];
    const result = computeRecommendations({
      history,
      menus: MENUS,
      now: NOW,
      customerAddressKey: 'seoul GANGNAM 123',
    });
    expect(result[0].name).toBe('비빔밥');
    expect(result[0].score).toBe(9); // 1 + 3 + 5
  });

  test('qty + largeQty 합산', () => {
    const lunch = new Date(2026, 4, 14, 12, 30).getTime();
    const history = [
      // 보통 1 + 대 2 = qty 합 3 → 점수 = 3 + 9 = 12
      entry({ ts: lunch, items: [{ name: '칼국수', qty: 1, largeQty: 2 }] }),
    ];
    const result = computeRecommendations({ history, menus: MENUS, now: NOW });
    expect(result[0].score).toBe(12);
  });
});

describe('computeRecommendations — 제외 정책', () => {
  test('reverted entry 제외', () => {
    const lunch = new Date(2026, 4, 14, 12, 30).getTime();
    const history = [
      entry({
        ts: lunch,
        items: [{ name: '칼국수', qty: 100 }],
        reverted: true,
      }),
      entry({ ts: lunch, items: [{ name: '부대찌개', qty: 1 }] }),
    ];
    const result = computeRecommendations({ history, menus: MENUS, now: NOW });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('부대찌개');
  });

  test('30일 초과 entry 제외', () => {
    const old = NOW - 31 * DAY;
    const recent = NOW - DAY;
    const history = [
      entry({ ts: old, items: [{ name: '칼국수', qty: 50 }] }),
      entry({ ts: recent, items: [{ name: '부대찌개', qty: 1 }] }),
    ];
    const result = computeRecommendations({ history, menus: MENUS, now: NOW });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('부대찌개');
  });

  test('미래 timestamp 무시 (시계 어긋남 방어)', () => {
    const future = NOW + DAY;
    const history = [
      entry({ ts: future, items: [{ name: '칼국수', qty: 99 }] }),
    ];
    expect(computeRecommendations({ history, menus: MENUS, now: NOW })).toEqual([]);
  });

  test('clearedAt 없는 entry 무시', () => {
    const history = [
      { id: 'x', items: [{ name: '칼국수', qty: 5 }] }, // ts 없음
    ];
    expect(computeRecommendations({ history, menus: MENUS, now: NOW })).toEqual([]);
  });

  test('items 비어있는 entry 무시', () => {
    const history = [entry({ ts: NOW - DAY, items: [] })];
    expect(computeRecommendations({ history, menus: MENUS, now: NOW })).toEqual([]);
  });

  test('카탈로그에 없는 메뉴 이름 제외 (이름 변경 / 삭제된 메뉴)', () => {
    const history = [
      entry({
        ts: NOW - DAY,
        items: [
          { name: '없어진메뉴', qty: 99 },
          { name: '칼국수', qty: 1 },
        ],
      }),
    ];
    const result = computeRecommendations({ history, menus: MENUS, now: NOW });
    expect(result.map((r) => r.name)).toEqual(['칼국수']);
  });

  test('qty 0/음수 항목 제외', () => {
    const history = [
      entry({
        ts: NOW - DAY,
        items: [
          { name: '칼국수', qty: 0 },
          { name: '부대찌개', qty: -1 },
          { name: '비빔밥', qty: 2 },
        ],
      }),
    ];
    const result = computeRecommendations({ history, menus: MENUS, now: NOW });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('비빔밥');
  });
});

describe('computeRecommendations — 시간대 윈도우', () => {
  test('±2시간 기본 윈도우 — 점심 12시 ± 2 = 10시~14시', () => {
    const ten = new Date(2026, 4, 14, 10, 0).getTime(); // 경계
    const fourteen = new Date(2026, 4, 14, 14, 0).getTime(); // 경계
    const nine = new Date(2026, 4, 14, 9, 0).getTime(); // 밖

    const history = [
      entry({ ts: ten, items: [{ name: '칼국수', qty: 1 }] }),
      entry({ ts: fourteen, items: [{ name: '부대찌개', qty: 1 }] }),
      entry({ ts: nine, items: [{ name: '비빔밥', qty: 1 }] }),
    ];
    const result = computeRecommendations({ history, menus: MENUS, now: NOW });
    // 칼국수 + 부대찌개: 시간대 매칭 → 점수 4 (1 + 3)
    // 비빔밥: 시간대 외 → 점수 1
    expect(result.find((r) => r.name === '칼국수').score).toBe(4);
    expect(result.find((r) => r.name === '부대찌개').score).toBe(4);
    expect(result.find((r) => r.name === '비빔밥').score).toBe(1);
  });

  test('24시간 순환 — 자정 시계는 23시/1시 모두 ±2 윈도우 안', () => {
    const midnight = new Date(2026, 4, 15, 0, 0).getTime();
    const at23 = new Date(2026, 4, 14, 23, 0).getTime();
    const at1 = new Date(2026, 4, 14, 1, 0).getTime();

    const history = [
      entry({ ts: at23, items: [{ name: '칼국수', qty: 1 }] }),
      entry({ ts: at1, items: [{ name: '부대찌개', qty: 1 }] }),
    ];
    const result = computeRecommendations({ history, menus: MENUS, now: midnight });
    expect(result.find((r) => r.name === '칼국수').score).toBe(4);
    expect(result.find((r) => r.name === '부대찌개').score).toBe(4);
  });

  test('timeWindowHours 커스텀 가능', () => {
    const at8 = new Date(2026, 4, 14, 8, 0).getTime();
    const history = [
      entry({ ts: at8, items: [{ name: '칼국수', qty: 1 }] }),
    ];
    // 기본 윈도우 ±2 → 12시-8시 = 4시간 차이, 시간대 외 → 점수 1
    const def = computeRecommendations({ history, menus: MENUS, now: NOW });
    expect(def[0].score).toBe(1);
    // 윈도우 ±4 → 4시간 차이, 시간대 내 → 점수 4
    const wide = computeRecommendations({
      history,
      menus: MENUS,
      now: NOW,
      timeWindowHours: 4,
    });
    expect(wide[0].score).toBe(4);
  });
});

describe('computeRecommendations — topN 제한', () => {
  test('topN=2 → 점수 상위 2개만', () => {
    const ts = NOW - DAY;
    const history = [
      entry({ ts, items: [{ name: '칼국수', qty: 1 }] }),
      entry({ ts, items: [{ name: '부대찌개', qty: 2 }] }),
      entry({ ts, items: [{ name: '비빔밥', qty: 3 }] }),
    ];
    const result = computeRecommendations({ history, menus: MENUS, now: NOW, topN: 2 });
    expect(result).toHaveLength(2);
  });
});

describe('recommendationsToGrid', () => {
  test('6×4 격자 변환 + 부족분 null', () => {
    const recs = [
      { id: 1, name: 'a', score: 10 },
      { id: 2, name: 'b', score: 8 },
      { id: 3, name: 'c', score: 5 },
    ];
    const grid = recommendationsToGrid(recs);
    expect(grid).toHaveLength(4);
    expect(grid[0]).toHaveLength(6);
    expect(grid[0][0]).toBe(1);
    expect(grid[0][1]).toBe(2);
    expect(grid[0][2]).toBe(3);
    expect(grid[0][3]).toBeNull();
    expect(grid[3][5]).toBeNull();
  });

  test('초과분 잘림', () => {
    const recs = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      name: `m${i}`,
      score: 100 - i,
    }));
    const grid = recommendationsToGrid(recs);
    const flat = [].concat(...grid);
    expect(flat).toHaveLength(24); // 6×4 = 24
    expect(flat[23]).toBe(24);
  });

  test('커스텀 격자 크기', () => {
    const recs = [{ id: 9, name: 'x', score: 1 }];
    const grid = recommendationsToGrid(recs, 3, 2);
    expect(grid).toHaveLength(2);
    expect(grid[0]).toHaveLength(3);
    expect(grid[0][0]).toBe(9);
  });

  test('null/undefined 입력 안전', () => {
    expect(recommendationsToGrid(null)).toHaveLength(4);
    expect(recommendationsToGrid(undefined)[0][0]).toBeNull();
  });
});

describe('상수 export', () => {
  test('카테고리 이름 상수', () => {
    expect(typeof RECOMMENDATION_CATEGORY).toBe('string');
    expect(RECOMMENDATION_CATEGORY).toContain('추천');
  });
});
