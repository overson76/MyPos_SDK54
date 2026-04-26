import { computeDiffRows } from '../utils/orderDiff';

const item = (overrides = {}) => ({
  id: 'm1',
  qty: 1,
  largeQty: 0,
  options: [],
  memo: '',
  ...overrides,
});

describe('computeDiffRows', () => {
  test('current 만 있을 때 모두 added 로 분류', () => {
    const rows = computeDiffRows([item({ slotId: 's1' })], []);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('added');
  });

  test('confirmed 에만 있는 것은 removed (qty 0 으로)', () => {
    const rows = computeDiffRows([], [item({ slotId: 's1', qty: 2 })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('removed');
    expect(rows[0].item.qty).toBe(0);
  });

  test('완전히 동일하면 unchanged', () => {
    const a = item({ slotId: 's1', qty: 2 });
    const b = item({ slotId: 's1', qty: 2 });
    const rows = computeDiffRows([a], [b]);
    expect(rows[0].kind).toBe('unchanged');
  });

  test('qty 변동은 changed + previousQty 보존', () => {
    const a = item({ slotId: 's1', qty: 3 });
    const b = item({ slotId: 's1', qty: 1 });
    const rows = computeDiffRows([a], [b]);
    expect(rows[0].kind).toBe('changed');
    expect(rows[0].previousQty).toBe(1);
  });

  test('largeQty 변동은 changed', () => {
    const rows = computeDiffRows(
      [item({ slotId: 's1', qty: 2, largeQty: 1 })],
      [item({ slotId: 's1', qty: 2, largeQty: 0 })]
    );
    expect(rows[0].kind).toBe('changed');
  });

  test('options 배열 변경은 changed', () => {
    const rows = computeDiffRows(
      [item({ slotId: 's1', options: ['매운맛'] })],
      [item({ slotId: 's1', options: [] })]
    );
    expect(rows[0].kind).toBe('changed');
  });

  test('memo 변경은 changed', () => {
    const rows = computeDiffRows(
      [item({ slotId: 's1', memo: '소스 따로' })],
      [item({ slotId: 's1', memo: '' })]
    );
    expect(rows[0].kind).toBe('changed');
  });

  test('slotId 가 없으면 id 기반 키 (`m-${id}`) 사용 — 같은 메뉴는 동일행', () => {
    const rows = computeDiffRows(
      [item({ id: 'pizza', qty: 2 })],
      [item({ id: 'pizza', qty: 1 })]
    );
    expect(rows[0].kind).toBe('changed');
  });

  test('added + removed + changed + unchanged 가 섞인 케이스', () => {
    const current = [
      item({ slotId: 'a', qty: 1 }), // unchanged
      item({ slotId: 'b', qty: 5 }), // changed (was 2)
      item({ slotId: 'c', qty: 1 }), // added
    ];
    const confirmed = [
      item({ slotId: 'a', qty: 1 }),
      item({ slotId: 'b', qty: 2 }),
      item({ slotId: 'd', qty: 3 }), // removed
    ];
    const rows = computeDiffRows(current, confirmed);
    const byKind = rows.reduce((acc, r) => {
      acc[r.kind] = (acc[r.kind] || 0) + 1;
      return acc;
    }, {});
    expect(byKind).toEqual({ unchanged: 1, changed: 1, added: 1, removed: 1 });
  });
});
