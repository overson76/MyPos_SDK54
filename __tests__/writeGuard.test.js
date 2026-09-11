// writeGuard — Firestore 쓰기 폭주 차단기.
//
// 2026-09-11 사고 검증: 원인(참조 비교 루프)은 따로 고쳤지만, 원인은 매번 다른
// 모습으로 온다(6/10 union 배열, 9/11 참조 비교). 그래서 **원인과 무관하게**
// 비정상 쓰기량 자체를 끊는 게 이 모듈의 역할이다.
//   - 정상 영업량(분당 수십)은 절대 막지 않는다
//   - 루프(분당 수백~수천)는 확실히 끊는다
//   - 일일 상한은 무료 한도(2만)의 절반 — 걸려도 그날 영업은 살아있다

import {
  canWrite,
  noteWrites,
  getWriteStats,
  resetWriteGuard,
  subscribeWriteStats,
  PER_MINUTE_LIMIT,
  PER_DAY_LIMIT,
  __resetWriteGuardForTest,
} from '../utils/writeGuard';

jest.mock('../utils/sentry', () => ({ reportError: jest.fn(), addBreadcrumb: jest.fn() }));
jest.mock('../utils/persistence', () => ({
  loadJSON: jest.fn(async (_k, d) => d),
  saveJSON: jest.fn(async () => {}),
}));

const T0 = 1757000000000;

beforeEach(() => __resetWriteGuardForTest());

describe('정상 영업은 막지 않는다', () => {
  test('분당 수십 건은 전부 통과', () => {
    for (let i = 0; i < 60; i++) {
      expect(canWrite(1, T0 + i * 500)).toBe(true);
      noteWrites(1, T0 + i * 500);
    }
    expect(getWriteStats().tripped).toBe(null);
    expect(getWriteStats().perMinute).toBe(60);
  });

  test('한 배치에 여러 건이어도 상한 안이면 통과', () => {
    expect(canWrite(25, T0)).toBe(true);
    noteWrites(25, T0);
    expect(getWriteStats().today).toBe(25);
  });
});

describe('분당 폭주는 끊는다', () => {
  test('상한을 넘기는 순간 false + tripped=minute', () => {
    noteWrites(PER_MINUTE_LIMIT, T0);
    expect(canWrite(1, T0 + 1000)).toBe(false);
    expect(getWriteStats().tripped).toBe('minute');
  });

  test('끊긴 뒤에는 작은 요청도 계속 거부', () => {
    noteWrites(PER_MINUTE_LIMIT, T0);
    canWrite(1, T0 + 1000);
    expect(canWrite(1, T0 + 2000)).toBe(false);
    expect(canWrite(1, T0 + 30000)).toBe(false);
  });

  test('1분이 지나면 스스로 풀린다 (일시적 폭주는 자동 회복)', () => {
    noteWrites(PER_MINUTE_LIMIT, T0);
    expect(canWrite(1, T0 + 1000)).toBe(false);
    expect(canWrite(1, T0 + 61000)).toBe(true);
    expect(getWriteStats().tripped).toBe(null);
  });

  // 교착 방지: 상한보다 큰 "정상 배치" 하나는 통과시켜야 한다.
  // 4시 한도 리셋 직후처럼 밀린 변경을 한꺼번에 밀어낼 때, 이걸 막으면
  // 배치가 상한보다 큰 순간 영원히 못 보내고 동기화가 멈춰버린다.
  test('창이 비어 있으면 상한보다 큰 배치 하나는 통과 (밀린 변경 일괄 push)', () => {
    expect(canWrite(PER_MINUTE_LIMIT + 500, T0)).toBe(true);
  });

  test('그 큰 배치를 보내고 나면 1분간 추가 쓰기는 막힌다', () => {
    const big = PER_MINUTE_LIMIT + 500;
    expect(canWrite(big, T0)).toBe(true);
    noteWrites(big, T0);
    expect(canWrite(1, T0 + 1000)).toBe(false);
    expect(getWriteStats().tripped).toBe('minute');
  });

  test('창을 이미 쓴 뒤라면 큰 배치도 예외 없이 막는다', () => {
    noteWrites(10, T0);
    expect(canWrite(PER_MINUTE_LIMIT + 500, T0 + 1000)).toBe(false);
  });

  test('큰 배치 예외도 일일 상한은 못 넘는다', () => {
    let t = T0;
    let sent = 0;
    while (sent < PER_DAY_LIMIT - 100) {
      const n = Math.min(PER_MINUTE_LIMIT, PER_DAY_LIMIT - 100 - sent);
      canWrite(n, t);
      noteWrites(n, t);
      sent += n;
      t += 61000;
    }
    // 창은 비었지만 일일 잔여(100)보다 큰 배치 → 거부
    expect(canWrite(500, t + 61000)).toBe(false);
  });
});

describe('일일 상한 — 무료 한도에 닿기 전에 멈춘다', () => {
  test('하루 상한을 넘기면 tripped=day', () => {
    // 1분씩 건너뛰며 분당 상한은 피하고 일일만 채운다.
    let t = T0;
    let sent = 0;
    while (sent < PER_DAY_LIMIT) {
      const n = Math.min(PER_MINUTE_LIMIT, PER_DAY_LIMIT - sent);
      canWrite(n, t);
      noteWrites(n, t);
      sent += n;
      t += 61000;
    }
    expect(getWriteStats().today).toBe(PER_DAY_LIMIT);
    expect(canWrite(1, t)).toBe(false);
    expect(getWriteStats().tripped).toBe('day');
  });

  // 상한은 기기마다 따로 세는데 서버 한도(2만)는 매장 전체가 공유한다.
  // 기기 여러 대가 각자 상한까지 써도 합계가 서버 한도를 넘으면 안 된다.
  test('기기 5대가 각자 상한까지 써도 서버 한도 2만을 안 넘는다', () => {
    const FIRESTORE_DAILY_WRITE_QUOTA = 20000;
    const MAX_DEVICES = 5;
    expect(PER_DAY_LIMIT * MAX_DEVICES).toBeLessThanOrEqual(FIRESTORE_DAILY_WRITE_QUOTA);
  });

  test('그래도 정상 영업량(기기당 하루 1천 건대)보다는 넉넉하다', () => {
    expect(PER_DAY_LIMIT).toBeGreaterThanOrEqual(3000);
  });

  test('날짜가 바뀌면 일일 카운터가 리셋된다', () => {
    noteWrites(100, T0);
    expect(getWriteStats().today).toBe(100);
    const nextDay = T0 + 24 * 60 * 60 * 1000;
    canWrite(1, nextDay);
    expect(getWriteStats().today).toBe(0);
  });
});

describe('수동 해제 / 구독', () => {
  test('resetWriteGuard 로 즉시 풀 수 있다 (원인 고친 뒤)', () => {
    noteWrites(PER_MINUTE_LIMIT, T0);
    expect(canWrite(1, T0 + 1000)).toBe(false);
    resetWriteGuard(T0 + 1000);
    expect(getWriteStats().tripped).toBe(null);
    expect(canWrite(1, T0 + 1000)).toBe(true);
  });

  test('구독자는 차단/기록 시 통지받는다', () => {
    const seen = [];
    const unsub = subscribeWriteStats((s) => seen.push(s.tripped));
    noteWrites(10, T0);
    expect(seen.length).toBeGreaterThan(0);
    unsub();
    const before = seen.length;
    noteWrites(10, T0);
    expect(seen.length).toBe(before);
  });
});

describe('9/11 사고 시나리오 — 자가증식 루프', () => {
  test('300ms 마다 5건씩 쓰는 루프는 1분 안에 끊긴다 (2만까지 안 간다)', () => {
    let t = T0;
    let sent = 0;
    let blockedAt = null;
    for (let i = 0; i < 2000; i++) {
      if (!canWrite(5, t)) {
        blockedAt = sent;
        break;
      }
      noteWrites(5, t);
      sent += 5;
      t += 300;
    }
    expect(blockedAt).not.toBeNull();
    // 무료 한도 2만 근처까지 가기 전에 멈춰야 한다.
    expect(blockedAt).toBeLessThan(1000);
  });
});
