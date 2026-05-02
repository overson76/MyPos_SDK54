import { distanceKm, formatDistance } from '../utils/geocode';

describe('distanceKm — 하버사인 직선거리', () => {
  test('두 점이 같으면 0', () => {
    const p = { lat: 37.5, lng: 127.0 };
    expect(distanceKm(p, p)).toBeCloseTo(0, 6);
  });

  test('서울시청 ↔ 강남파이낸스센터 ≈ 8.6km (실측 도로 직선)', () => {
    const seoulCity = { lat: 37.56682, lng: 126.97865 };
    const gangnamFC = { lat: 37.50002, lng: 127.03651 };
    const km = distanceKm(seoulCity, gangnamFC);
    expect(km).toBeGreaterThan(8.0);
    expect(km).toBeLessThan(9.5);
  });

  test('대칭성 — A→B 와 B→A 동일', () => {
    const a = { lat: 37.5, lng: 127.0 };
    const b = { lat: 35.1, lng: 129.0 };
    expect(distanceKm(a, b)).toBeCloseTo(distanceKm(b, a), 9);
  });

  test('null/undefined/잘못된 좌표는 null', () => {
    expect(distanceKm(null, { lat: 37, lng: 127 })).toBeNull();
    expect(distanceKm({ lat: 37, lng: 127 }, null)).toBeNull();
    expect(distanceKm({}, {})).toBeNull();
    expect(distanceKm({ lat: 'x', lng: 127 }, { lat: 37, lng: 127 })).toBeNull();
    expect(distanceKm({ lat: 91, lng: 127 }, { lat: 37, lng: 127 })).toBeNull(); // 위도 범위 초과
    expect(distanceKm({ lat: 37, lng: 181 }, { lat: 37, lng: 127 })).toBeNull(); // 경도 범위 초과
    expect(distanceKm({ lat: NaN, lng: 127 }, { lat: 37, lng: 127 })).toBeNull();
  });

  test('서울 ↔ 부산 직선거리 ≈ 325km', () => {
    const seoul = { lat: 37.566, lng: 126.978 };
    const busan = { lat: 35.179, lng: 129.075 };
    const km = distanceKm(seoul, busan);
    expect(km).toBeGreaterThan(320);
    expect(km).toBeLessThan(330);
  });
});

describe('formatDistance — 사람 읽기 좋은 포맷', () => {
  test('1km 미만은 m 단위로 반올림', () => {
    expect(formatDistance(0.4)).toBe('400 m');
    expect(formatDistance(0.05)).toBe('50 m');
    expect(formatDistance(0)).toBe('0 m');
  });

  test('1~10km 는 소수 1자리 km', () => {
    expect(formatDistance(1)).toBe('1.0 km');
    expect(formatDistance(2.34)).toBe('2.3 km');
    expect(formatDistance(9.99)).toBe('10.0 km');
  });

  test('10km 이상은 정수 km', () => {
    expect(formatDistance(10)).toBe('10 km');
    expect(formatDistance(12.4)).toBe('12 km');
    expect(formatDistance(325.7)).toBe('326 km');
  });

  test('잘못된 입력은 null', () => {
    expect(formatDistance(null)).toBeNull();
    expect(formatDistance(undefined)).toBeNull();
    expect(formatDistance('1.2')).toBeNull();
    expect(formatDistance(NaN)).toBeNull();
    expect(formatDistance(-1)).toBeNull();
    expect(formatDistance(Infinity)).toBeNull();
  });
});
