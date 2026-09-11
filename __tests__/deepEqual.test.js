// deepEqual / sameForSync — Firestore push 판정.
//
// 2026-09-11 쓰기 폭발 사고: push 판정이 참조(===)뿐이라, 에코로 돌아온 새 객체를
// "변경" 으로 오판해 자가증식 쓰기 루프가 났다. 여기서 못 박는 계약:
//   "왕복(로컬 → Firestore → 에코)해도 내용이 같으면 절대 다시 쓰지 않는다"
// 그 왕복에서 실제로 생기는 변형(키 순서 바뀜, undefined 키 소실)을 전부 같게 봐야 한다.

import { deepEqual, sameForSync } from '../utils/deepEqual';

describe('deepEqual — 기본', () => {
  test('원시값', () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual('a', 'a')).toBe(true);
    expect(deepEqual(true, true)).toBe(true);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual('1', 1)).toBe(false);
    expect(deepEqual(null, undefined)).toBe(false);
    expect(deepEqual(null, 0)).toBe(false);
    expect(deepEqual(0, false)).toBe(false);
  });

  test('중첩 객체 / 배열', () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false);
    expect(deepEqual([1, 2], [2, 1])).toBe(false); // 배열은 순서 있음
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual({ a: 1 }, [1])).toBe(false);
  });
});

describe('deepEqual — Firestore 왕복에서 생기는 변형', () => {
  test('키 순서가 달라도 같다 (JSON.stringify 비교였다면 오탐)', () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(
      deepEqual({ x: { p: 1, q: 2 } }, { x: { q: 2, p: 1 } })
    ).toBe(true);
  });

  test('undefined 값과 키 부재는 같다 (Firestore 는 undefined 를 저장하지 않음)', () => {
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    // 이걸 다르다고 보면 그 자체로 영구 쓰기 루프가 된다.
  });

  test('null 은 undefined 와 다르다 (null 은 Firestore 에 실제로 저장됨)', () => {
    expect(deepEqual({ a: null }, { a: undefined })).toBe(false);
    expect(deepEqual({ a: null }, {})).toBe(false);
  });

  test('숫자 0 과 빈 문자열은 구분한다', () => {
    expect(deepEqual({ qty: 0 }, { qty: '' })).toBe(false);
  });
});

describe('sameForSync — 실제 주문 문서 모양', () => {
  const serverDoc = {
    confirmed: [
      { slotId: 's1', id: 'm1', qty: 2, largeQty: 1, options: ['덜 맵게'], memo: null },
    ],
    current: [],
    paid: false,
    createdAt: 1757000000000,
  };

  test('서버에서 새로 역직렬화된 동일 내용 → 쓰지 않는다', () => {
    // 매 snapshot 마다 만들어지는 새 객체를 흉내 (내용 동일, 키 순서 섞음)
    const echoed = {
      createdAt: 1757000000000,
      paid: false,
      current: [],
      confirmed: [
        { memo: null, options: ['덜 맵게'], largeQty: 1, qty: 2, id: 'm1', slotId: 's1' },
      ],
    };
    expect(echoed).not.toBe(serverDoc); // 참조는 다르다
    expect(sameForSync(serverDoc, echoed)).toBe(true); // 그래도 안 쓴다
  });

  test('내용이 실제로 바뀌면 쓴다', () => {
    const changed = JSON.parse(JSON.stringify(serverDoc));
    changed.confirmed[0].qty = 3;
    expect(sameForSync(serverDoc, changed)).toBe(false);
  });

  test('결제 상태만 바뀌어도 쓴다', () => {
    const paid = { ...serverDoc, paid: true };
    expect(sameForSync(serverDoc, paid)).toBe(false);
  });

  test('참조가 같으면 내용을 보지 않고 즉시 true (빠른 경로)', () => {
    expect(sameForSync(serverDoc, serverDoc)).toBe(true);
  });

  test('한쪽이 없으면 다르다 (테이블 신규 생성 / 삭제)', () => {
    expect(sameForSync(serverDoc, undefined)).toBe(false);
    expect(sameForSync(undefined, serverDoc)).toBe(false);
    expect(sameForSync(undefined, undefined)).toBe(true);
  });
});

describe('sameForSync — 6/10 사고 재현 (union 배열)', () => {
  test('매번 새로 만들어지는 동일 내용 배열은 쓰기를 유발하지 않는다', () => {
    const a = ['pair-1', 'pair-2'];
    const b = ['pair-1', 'pair-2']; // union 결과로 새로 만들어진 배열
    expect(a === b).toBe(false);
    expect(sameForSync(a, b)).toBe(true);
  });

  test('원소가 추가되면 쓴다', () => {
    expect(sameForSync(['p1'], ['p1', 'p2'])).toBe(false);
  });
});
