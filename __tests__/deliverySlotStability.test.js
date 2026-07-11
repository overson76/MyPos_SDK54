// 2026-07-10: 🔴 배달 주문 무음 유실 근본처방 회귀 가드.
//
// 사고: 라이브에서 결제 기록도 없이 배달 주문(꽈베기)이 전 기기 화면에서 사라짐.
// 원인: 배달 슬롯이 위치(d1..d5)로 저장되는데, 배달 완료 때마다 슬롯을 당기는
//   재정렬(compactSlots)이 "슬롯의 주인"을 바꿨다. 여러 기기 동기화(mergeKeyedPull)는
//   "d1 의 내용이 바뀜"을 '수정'으로 보고 서버 값을 그대로 받아, 그 슬롯에 있던 다른
//   살아있는 주문을 삭제 감지도 없이 소리 없이 덮어 사라지게 했다.
// 처방: 슬롯 자동 재정렬 3곳(결제/비우기·자리이동·배달 자동정리) 제거 → 슬롯 생성 자리 고정.
//
// 이 파일은 (A) 재배정이 유실을 일으킨다는 증명(재도입 금지 경고) +
//          (B) 안정 슬롯에서는 유실이 없다는 보장 을 함께 못박는다.

import { mergeKeyedPull } from '../utils/syncMerge';
import { orderReducer } from '../utils/orderReducer';
import { computeSlotRankMap, findEmptySlotForType } from '../utils/orderHelpers';

describe('배달 슬롯 안정화 — 무음 유실 근본처방 (2026-07-10)', () => {
  // ── (A) 재배정(옛 compaction)이 유실을 일으킨다 — 절대 되살리지 말 것 ──
  test('❌ 슬롯 재배정 시: 다른 기기가 d1 주인을 바꾸면 이 기기의 주문이 무음 유실', () => {
    const kkwabaegi = { deliveryAlias: '꽈베기' };
    const local = { d1: kkwabaegi };
    const lastSynced = { d1: kkwabaegi }; // clean (내가 안 건드림)
    // 재정렬로 다른 주문(동진)이 d1 로 내려온 서버 스냅샷:
    const server = { d1: { deliveryAlias: '동진' } };
    const merged = mergeKeyedPull(server, local, lastSynced);
    // 꽈베기가 삭제 감지 없이 사라짐 — 이게 우리가 제거한 사고. (재발 방지용 증명)
    expect(merged.d1.deliveryAlias).toBe('동진');
    expect(Object.values(merged).some((o) => o.deliveryAlias === '꽈베기')).toBe(false);
  });

  // ── (B) 안정 슬롯(재정렬 제거)에서는 유실이 없다 ──
  test('✅ 안정 슬롯: d1(동진) 완료 정리가 d2(꽈베기)를 안 건드리고 깨끗이 삭제 전파', () => {
    const kkwabaegi = { deliveryAlias: '꽈베기' };
    const dongjin = { deliveryAlias: '동진' };
    // 기기 A 가 동진(d1) 완료 정리 → 서버 = {d2: 꽈베기} (d1 삭제, d2 그대로 — 당김 없음)
    const server = { d2: kkwabaegi };
    // 기기 B(clean)의 아직 옛 뷰:
    const local = { d1: dongjin, d2: kkwabaegi };
    const lastSynced = { d1: dongjin, d2: kkwabaegi };
    const merged = mergeKeyedPull(server, local, lastSynced);
    // d1(동진)은 삭제로 정확히 인지, d2(꽈베기)는 온전 — 유실 0.
    expect(merged.d2).toBe(kkwabaegi);
    expect(merged.d1).toBeUndefined();
  });

  test('✅ autoClearDelivery: 낮은 슬롯 정리돼도 위 슬롯은 자기 키 유지 (당기지 않음)', () => {
    const dongjin = { deliveryAlias: '동진', items: [{ id: 1 }], status: 'ready' };
    const kkwabaegi = { deliveryAlias: '꽈베기', items: [{ id: 2 }], status: 'preparing' };
    const state = { d1: dongjin, d2: kkwabaegi };
    // 프로덕션은 이제 정리 후 compactSlots 를 dispatch 하지 않는다.
    const next = orderReducer(state, {
      type: 'orders/autoClearDelivery',
      tableIds: ['d1'],
    });
    // 꽈베기는 여전히 d2 (d1 로 당겨지지 않음) — 다기기 무음 유실 원천 차단.
    expect(next.d2).toBe(kkwabaegi);
    expect(next.d1).toBeUndefined();
  });

  test('✅ 빈 자리 재사용: 재정렬 없이 findEmptySlotForType 가 낮은 빈칸을 채운다', () => {
    // (동작 계약 확인 — findEmptySlotForType 은 gap 을 이미 낮은 순으로 채운다)
    const used = () => ({ items: [{ id: 1 }] });
    // d2 가 비어 있으면(d1,d3 점유) 다음 배달은 d2 로 — 슬롯 재사용, 무한 증가 없음.
    expect(findEmptySlotForType({ d1: used(), d3: used() }, 'delivery')).toBe('d2');
  });
});

describe('computeSlotRankMap — 배달 도착순 표시 순위 (2026-07-10)', () => {
  const del = (ts, extra) => ({ items: [{ id: 1 }], createdAt: ts, ...(extra || {}) });

  test('createdAt 오름차순 = 오래된 것이 1번 (저장 키와 무관)', () => {
    const orders = { d1: del(300), d3: del(100), d5: del(200) };
    expect(computeSlotRankMap(orders, 'd')).toEqual({ d3: 1, d5: 2, d1: 3 });
  });

  test('점유 안 된 슬롯은 순위에서 제외', () => {
    const orders = { d1: del(100), d2: {}, d3: { items: [] } };
    expect(computeSlotRankMap(orders, 'd')).toEqual({ d1: 1 });
  });

  test('발신자 정보만 있는 주문대기 슬롯도 도착으로 순위', () => {
    const orders = {
      d1: { deliveryPhone: '01011112222', createdAt: 50 },
      d2: del(100),
    };
    expect(computeSlotRankMap(orders, 'd')).toEqual({ d1: 1, d2: 2 });
  });

  test('분할 자식(d1#1)은 부모(d1) 순위에 종속 — 최소 createdAt', () => {
    const orders = { 'd1#1': del(500), 'd1#2': del(400), d2: del(300) };
    expect(computeSlotRankMap(orders, 'd')).toEqual({ d2: 1, d1: 2 });
  });

  test('createdAt 없는 옛 슬롯은 맨 뒤 + 키 번호로 안정 정렬', () => {
    const orders = { d1: del(null), d2: del(100), d4: del(null) };
    expect(computeSlotRankMap(orders, 'd')).toEqual({ d2: 1, d1: 2, d4: 3 });
  });

  test('같은 createdAt 은 키 번호 낮은 순', () => {
    expect(computeSlotRankMap({ d3: del(100), d1: del(100) }, 'd')).toEqual({
      d1: 1,
      d3: 2,
    });
  });

  test('예약(y) prefix 동일 동작, 다른 prefix 무시', () => {
    const orders = { y2: del(200), y1: del(100), d1: del(50) };
    expect(computeSlotRankMap(orders, 'y')).toEqual({ y1: 1, y2: 2 });
  });

  test('빈 orders / prefix 없음 방어', () => {
    expect(computeSlotRankMap({}, 'd')).toEqual({});
    expect(computeSlotRankMap(null, 'd')).toEqual({});
    expect(computeSlotRankMap({ d1: del(1) }, '')).toEqual({});
  });
});
