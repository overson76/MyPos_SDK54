// cloudHealth — 클라우드 쓰기 실패 상태 싱글톤.
// 2026-06-11 무료 한도 차단 사고 후속: 실패 가시화 + 성공 시 자동 해제 검증.

import {
  describeCloudError,
  getCloudHealth,
  reportWriteFailure,
  reportWriteSuccess,
  subscribeCloudHealth,
} from '../utils/cloudHealth';

describe('cloudHealth', () => {
  beforeEach(() => {
    // 모듈 싱글톤 — 각 테스트 전 정상 상태로 리셋.
    reportWriteSuccess();
  });

  test('초기 상태는 정상(failing=false)', () => {
    expect(getCloudHealth().failing).toBe(false);
    expect(getCloudHealth().count).toBe(0);
  });

  test('실패 보고 시 failing + ctx + code + count=1', () => {
    reportWriteFailure('addresses.batch.write', { code: 'resource-exhausted' });
    const s = getCloudHealth();
    expect(s.failing).toBe(true);
    expect(s.ctx).toBe('addresses.batch.write');
    expect(s.code).toBe('resource-exhausted');
    expect(s.count).toBe(1);
    expect(typeof s.since).toBe('number');
  });

  test('연속 실패는 count 누적 + since 는 첫 실패 시각 유지', () => {
    reportWriteFailure('orders.batch.write', { code: 'unavailable' });
    const first = getCloudHealth().since;
    reportWriteFailure('history.batch.write', { code: 'unavailable' });
    reportWriteFailure('history.batch.write', { code: 'unavailable' });
    const s = getCloudHealth();
    expect(s.count).toBe(3);
    expect(s.since).toBe(first);
  });

  test('성공 보고 시 상태 완전 리셋', () => {
    reportWriteFailure('splits.write', { code: 'resource-exhausted' });
    reportWriteSuccess();
    const s = getCloudHealth();
    expect(s.failing).toBe(false);
    expect(s.code).toBe(null);
    expect(s.count).toBe(0);
    expect(s.since).toBe(null);
  });

  test('구독자는 실패/성공 모두 통지받고, 해제 후엔 통지 없음', () => {
    const seen = [];
    const unsub = subscribeCloudHealth((s) => seen.push(s.failing));
    reportWriteFailure('groups.write', { code: 'unavailable' });
    reportWriteSuccess();
    expect(seen).toEqual([true, false]);
    unsub();
    reportWriteFailure('groups.write', { code: 'unavailable' });
    expect(seen).toEqual([true, false]);
  });

  test('code 없는 에러는 message → unknown 순 fallback', () => {
    reportWriteFailure('x', { message: 'boom' });
    expect(getCloudHealth().code).toBe('boom');
    reportWriteSuccess();
    reportWriteFailure('x', null);
    expect(getCloudHealth().code).toBe('unknown');
  });

  test('describeCloudError — 사장님용 한국어 매핑', () => {
    expect(describeCloudError('resource-exhausted')).toContain('한도 초과');
    expect(describeCloudError('firestore/resource-exhausted')).toContain('한도 초과');
    expect(describeCloudError('permission-denied')).toContain('권한');
    expect(describeCloudError('unavailable')).toContain('네트워크');
    expect(describeCloudError('deadline-exceeded')).toContain('네트워크');
    expect(describeCloudError('unauthenticated')).toContain('재시작');
    expect(describeCloudError('weird-code')).toContain('weird-code');
  });
});
