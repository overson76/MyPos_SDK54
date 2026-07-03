import {
  mergeKeyedPull,
  mergeHistoryPull,
  mergeValuePull,
} from '../utils/syncMerge';
import { orderReducer, PENDING_TABLE_ID } from '../utils/orderReducer';

// 2026-06-30 사장님 신고 재현 — "결제/완료 처리한 게 되살아난다 + 조작이 씹힌다".
// pull(snapshot) 이 미push 로컬 변경을 통째로 되돌리던 레이스의 회귀 방지.

describe('mergeKeyedPull', () => {
  const t1 = { items: [1], status: 'preparing' };
  const t2 = { items: [2], status: 'preparing' };

  test('dirty 없으면 server 객체 그대로 (참조 동일 — push noop 유지)', () => {
    const server = { d1: t1 };
    const local = { d1: t1 };
    const last = { d1: t1 };
    expect(mergeKeyedPull(server, local, last)).toBe(server);
  });

  test('🔴 사고 재현: 결제 완료(로컬 삭제 미push) — echo 에 남아있어도 부활 금지', () => {
    // 카운터가 d1 결제 → 로컬에서 d1 제거. push(300ms 디바운스) 전에
    // 직전 write 의 echo snapshot(d1 아직 있음) 도착.
    const server = { d1: t1, d2: t2 };
    const local = { d2: t2 }; // d1 결제 완료로 비움
    const last = { d1: t1, d2: t2 };
    const merged = mergeKeyedPull(server, local, last);
    expect(merged.d1).toBeUndefined(); // 부활 금지!
    expect(merged.d2).toBe(t2);
  });

  test('🔴 사고 재현: 로컬 편집 미push — snapshot 이 덮어도 조작 소멸 금지', () => {
    const edited = { items: [1, 99], status: 'preparing' };
    const server = { d1: t1 };
    const local = { d1: edited }; // 방금 메뉴 추가 (미push)
    const last = { d1: t1 };
    const merged = mergeKeyedPull(server, local, last);
    expect(merged.d1).toBe(edited); // 내 조작 유지
  });

  test('다른 기기 신규/삭제는 정상 반영 (clean 항목)', () => {
    const server = { d3: t2 }; // 타 기기가 d1 지우고 d3 만듦
    const local = { d1: t1 };
    const last = { d1: t1 }; // d1 은 clean
    const merged = mergeKeyedPull(server, local, last);
    expect(merged.d1).toBeUndefined(); // 서버 삭제 반영
    expect(merged.d3).toBe(t2); // 서버 신규 반영
  });

  test('로컬 신규(lastSynced 에 없음) 보존', () => {
    const fresh = { items: [7] };
    const merged = mergeKeyedPull({}, { d5: fresh }, {});
    expect(merged.d5).toBe(fresh);
  });

  test('null/undefined 안전', () => {
    expect(mergeKeyedPull(null, null, null)).toEqual({});
    const server = { a: t1 };
    expect(mergeKeyedPull(server, undefined, undefined)).toBe(server);
  });
});

describe('mergeHistoryPull', () => {
  const h1 = { id: 'a', total: 1000 };
  const h2 = { id: 'b', total: 2000 };

  test('dirty 없으면 server 그대로', () => {
    const server = [h2, h1];
    const local = [h1];
    expect(mergeHistoryPull(server, local, local)).toBe(server);
  });

  test('🔴 사고 재현: 방금 결제 기록(미push) — echo 에 없어도 증발 금지', () => {
    const fresh = { id: 'c', total: 3000 }; // 방금 markPaid 로 append
    const server = [h2, h1]; // echo 엔 아직 c 없음
    const local = [fresh, h2, h1];
    const last = [h2, h1];
    const merged = mergeHistoryPull(server, local, last);
    expect(merged[0]).toBe(fresh); // 최신 유지 (appendHistory 앞붙임 규칙)
    expect(merged).toHaveLength(3);
  });

  test('로컬 삭제(되돌리기 정리) 미push — 서버에서 제외 유지', () => {
    const server = [h2, h1];
    const local = [h2]; // h1 로컬 삭제
    const last = [h2, h1];
    const merged = mergeHistoryPull(server, local, last);
    expect(merged).toEqual([h2]);
  });

  test('로컬 수정(같은 id, 참조 다름) 우선', () => {
    const h1edit = { id: 'a', total: 1500, reverted: true };
    const server = [h2, h1];
    const local = [h2, h1edit];
    const last = [h2, h1];
    const merged = mergeHistoryPull(server, local, last);
    expect(merged.find((h) => h.id === 'a')).toBe(h1edit);
  });
});

describe('mergeValuePull', () => {
  test('clean 이면 server, dirty 면 local', () => {
    const oldV = { a: 1 };
    const newV = { a: 2 };
    const localDirty = { a: 3 };
    expect(mergeValuePull(newV, oldV, oldV)).toBe(newV); // clean → pull
    expect(mergeValuePull(newV, localDirty, oldV)).toBe(localDirty); // dirty → 유지
  });
});

// reducer 통합 — listener 가 lastSynced 를 실어 보내는 실제 경로.
describe('orderReducer · hydrate + lastSynced 병합', () => {
  const t1 = { items: [{ id: 'm1', qty: 1 }], cartItems: [], confirmedItems: [] };

  test('lastSynced 없으면 기존 전체 교체 (부팅 hydrate 하위호환)', () => {
    const payload = { d1: t1 };
    expect(
      orderReducer({ d9: t1 }, { type: 'orders/hydrate', payload })
    ).toBe(payload);
  });

  test('lastSynced 있고 dirty 없으면 payload 그대로', () => {
    const payload = { d1: t1 };
    const state = { d1: t1 };
    expect(
      orderReducer(state, {
        type: 'orders/hydrate',
        payload,
        lastSynced: { d1: t1 },
      })
    ).toBe(payload);
  });

  test('🔴 사고 재현: 결제로 비운 칸이 echo snapshot 으로 부활 금지', () => {
    const state = {}; // d1 결제 완료 → clearTable
    const next = orderReducer(state, {
      type: 'orders/hydrate',
      payload: { d1: t1 }, // echo 에 d1 잔존
      lastSynced: { d1: t1 },
    });
    expect(next.d1).toBeUndefined();
  });

  test('PENDING 카트는 병합과 무관하게 보존 (1.0.51 유지)', () => {
    const pending = { cartItems: [{ id: 'm2', qty: 1 }] };
    const state = { [PENDING_TABLE_ID]: pending };
    const next = orderReducer(state, {
      type: 'orders/hydrate',
      payload: { d1: t1 },
      lastSynced: {},
    });
    expect(next[PENDING_TABLE_ID]).toBe(pending);
    expect(next.d1).toBe(t1);
  });
});

// 2026-07-03 매장 사고 재현 — 카운터 PC 멈춤→재시작 후, 아이패드가 끝낸 결제
// 2건이 전 기기에서 부활. 부팅 hydration 의 옛 사본은 "dirty" 가 아니다.
describe('orderReducer · 부팅 옛 사본 vs 첫 snapshot (7/3 부활 회귀 방지)', () => {
  const stale07 = { items: [{ id: 'm1', qty: 1 }], paymentStatus: 'unpaid' };
  const stale03 = { items: [{ id: 'm2', qty: 1 }], paymentStatus: 'unpaid' };

  test('🔴 첫 snapshot(lastSynced 미전달) — 옛 사본 전체 교체, 결제 완료 유지', () => {
    // 재시작: AsyncStorage 옛 사본 {07,03} hydrate. 서버는 이미 결제 완료(빈).
    // listener 는 첫 snapshot 에 lastSynced 를 싣지 않는다 → 병합 없이 서버 진실.
    const bootState = { t07: stale07, t03: stale03 };
    const next = orderReducer(bootState, {
      type: 'orders/hydrate',
      payload: {}, // 서버: 아이패드가 모두 결제 완료
    });
    expect(next.t07).toBeUndefined(); // 부활 금지
    expect(next.t03).toBeUndefined();
  });

  test('위험 동작 문서화: 첫 snapshot 에 lastSynced 를 실으면 옛 사본이 부활한다', () => {
    // 7/3 사고의 정확한 메커니즘 — 부팅 직후 ref 는 hydration 이전(빈) 기준이라
    // 옛 사본이 전부 dirty 로 오인됨. 그래서 listener 는 첫 snapshot 에 절대
    // lastSynced 를 싣지 않는다 (isFirstSnapshot 분기). 이 테스트는 그 이유의 증명.
    const bootState = { t07: stale07 };
    const next = orderReducer(bootState, {
      type: 'orders/hydrate',
      payload: {},
      lastSynced: {}, // ← 부팅 직후의 잘못된 기준선
    });
    expect(next.t07).toBe(stale07); // dirty 오인 → 부활 (금지된 호출 형태)
  });
});
