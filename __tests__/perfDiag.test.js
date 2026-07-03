import {
  summarizePerfLog,
  measurePerf,
  notePerfInfo,
  getPerfLog,
  clearPerfLog,
} from '../utils/perfDiag';

// perfDiag 는 대부분 PerformanceObserver(브라우저 전용) 라 순수부(summarize)만 단위 테스트.
describe('summarizePerfLog', () => {
  test('빈 로그', () => {
    expect(summarizePerfLog([])).toEqual({
      count: 0,
      maxMs: 0,
      totalMs: 0,
      byAction: {},
    });
  });

  test('건수/최대/합계 + 액션별 분류', () => {
    const log = [
      { ts: 1, duration: 300, action: '결제(테이블)' },
      { ts: 2, duration: 1200, action: '결제(테이블)' },
      { ts: 3, duration: 500, action: null },
    ];
    const s = summarizePerfLog(log);
    expect(s.count).toBe(3);
    expect(s.maxMs).toBe(1200);
    expect(s.totalMs).toBe(2000);
    expect(s.byAction['결제(테이블)']).toBe(2);
    expect(s.byAction['(액션 없음/배경)']).toBe(1);
  });

  test('이상 입력 안전', () => {
    expect(summarizePerfLog(null).count).toBe(0);
    expect(summarizePerfLog(undefined).count).toBe(0);
  });
});

describe('measurePerf / notePerfInfo', () => {
  beforeEach(() => clearPerfLog());

  test('measurePerf 는 fn 반환값을 그대로 돌려줌', () => {
    expect(measurePerf('빠른작업', () => 42)).toBe(42);
  });

  test('빠른 작업은 기록 안 함(임계 미만)', () => {
    measurePerf('빠른작업', () => 1);
    expect(getPerfLog().length).toBe(0);
  });

  test('fn 이 throw 해도 전파(계측이 흐름 안 막음)', () => {
    expect(() => measurePerf('에러작업', () => {
      throw new Error('boom');
    })).toThrow('boom');
  });

  test('notePerfInfo 는 duration 0 정보 항목으로 기록', () => {
    notePerfInfo('⚠ orders 크기 8000KB');
    const log = getPerfLog();
    expect(log.length).toBe(1);
    expect(log[0].duration).toBe(0);
    expect(log[0].info).toBe(true);
    expect(log[0].action).toContain('8000KB');
  });
});
