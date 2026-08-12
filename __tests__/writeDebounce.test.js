import { computeDebounceDelay } from '../utils/writeDebounce';

// 2026-08-12: 디바운스 기아(starvation) 처방 — "치우면 지워졌다가 되살아난다".
// snapshot 이 촘촘히 오면 타이머가 매번 리셋돼 커밋이 영영 안 뜨던 구멍을 상한으로 막는다.
describe('computeDebounceDelay', () => {
  const DEBOUNCE = 300;
  const MAX = 2000;

  it('dirty 구간 시작(firstDirtyAt=0)이면 평소 디바운스 그대로', () => {
    expect(computeDebounceDelay(DEBOUNCE, MAX, 0, 1_000_000)).toBe(300);
  });

  it('상한 안쪽에서 리셋되면 여전히 평소 디바운스', () => {
    const t0 = 1_000_000;
    expect(computeDebounceDelay(DEBOUNCE, MAX, t0, t0 + 100)).toBe(300);
    expect(computeDebounceDelay(DEBOUNCE, MAX, t0, t0 + 1000)).toBe(300);
  });

  it('상한에 가까워지면 남은 시간만큼만 미룬다 (총 대기 = maxWait)', () => {
    const t0 = 1_000_000;
    expect(computeDebounceDelay(DEBOUNCE, MAX, t0, t0 + 1800)).toBe(200);
    expect(computeDebounceDelay(DEBOUNCE, MAX, t0, t0 + 1950)).toBe(50);
  });

  it('상한을 넘기면 0 — 더 안 미루고 즉시 커밋 (기아 차단)', () => {
    const t0 = 1_000_000;
    expect(computeDebounceDelay(DEBOUNCE, MAX, t0, t0 + 2000)).toBe(0);
    expect(computeDebounceDelay(DEBOUNCE, MAX, t0, t0 + 9999)).toBe(0);
  });

  it('아무리 촘촘히 리셋해도 총 대기가 maxWait 을 못 넘는다', () => {
    const t0 = 1_000_000;
    let now = t0;
    let fireAt = Infinity;
    // 50ms 마다 snapshot 이 도착해 타이머를 리셋하는 상황을 100회 재현.
    for (let i = 0; i < 100; i++) {
      const delay = computeDebounceDelay(DEBOUNCE, MAX, t0, now);
      fireAt = now + delay;
      if (delay === 0) break; // 즉시 커밋 — 다음 리셋이 못 가로챈다
      now += 50;
    }
    expect(fireAt - t0).toBeLessThanOrEqual(MAX);
  });

  it('음수 시계 역행에도 음수 지연을 내지 않는다', () => {
    const t0 = 1_000_000;
    expect(computeDebounceDelay(DEBOUNCE, MAX, t0, t0 - 5000)).toBe(300);
  });

  it('maxWait 이 디바운스보다 짧으면 maxWait 이 이긴다', () => {
    expect(computeDebounceDelay(500, 100, 0, 1_000_000)).toBe(500);
    expect(computeDebounceDelay(500, 100, 1_000_000, 1_000_000)).toBe(100);
  });
});
