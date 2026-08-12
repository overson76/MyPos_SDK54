import { createLazyEnrichQueue } from '../utils/lazyEnrichQueue';

// 2026-08-12 전수조사 B1·B2 — 동시 호출 상한 + 결과 일괄 반영.
describe('createLazyEnrichQueue', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  // 대기 중인 promise 들이 실제로 진행되도록 microtask 를 비운다.
  const drain = async (times = 12) => {
    for (let i = 0; i < times; i++) await Promise.resolve();
  };

  it('동시 실행이 limit 를 넘지 않는다', async () => {
    let running = 0;
    let peak = 0;
    const resolvers = [];
    const q = createLazyEnrichQueue({ limit: 3, flushMs: 10, apply: () => {} });

    for (let i = 0; i < 20; i++) {
      q.enqueue(`k${i}`, () => {
        running += 1;
        peak = Math.max(peak, running);
        return new Promise((res) => resolvers.push(() => {
          running -= 1;
          res({ v: i });
        }));
      });
    }
    await drain();
    expect(peak).toBe(3);

    // 하나씩 끝낼 때마다 다음 것이 들어와도 상한 유지
    while (resolvers.length) {
      resolvers.shift()();
      await drain();
    }
    expect(peak).toBe(3);
  });

  it('결과를 모았다가 apply 를 한 번만 호출한다', async () => {
    const applied = [];
    const q = createLazyEnrichQueue({
      limit: 5,
      flushMs: 100,
      apply: (batch) => applied.push(batch),
    });
    for (let i = 0; i < 5; i++) q.enqueue(`k${i}`, async () => ({ n: i }));
    await drain();
    expect(applied).toHaveLength(0); // 아직 flush 전

    jest.advanceTimersByTime(100);
    expect(applied).toHaveLength(1);
    expect(applied[0]).toHaveLength(5);
    expect(applied[0].map((r) => r.key).sort()).toEqual(['k0', 'k1', 'k2', 'k3', 'k4']);
  });

  it('같은 key 는 다시 큐에 안 들어간다 (성공 후에도)', async () => {
    let calls = 0;
    const q = createLazyEnrichQueue({ limit: 2, flushMs: 10, apply: () => {} });
    const run = async () => { calls += 1; return { ok: true }; };

    expect(q.enqueue('a', run)).toBe(true);
    expect(q.enqueue('a', run)).toBe(false); // in-flight
    await drain();
    jest.advanceTimersByTime(10);
    expect(q.enqueue('a', run)).toBe(false); // 반영 후에도 재요청 안 함
    expect(calls).toBe(1);
  });

  it('null 을 돌려주면 실패로 표시하고 다시 시도하지 않는다', async () => {
    const applied = [];
    const q = createLazyEnrichQueue({
      limit: 2,
      flushMs: 10,
      apply: (b) => applied.push(b),
    });
    q.enqueue('bad', async () => null);
    await drain();
    jest.advanceTimersByTime(10);
    expect(applied).toHaveLength(0); // 반영할 것 없음
    expect(q.enqueue('bad', async () => ({ ok: 1 }))).toBe(false);
    expect(q.stats().failed).toBe(1);
  });

  it('throw 해도 큐가 멈추지 않는다', async () => {
    const applied = [];
    const q = createLazyEnrichQueue({
      limit: 1,
      flushMs: 10,
      apply: (b) => applied.push(b),
    });
    q.enqueue('boom', async () => {
      throw new Error('네트워크');
    });
    q.enqueue('good', async () => ({ ok: 1 }));
    await drain();
    jest.advanceTimersByTime(10);
    expect(applied).toHaveLength(1);
    expect(applied[0]).toEqual([{ key: 'good', patch: { ok: 1 } }]);
  });

  it('늦게 도착한 결과도 반드시 flush 된다 (타이머 유실 없음)', async () => {
    const applied = [];
    let release;
    const q = createLazyEnrichQueue({
      limit: 1,
      flushMs: 10,
      apply: (b) => applied.push(b),
    });
    q.enqueue('slow', () => new Promise((res) => { release = () => res({ ok: 1 }); }));
    await drain();
    jest.advanceTimersByTime(1000); // 결과 도착 전에 타이머 창이 지나감
    expect(applied).toHaveLength(0);

    release();
    await drain();
    jest.advanceTimersByTime(10);
    expect(applied).toHaveLength(1); // 결과 도착 시점에 다시 예약돼야 한다
  });

  it('reset 하면 같은 key 를 다시 시도할 수 있다', async () => {
    const q = createLazyEnrichQueue({ limit: 1, flushMs: 10, apply: () => {} });
    q.enqueue('a', async () => null);
    await drain();
    expect(q.enqueue('a', async () => ({ ok: 1 }))).toBe(false);
    q.reset();
    expect(q.enqueue('a', async () => ({ ok: 1 }))).toBe(true);
  });
});
