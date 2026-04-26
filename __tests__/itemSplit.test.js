import { splitItemForDisplay, splitItemsForDisplay } from '../utils/itemSplit';

describe('splitItemForDisplay', () => {
  test('보통만 있을 때 한 행만 나옴', () => {
    const rows = splitItemForDisplay({ id: 'm1', qty: 3, largeQty: 0, options: [] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ qty: 3, isLarge: false });
  });

  test('대만 있을 때 한 행만 나옴', () => {
    const rows = splitItemForDisplay({ id: 'm1', qty: 2, largeQty: 2, options: ['extra'] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ qty: 2, isLarge: true });
    expect(rows[0].options).toEqual(['extra']);
  });

  test('대 + 보통이 섞이면 두 행으로 분리', () => {
    const rows = splitItemForDisplay({ id: 'm1', qty: 5, largeQty: 2 });
    expect(rows).toHaveLength(2);
    const normal = rows.find((r) => !r.isLarge);
    const large = rows.find((r) => r.isLarge);
    expect(normal.qty).toBe(3);
    expect(large.qty).toBe(2);
  });

  test('largeQty 가 qty 와 같으면 보통 행은 안 만든다', () => {
    const rows = splitItemForDisplay({ id: 'm1', qty: 4, largeQty: 4 });
    expect(rows).toHaveLength(1);
    expect(rows[0].isLarge).toBe(true);
    expect(rows[0].qty).toBe(4);
  });

  test('largeQty 가 undefined 면 0 으로 취급', () => {
    const rows = splitItemForDisplay({ id: 'm1', qty: 2 });
    expect(rows).toHaveLength(1);
    expect(rows[0].isLarge).toBe(false);
  });

  test('두 행 모두 동일한 옵션을 공유한다', () => {
    const opts = ['치즈추가', '매운맛'];
    const rows = splitItemForDisplay({ id: 'm1', qty: 4, largeQty: 1, options: opts });
    expect(rows[0].options).toBe(opts);
    expect(rows[1].options).toBe(opts);
  });

  test('key 는 id-n / id-l 패턴', () => {
    const rows = splitItemForDisplay({ id: 'pizza', qty: 3, largeQty: 1 });
    const keys = rows.map((r) => r.key).sort();
    expect(keys).toEqual(['pizza-l', 'pizza-n']);
  });
});

describe('splitItemsForDisplay', () => {
  test('빈/null 입력은 빈 배열', () => {
    expect(splitItemsForDisplay([])).toEqual([]);
    expect(splitItemsForDisplay(null)).toEqual([]);
    expect(splitItemsForDisplay(undefined)).toEqual([]);
  });

  test('여러 아이템을 평탄화', () => {
    const rows = splitItemsForDisplay([
      { id: 'a', qty: 2, largeQty: 0 },
      { id: 'b', qty: 3, largeQty: 1 },
    ]);
    expect(rows).toHaveLength(3);
  });
});
