// 회수 차수 returnedAt 상태 변환 — 사장님 의도(라이더가 빼먹는 사고 방지) 핵심 로직.

import {
  toggleEntryReturned,
  fillAllReturned,
  clearAllReturned,
  getRoundReturnProgress,
} from '../utils/returnsState';

function makeRound() {
  return {
    id: '2026-05-15-r1',
    date: '2026-05-15',
    roundNo: 1,
    createdAt: 1715760000000,
    sortMode: 'far',
    snapshot: {
      ranked: [
        { key: 'A', label: '동래구 A', rank: 1, returnedAt: null },
        { key: 'B', label: '동래구 B', rank: 2, returnedAt: null },
        { key: 'C', label: '동래구 C', rank: 3, returnedAt: null },
      ],
      unknown: [{ key: 'U1', label: '주소불명1', returnedAt: null }],
    },
  };
}

describe('toggleEntryReturned', () => {
  test('미회수 → 회수 (timestamp 박힘)', () => {
    const r = makeRound();
    const updated = toggleEntryReturned(r, 'B');
    const b = updated.snapshot.ranked.find((it) => it.key === 'B');
    expect(typeof b.returnedAt).toBe('number');
    expect(b.returnedAt).toBeGreaterThan(0);
  });

  test('회수 → 미회수 (null 로 되돌림)', () => {
    const r = makeRound();
    r.snapshot.ranked[0].returnedAt = 1234567890;
    const updated = toggleEntryReturned(r, 'A');
    expect(updated.snapshot.ranked[0].returnedAt).toBeNull();
  });

  test('value=true 강제 회수', () => {
    const r = makeRound();
    const updated = toggleEntryReturned(r, 'C', true);
    expect(typeof updated.snapshot.ranked[2].returnedAt).toBe('number');
  });

  test('value=false 강제 해제', () => {
    const r = makeRound();
    r.snapshot.ranked[0].returnedAt = 1234567890;
    const updated = toggleEntryReturned(r, 'A', false);
    expect(updated.snapshot.ranked[0].returnedAt).toBeNull();
  });

  test('unknown entry 도 토글 가능', () => {
    const r = makeRound();
    const updated = toggleEntryReturned(r, 'U1');
    expect(typeof updated.snapshot.unknown[0].returnedAt).toBe('number');
  });

  test('존재하지 않는 key — 변경 없음', () => {
    const r = makeRound();
    const updated = toggleEntryReturned(r, 'ZZ');
    expect(updated.snapshot.ranked.every((it) => it.returnedAt === null)).toBe(true);
    expect(updated.snapshot.unknown.every((it) => it.returnedAt === null)).toBe(true);
  });

  test('null round — 그대로 반환', () => {
    expect(toggleEntryReturned(null, 'A')).toBeNull();
    expect(toggleEntryReturned({}, 'A')).toEqual({});
  });

  test('원본 round 는 mutate 안 됨 (immutability)', () => {
    const r = makeRound();
    const before = JSON.stringify(r);
    toggleEntryReturned(r, 'A');
    expect(JSON.stringify(r)).toBe(before);
  });
});

describe('fillAllReturned', () => {
  test('전부 미회수 → 전부 회수', () => {
    const r = makeRound();
    const updated = fillAllReturned(r, 9999);
    expect(updated.snapshot.ranked.every((it) => it.returnedAt === 9999)).toBe(true);
    expect(updated.snapshot.unknown[0].returnedAt).toBe(9999);
  });

  test('이미 회수된 entry 의 timestamp 는 유지 (되돌리기 방지)', () => {
    const r = makeRound();
    r.snapshot.ranked[0].returnedAt = 1234567890;
    const updated = fillAllReturned(r, 9999);
    expect(updated.snapshot.ranked[0].returnedAt).toBe(1234567890);
    expect(updated.snapshot.ranked[1].returnedAt).toBe(9999);
  });

  test('ts 생략 시 Date.now() 사용', () => {
    const r = makeRound();
    const before = Date.now();
    const updated = fillAllReturned(r);
    const ts = updated.snapshot.ranked[0].returnedAt;
    expect(ts).toBeGreaterThanOrEqual(before);
  });
});

describe('clearAllReturned', () => {
  test('전부 회수 → 전부 미회수', () => {
    const r = makeRound();
    r.snapshot.ranked.forEach((it) => (it.returnedAt = 1234));
    r.snapshot.unknown[0].returnedAt = 1234;
    const updated = clearAllReturned(r);
    expect(updated.snapshot.ranked.every((it) => it.returnedAt === null)).toBe(true);
    expect(updated.snapshot.unknown[0].returnedAt).toBeNull();
  });
});

describe('getRoundReturnProgress', () => {
  test('전부 미회수 — done=0', () => {
    const r = makeRound();
    expect(getRoundReturnProgress(r)).toEqual({ done: 0, total: 4, complete: false });
  });

  test('일부 회수', () => {
    const r = makeRound();
    r.snapshot.ranked[0].returnedAt = 1;
    r.snapshot.ranked[1].returnedAt = 2;
    expect(getRoundReturnProgress(r)).toEqual({ done: 2, total: 4, complete: false });
  });

  test('전부 회수 → complete=true', () => {
    const r = makeRound();
    r.snapshot.ranked.forEach((it) => (it.returnedAt = 1));
    r.snapshot.unknown[0].returnedAt = 1;
    expect(getRoundReturnProgress(r)).toEqual({ done: 4, total: 4, complete: true });
  });

  test('snapshot 없음 — 안전', () => {
    expect(getRoundReturnProgress(null)).toEqual({ done: 0, total: 0, complete: false });
    expect(getRoundReturnProgress({})).toEqual({ done: 0, total: 0, complete: false });
    expect(getRoundReturnProgress({ snapshot: {} })).toEqual({
      done: 0,
      total: 0,
      complete: false,
    });
  });

  test('빈 차수 — total=0 이면 complete=false (회수할 게 없는데 완료라고 안 함)', () => {
    const r = { snapshot: { ranked: [], unknown: [] } };
    expect(getRoundReturnProgress(r)).toEqual({ done: 0, total: 0, complete: false });
  });

  test('unknown 만 있는 경우도 정상 집계', () => {
    const r = {
      snapshot: {
        ranked: [],
        unknown: [
          { key: 'U1', returnedAt: 1 },
          { key: 'U2', returnedAt: null },
        ],
      },
    };
    expect(getRoundReturnProgress(r)).toEqual({ done: 1, total: 2, complete: false });
  });
});
