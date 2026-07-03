import { summarizePerfLog } from '../utils/perfDiag';

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
