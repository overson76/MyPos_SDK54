import {
  optimizeRoute,
  formatRouteSummary,
  pairKey,
} from '../utils/routeOptimizer';

const STORE = { lat: 35.0, lng: 128.0 };

function stop(id, lat, lng) {
  return { id, lat, lng };
}

function makeFn(distMap, callsRef = { count: 0 }) {
  return async (from, to) => {
    callsRef.count += 1;
    return distMap.get(pairKey(from, to)) || null;
  };
}

describe('optimizeRoute — 빈 입력 / 엣지', () => {
  test('빈 stops → 빈 결과', async () => {
    const r = await optimizeRoute(STORE, [], async () => null);
    expect(r).toEqual({
      order: [],
      totalDistanceM: 0,
      totalDurationSec: 0,
      missing: 0,
    });
  });

  test('null origin → 빈 결과', async () => {
    const r = await optimizeRoute(null, [stop('a', 35, 128)], async () => null);
    expect(r.order).toEqual([]);
  });

  test('getDistanceFn 미제공 → stops 그대로 + missing = stops.length', async () => {
    const stops = [stop('a', 35, 128), stop('b', 35.1, 128)];
    const r = await optimizeRoute(STORE, stops, null);
    expect(r.order).toEqual(stops);
    expect(r.missing).toBe(2);
  });
});

describe('optimizeRoute — 그리디 정렬', () => {
  test('stops 1개 — 매장→1 거리', async () => {
    const s = stop('a', 35.01, 128);
    const map = new Map([
      [pairKey(STORE, s), { distanceM: 500, durationSec: 90 }],
    ]);
    const r = await optimizeRoute(STORE, [s], makeFn(map));
    expect(r.order).toEqual([s]);
    expect(r.totalDistanceM).toBe(500);
    expect(r.totalDurationSec).toBe(90);
    expect(r.missing).toBe(0);
  });

  test('stops 2개 — 가까운 곳 먼저', async () => {
    const a = stop('a', 35.02, 128);
    const b = stop('b', 35.01, 128);
    const map = new Map([
      [pairKey(STORE, a), { distanceM: 2000, durationSec: 300 }],
      [pairKey(STORE, b), { distanceM: 1000, durationSec: 180 }],
      [pairKey(b, a), { distanceM: 1500, durationSec: 250 }],
    ]);
    const r = await optimizeRoute(STORE, [a, b], makeFn(map));
    expect(r.order.map((s) => s.id)).toEqual(['b', 'a']);
    expect(r.totalDistanceM).toBe(2500); // 매장→b(1000) + b→a(1500)
    expect(r.totalDurationSec).toBe(430);
  });

  test('stops 3개 — 입력 순서 무관하게 그리디 정렬', async () => {
    const a = stop('a', 35.01, 128);
    const b = stop('b', 35.02, 128);
    const c = stop('c', 35.03, 128);
    const map = new Map([
      [pairKey(STORE, a), { distanceM: 500, durationSec: 60 }],
      [pairKey(STORE, b), { distanceM: 1000, durationSec: 120 }],
      [pairKey(STORE, c), { distanceM: 2000, durationSec: 240 }],
      [pairKey(a, b), { distanceM: 600, durationSec: 90 }],
      [pairKey(a, c), { distanceM: 1500, durationSec: 200 }],
      [pairKey(b, c), { distanceM: 700, durationSec: 100 }],
    ]);
    const r = await optimizeRoute(STORE, [c, a, b], makeFn(map));
    expect(r.order.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(r.totalDistanceM).toBe(1800); // 500 + 600 + 700
    expect(r.totalDurationSec).toBe(250);
  });
});

describe('optimizeRoute — 캐싱', () => {
  test('같은 페어 두 번 호출 X', async () => {
    const a = stop('a', 35.01, 128);
    const b = stop('b', 35.02, 128);
    const map = new Map([
      [pairKey(STORE, a), { distanceM: 500 }],
      [pairKey(STORE, b), { distanceM: 1000 }],
      [pairKey(a, b), { distanceM: 600 }],
    ]);
    const calls = { count: 0 };
    await optimizeRoute(STORE, [a, b], makeFn(map, calls));
    // 1라운드: 매장→a, 매장→b = 2 호출
    // 2라운드: a→b = 1 호출 (매장→b 결과는 캐시되어 있지만 재사용 X — 다른 페어이므로)
    // 캐시 없으면 매장→b 가 한 번 더 호출되어야 — 캐시 있어서 안 일어남
    expect(calls.count).toBe(3);
  });
});

describe('optimizeRoute — 실패 처리', () => {
  test('일부 실패 — 성공한 거 먼저, 실패는 끝에 + missing 카운트', async () => {
    const a = stop('a', 35.01, 128);
    const b = stop('b', 35.02, 128);
    const c = stop('c', 35.03, 128);
    const map = new Map([
      [pairKey(STORE, a), { distanceM: 500 }],
      [pairKey(STORE, b), { distanceM: 1000 }],
      [pairKey(a, b), { distanceM: 600 }],
      // STORE→c, a→c, b→c 모두 미정의 → null 반환
    ]);
    const r = await optimizeRoute(STORE, [a, b, c], makeFn(map));
    expect(r.order.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(r.missing).toBe(1);
  });

  test('모두 실패 → 입력 순서 보존, missing = stops.length', async () => {
    const a = stop('a', 35.01, 128);
    const b = stop('b', 35.02, 128);
    const r = await optimizeRoute(STORE, [a, b], async () => null);
    expect(r.order.map((s) => s.id)).toEqual(['a', 'b']);
    expect(r.missing).toBe(2);
    expect(r.totalDistanceM).toBe(0);
  });

  test('getDistanceFn throw — 안전 (null 처리)', async () => {
    const a = stop('a', 35.01, 128);
    const fn = async () => {
      throw new Error('network');
    };
    const r = await optimizeRoute(STORE, [a], fn);
    expect(r.missing).toBe(1);
    expect(r.order).toEqual([a]);
  });
});

describe('optimizeRoute — durationSec 처리', () => {
  test('durationSec null 안전', async () => {
    const a = stop('a', 35.01, 128);
    const map = new Map([
      [pairKey(STORE, a), { distanceM: 500, durationSec: null }],
    ]);
    const r = await optimizeRoute(STORE, [a], makeFn(map));
    expect(r.totalDurationSec).toBe(0);
  });
});

describe('formatRouteSummary', () => {
  test('1km 미만 → m 단위', () => {
    expect(formatRouteSummary(500, 0)).toBe('500 m');
  });

  test('1km 이상 10km 미만 → 소수 1자리 km', () => {
    expect(formatRouteSummary(1500, 0)).toBe('1.5 km');
  });

  test('10km 이상 → 정수 km', () => {
    expect(formatRouteSummary(12700, 0)).toBe('13 km');
  });

  test('시간 포함', () => {
    expect(formatRouteSummary(2000, 600)).toBe('2.0 km · 예상 10분');
  });

  test('null 안전', () => {
    expect(formatRouteSummary(null, null)).toBe('0 m');
  });
});

describe('pairKey', () => {
  test('좌표 정확히 인코딩', () => {
    expect(pairKey({ lat: 35.1, lng: 128.2 }, { lat: 35.3, lng: 128.4 })).toBe(
      '35.1,128.2|35.3,128.4'
    );
  });

  test('방향성 유지 — A→B와 B→A 다른 키 (일방통행 등 비대칭 도로 대응)', () => {
    const a = { lat: 35.1, lng: 128.2 };
    const b = { lat: 35.3, lng: 128.4 };
    expect(pairKey(a, b)).not.toBe(pairKey(b, a));
  });
});
