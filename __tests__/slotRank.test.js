// 2026-07-10: 배달 도착순 표시 중앙 서비스 — setSlotRankMaps / rankedSlotLabel.
//   저장 슬롯은 고정, 화면 번호는 받은 시각(createdAt) 순. resolveAnyTable 이 이 서비스를
//   읽어 배달판·주방·영수증·음성·지도가 같은 번호를 쓴다.

import {
  setSlotRankMaps,
  rankedSlotLabel,
  slotOccupied,
} from '../utils/slotRank';

const del = (ts) => ({ items: [{ id: 1 }], createdAt: ts });

describe('slotRank — 도착순 라벨 중앙 서비스', () => {
  afterEach(() => setSlotRankMaps({})); // 모듈 전역 초기화

  test('slotOccupied — 발신자 정보만 있어도 점유(주문대기), 빈 슬롯은 미점유', () => {
    expect(slotOccupied({ deliveryPhone: '01011112222' })).toBe(true);
    expect(slotOccupied({ deliveryAlias: '꽈베기' })).toBe(true);
    expect(slotOccupied({ items: [], cartItems: [] })).toBe(false);
    expect(slotOccupied(null)).toBe(false);
  });

  test('도착순(createdAt)으로 배달 번호 — 저장 키와 무관', () => {
    setSlotRankMaps({ d1: del(200), d3: del(100), d5: del(300) });
    expect(rankedSlotLabel('d3')).toBe('배달1'); // 가장 오래됨
    expect(rankedSlotLabel('d1')).toBe('배달2');
    expect(rankedSlotLabel('d5')).toBe('배달3');
  });

  test('분할 슬롯 → "배달N-파트" (부모 순위 종속)', () => {
    setSlotRankMaps({ d2: del(100), d4: del(200) });
    expect(rankedSlotLabel('d2#1')).toBe('배달1-1');
    expect(rankedSlotLabel('d2#2')).toBe('배달1-2');
    expect(rankedSlotLabel('d4#1')).toBe('배달2-1');
  });

  test('순위 없는/빈/비동적 슬롯 → null (호출처가 기존 라벨로 폴백)', () => {
    setSlotRankMaps({ d1: del(100) });
    expect(rankedSlotLabel('d9')).toBe(null); // 미점유 슬롯
    expect(rankedSlotLabel('t01')).toBe(null); // 홀 테이블
    expect(rankedSlotLabel('r10')).toBe(null);
    expect(rankedSlotLabel('')).toBe(null);
    expect(rankedSlotLabel(null)).toBe(null);
  });

  test('예약(y)/포장(p) 도 동일하게 도착순', () => {
    setSlotRankMaps({ y2: del(100), y1: del(200), p1: del(50) });
    expect(rankedSlotLabel('y2')).toBe('예약1'); // y2 가 더 오래됨
    expect(rankedSlotLabel('y1')).toBe('예약2');
    expect(rankedSlotLabel('p1')).toBe('포장1');
  });

  test('🔑 완료되면 뒤가 승격 — 가장 오래된 배달1 사라지면 다음이 배달1', () => {
    setSlotRankMaps({ d1: del(100), d2: del(200), d4: del(300) });
    expect(rankedSlotLabel('d1')).toBe('배달1');
    expect(rankedSlotLabel('d2')).toBe('배달2');
    expect(rankedSlotLabel('d4')).toBe('배달3');
    // d1(가장 오래됨) 완료 처리로 orders 에서 사라짐 → d2 가 배달1 로 승격(화면만).
    setSlotRankMaps({ d2: del(200), d4: del(300) });
    expect(rankedSlotLabel('d2')).toBe('배달1');
    expect(rankedSlotLabel('d4')).toBe('배달2');
    expect(rankedSlotLabel('d1')).toBe(null); // 사라짐
  });
});
