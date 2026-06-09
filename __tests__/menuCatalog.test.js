import {
  normalizeMenuName,
  collectInOrderIds,
  isItemInOrder,
  findItemByName,
  catalogOnlyItems,
} from '../utils/menuCatalog';

const ITEMS = [
  { id: 1, name: '칼국수', category: '국수/만백' },
  { id: 2, name: '콩국수', category: '국수/만백' }, // 시즌 메뉴 (겨울엔 그리드 제외)
  { id: 3, name: '만두백반', category: '만두/공기밥' },
  { id: 4, name: '팥빙수', category: '음료' }, // 카탈로그만 (그리드 없음)
];

// 콩국수(2)는 그리드에 없음 = 주문에서 빠진 시즌 메뉴. 팥빙수(4)도 없음.
const ROWS = {
  즐겨찾기: [[1, null]],
  '국수/만백': [[1, null, null, null, null, null]],
  '만두/공기밥': [[3, null, null, null, null, null]],
  음료: [[null, null, null, null, null, null]],
};

describe('normalizeMenuName', () => {
  test('앞뒤 공백 + 내부 공백 압축', () => {
    expect(normalizeMenuName('  만두  백반 ')).toBe('만두 백반');
  });
  test('null 안전', () => {
    expect(normalizeMenuName(null)).toBe('');
  });
});

describe('collectInOrderIds', () => {
  test('즐겨찾기 제외 실제 그리드 id 만', () => {
    const set = collectInOrderIds(ROWS);
    expect(set.has(1)).toBe(true); // 국수/만백 그리드
    expect(set.has(3)).toBe(true); // 만두/공기밥 그리드
    expect(set.has(2)).toBe(false); // 콩국수 — 그리드에 없음
    expect(set.has(4)).toBe(false); // 팥빙수 — 그리드에 없음
  });
  test('즐겨찾기에만 있는 건 주문 노출 아님', () => {
    const set = collectInOrderIds({ 즐겨찾기: [[99]] });
    expect(set.has(99)).toBe(false);
  });
  test('빈/이상 입력 안전', () => {
    expect(collectInOrderIds(null).size).toBe(0);
    expect(collectInOrderIds({}).size).toBe(0);
  });
});

describe('isItemInOrder', () => {
  test('그리드에 있으면 true', () => {
    expect(isItemInOrder(ROWS, 1)).toBe(true);
  });
  test('카탈로그만이면 false (시즌 종료 콩국수)', () => {
    expect(isItemInOrder(ROWS, 2)).toBe(false);
  });
});

describe('findItemByName', () => {
  test('정규화 일치로 찾음', () => {
    expect(findItemByName(ITEMS, ' 만두백반 ')?.id).toBe(3);
  });
  test('없으면 null', () => {
    expect(findItemByName(ITEMS, '없는메뉴')).toBeNull();
  });
  test('빈 이름은 null', () => {
    expect(findItemByName(ITEMS, '   ')).toBeNull();
  });
});

describe('catalogOnlyItems', () => {
  test('그리드에 없는 카탈로그 메뉴 (콩국수, 팥빙수)', () => {
    const out = catalogOnlyItems(ITEMS, ROWS).map((m) => m.id).sort();
    expect(out).toEqual([2, 4]);
  });
  test('카테고리 필터', () => {
    const out = catalogOnlyItems(ITEMS, ROWS, '국수/만백').map((m) => m.id);
    expect(out).toEqual([2]); // 콩국수만 (팥빙수는 음료)
  });
  test('모두 주문에 있으면 빈 배열', () => {
    const allInRows = {
      '국수/만백': [[1, 2, 3, 4, null, null]],
    };
    expect(catalogOnlyItems(ITEMS, allInRows)).toEqual([]);
  });
});
