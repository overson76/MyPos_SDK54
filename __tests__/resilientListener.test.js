// resilientListener — Firestore onSnapshot 자동 재연결 래퍼.
//
// 2026-09-11 사고 검증: 리스너가 에러로 죽으면 Firestore 는 다시 붙여주지 않는다.
// 죽은 채로 방치되면 화면은 멀쩡한데 기기끼리 어긋난다 ("연동 또 풀렸다").
// 여기서 검증하는 계약:
//   1. 에러 → 지수 백오프로 반드시 재구독한다
//   2. 한도 초과(resource-exhausted)는 훨씬 느리게 재시도한다 (재구독도 읽기를 태움)
//   3. 정상 snapshot 이 오면 실패 기록이 사라진다 (배너 자동 소멸)
//   4. unsubscribe 후에는 재연결 타이머가 절대 안 돈다 (유령 리스너 방지)

import {
  applyJitter,
  computeRetryDelay,
  getPendingRetryCount,
  retryAllListenersNow,
  subscribeResilient,
} from '../utils/resilientListener';
import {
  getListenerHealth,
  resetListenerHealth,
} from '../utils/cloudHealth';

jest.mock('../utils/sentry', () => ({
  reportError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

// ── 테스트용 가짜 Firestore ref + 주입 타이머 ────────────────
function makeFakeRef() {
  const state = { attaches: 0, unsubs: 0, next: null, err: null };
  const ref = {
    onSnapshot(next, err) {
      state.attaches += 1;
      state.next = next;
      state.err = err;
      return () => {
        state.unsubs += 1;
      };
    },
  };
  return { ref, state };
}

function makeClock() {
  const pending = [];
  return {
    pending,
    setTimeout: (fn, ms) => {
      pending.push({ fn, ms, cleared: false });
      return pending.length; // id = 1-based index
    },
    clearTimeout: (id) => {
      const t = pending[id - 1];
      if (t) t.cleared = true;
    },
    // 예약된 것 중 안 지워진 것들을 순서대로 실행
    runAll() {
      const snapshot = pending.slice();
      pending.length = 0;
      snapshot.forEach((t) => {
        if (!t.cleared) t.fn();
      });
    },
  };
}

function mount(opts = {}) {
  const { ref, state } = makeFakeRef();
  const clock = makeClock();
  const onNext = opts.onNext || jest.fn();
  const stop = subscribeResilient(ref, onNext, {
    ctx: opts.ctx || 'test.listener',
    random: opts.random || (() => 0.5), // jitter 고정 → 지연시간 결정적
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: opts.now || (() => 1000),
  });
  return { ref, state, clock, onNext, stop };
}

describe('computeRetryDelay — 지수 백오프', () => {
  test('일반 오류: 2초에서 시작해 2배씩, 60초 상한', () => {
    expect(computeRetryDelay(1)).toBe(2000);
    expect(computeRetryDelay(2)).toBe(4000);
    expect(computeRetryDelay(3)).toBe(8000);
    expect(computeRetryDelay(5)).toBe(32000);
    expect(computeRetryDelay(6)).toBe(60000);
    expect(computeRetryDelay(50)).toBe(60000);
  });

  test('한도 초과: 60초에서 시작해 5분 상한 — 재구독 자체가 읽기를 태우므로', () => {
    const q = 'resource-exhausted';
    expect(computeRetryDelay(1, q)).toBe(60000);
    expect(computeRetryDelay(2, q)).toBe(120000);
    expect(computeRetryDelay(3, q)).toBe(240000);
    expect(computeRetryDelay(4, q)).toBe(300000);
    expect(computeRetryDelay(99, q)).toBe(300000);
  });

  test('firestore/ 접두사가 붙은 코드도 한도로 인식', () => {
    expect(computeRetryDelay(1, 'firestore/resource-exhausted')).toBe(60000);
  });
});

describe('applyJitter — 동시 재시도 폭주 방지', () => {
  test('±25% 범위 안에서만 흔들린다', () => {
    expect(applyJitter(1000, () => 0)).toBe(750);
    expect(applyJitter(1000, () => 0.5)).toBe(1000);
    expect(applyJitter(1000, () => 0.999)).toBe(1250);
  });

  test('리스너 15개가 서로 다른 시각에 재시도한다', () => {
    let i = 0;
    const seq = [0.1, 0.3, 0.6, 0.9];
    const delays = seq.map(() => applyJitter(10000, () => seq[i++]));
    expect(new Set(delays).size).toBe(seq.length);
  });
});

describe('subscribeResilient — 재연결', () => {
  beforeEach(() => resetListenerHealth());

  test('마운트 즉시 1회 구독한다', () => {
    const { state } = mount();
    expect(state.attaches).toBe(1);
    expect(getListenerHealth().failing).toBe(false);
  });

  test('에러가 나면 기존 구독을 끊고 재연결을 예약한다', () => {
    const { state, clock } = mount();
    state.err({ code: 'unavailable' });

    expect(state.unsubs).toBe(1); // 죽은 리스너 정리
    expect(clock.pending).toHaveLength(1);
    expect(clock.pending[0].ms).toBe(2000); // jitter 0.5 → 배율 1.0
    expect(state.attaches).toBe(1); // 아직 재구독 전
  });

  test('예약된 타이머가 돌면 실제로 다시 붙는다', () => {
    const { state, clock } = mount();
    state.err({ code: 'unavailable' });
    clock.runAll();
    expect(state.attaches).toBe(2);
  });

  test('연속 실패는 지연이 2배씩 늘어난다', () => {
    const { state, clock } = mount();
    state.err({ code: 'unavailable' });
    expect(clock.pending[0].ms).toBe(2000);
    clock.runAll();
    state.err({ code: 'unavailable' });
    expect(clock.pending[0].ms).toBe(4000);
    clock.runAll();
    state.err({ code: 'unavailable' });
    expect(clock.pending[0].ms).toBe(8000);
  });

  test('정상 snapshot 이 오면 실패 카운터가 리셋된다', () => {
    const { state, clock } = mount();
    state.err({ code: 'unavailable' });
    clock.runAll();
    state.err({ code: 'unavailable' });
    clock.runAll();
    // 여기까지 2회 실패 → 다음 실패면 8초여야 하지만, 성공이 끼면 다시 2초부터.
    state.next({ docs: [] });
    state.err({ code: 'unavailable' });
    expect(clock.pending[0].ms).toBe(2000);
  });

  test('한도 초과는 첫 실패부터 60초 뒤에 재시도한다', () => {
    const { state, clock } = mount();
    state.err({ code: 'resource-exhausted' });
    expect(clock.pending[0].ms).toBe(60000);
  });
});

describe('subscribeResilient — 배너 연동 (cloudHealth)', () => {
  beforeEach(() => resetListenerHealth());

  test('실패하면 ctx/code/재시도시각이 배너 상태에 실린다', () => {
    const { state } = mount({ ctx: 'orders.listener', now: () => 5000 });
    state.err({ code: 'resource-exhausted' });

    const h = getListenerHealth();
    expect(h.failing).toBe(true);
    expect(h.ctxs).toEqual(['orders.listener']);
    expect(h.code).toBe('resource-exhausted');
    expect(h.retryAt).toBe(5000 + 60000);
  });

  test('여러 리스너가 죽으면 건수로 집계되고, 한도 초과가 대표 코드가 된다', () => {
    const a = mount({ ctx: 'orders.listener' });
    const b = mount({ ctx: 'history.listener' });
    a.state.err({ code: 'unavailable' });
    b.state.err({ code: 'resource-exhausted' });

    const h = getListenerHealth();
    expect(h.ctxs).toEqual(['history.listener', 'orders.listener']);
    expect(h.code).toBe('resource-exhausted'); // 사장님이 먼저 알아야 할 원인
  });

  test('하나가 살아나도 나머지가 죽어있으면 배너는 유지된다', () => {
    const a = mount({ ctx: 'orders.listener' });
    const b = mount({ ctx: 'history.listener' });
    a.state.err({ code: 'unavailable' });
    b.state.err({ code: 'unavailable' });

    a.clock.runAll();
    a.state.next({ docs: [] });

    const h = getListenerHealth();
    expect(h.failing).toBe(true);
    expect(h.ctxs).toEqual(['history.listener']);
  });

  test('전부 살아나면 배너가 사라진다', () => {
    const { state, clock } = mount();
    state.err({ code: 'unavailable' });
    expect(getListenerHealth().failing).toBe(true);
    clock.runAll();
    state.next({ docs: [] });
    expect(getListenerHealth().failing).toBe(false);
  });
});

describe('retryAllListenersNow — 즉시 재연결 (앱 포그라운드 / 관리자 버튼)', () => {
  beforeEach(() => {
    resetListenerHealth();
    retryAllListenersNow(); // 앞 테스트가 남긴 대기 핸들 비우기
  });

  test('대기 중인 리스너가 없으면 0을 반환한다', () => {
    expect(getPendingRetryCount()).toBe(0);
    expect(retryAllListenersNow()).toBe(0);
  });

  test('백오프 대기 중이면 남은 시간을 건너뛰고 즉시 붙는다', () => {
    const { state, clock } = mount();
    state.err({ code: 'resource-exhausted' }); // 60초 대기
    expect(getPendingRetryCount()).toBe(1);

    expect(retryAllListenersNow()).toBe(1);
    expect(state.attaches).toBe(2); // 타이머를 안 기다리고 붙었다
    expect(getPendingRetryCount()).toBe(0);

    // 예약돼 있던 타이머는 취소돼서 중복 재연결이 없다
    clock.runAll();
    expect(state.attaches).toBe(2);
  });

  test('여러 리스너가 대기 중이면 전부 깨운다', () => {
    const a = mount({ ctx: 'orders.listener' });
    const b = mount({ ctx: 'history.listener' });
    a.state.err({ code: 'resource-exhausted' });
    b.state.err({ code: 'resource-exhausted' });
    expect(getPendingRetryCount()).toBe(2);

    expect(retryAllListenersNow()).toBe(2);
    expect(a.state.attaches).toBe(2);
    expect(b.state.attaches).toBe(2);
  });

  test('이미 해제된 리스너는 깨우지 않는다', () => {
    const { state, stop } = mount();
    state.err({ code: 'resource-exhausted' });
    stop();
    expect(getPendingRetryCount()).toBe(0);
    expect(retryAllListenersNow()).toBe(0);
    expect(state.attaches).toBe(1);
  });
});

describe('subscribeResilient — 안전장치', () => {
  beforeEach(() => resetListenerHealth());

  test('unsubscribe 후에는 재연결 타이머가 돌지 않는다 (유령 리스너 방지)', () => {
    const { state, clock, stop } = mount();
    state.err({ code: 'unavailable' });
    stop();
    clock.runAll();
    expect(state.attaches).toBe(1); // 재구독 없음
  });

  test('unsubscribe 는 배너에서도 내려준다 (화면 전환은 장애가 아님)', () => {
    const { state, stop } = mount();
    state.err({ code: 'unavailable' });
    expect(getListenerHealth().failing).toBe(true);
    stop();
    expect(getListenerHealth().failing).toBe(false);
  });

  test('unsubscribe 후 늦게 도착한 snapshot 은 핸들러를 부르지 않는다', () => {
    const onNext = jest.fn();
    const { state, stop } = mount({ onNext });
    stop();
    state.next({ docs: [] });
    expect(onNext).not.toHaveBeenCalled();
  });

  test('핸들러가 예외를 던져도 구독이 죽지 않는다', () => {
    let calls = 0;
    const onNext = () => {
      calls += 1;
      throw new Error('렌더 중 터짐');
    };
    const { state } = mount({ onNext });

    expect(() => state.next({ docs: [] })).not.toThrow();
    expect(() => state.next({ docs: [] })).not.toThrow();
    expect(calls).toBe(2); // 여전히 살아서 두 번째도 받았다
    expect(getListenerHealth().failing).toBe(false); // 핸들러 버그는 리스너 장애가 아님
  });

  test('onSnapshot 자체가 던져도 재연결을 예약한다', () => {
    const clock = makeClock();
    let attaches = 0;
    const ref = {
      onSnapshot() {
        attaches += 1;
        if (attaches === 1) throw new Error('ref 무효');
        return () => {};
      },
    };
    subscribeResilient(ref, jest.fn(), {
      ctx: 'boom.listener',
      random: () => 0.5,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    });
    expect(clock.pending).toHaveLength(1);
    clock.runAll();
    expect(attaches).toBe(2);
  });
});
