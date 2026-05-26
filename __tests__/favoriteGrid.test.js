import {
  placeIdInFavoriteGrid,
  removeIdFromFavoriteGrid,
  findIdSlotInGrid,
  FAVORITE_GRID,
} from '../utils/favoriteGrid';

function emptyGrid() {
  const g = [];
  for (let r = 0; r < FAVORITE_GRID.ROWS; r++) {
    g.push(new Array(FAVORITE_GRID.COLS).fill(null));
  }
  return g;
}

function flatten(g) {
  return [].concat(...g);
}

describe('favoriteGrid — 즐겨찾기 격자 조작 (2026-05-26 ④ UX)', () => {
  test('FAVORITE_GRID 상수 = 6×4 = 24', () => {
    expect(FAVORITE_GRID.COLS).toBe(6);
    expect(FAVORITE_GRID.ROWS).toBe(4);
    expect(FAVORITE_GRID.TOTAL).toBe(24);
  });

  describe('placeIdInFavoriteGrid', () => {
    test('빈 격자의 0번 슬롯에 박기', () => {
      const out = placeIdInFavoriteGrid(emptyGrid(), 17, 0);
      expect(flatten(out)[0]).toBe(17);
      expect(flatten(out).filter((v) => v != null)).toEqual([17]);
    });

    test('빈 격자의 7번 슬롯 (2행 2칸) 에 박기', () => {
      const out = placeIdInFavoriteGrid(emptyGrid(), 17, 7);
      const flat = flatten(out);
      expect(flat[7]).toBe(17);
      expect(flat.filter((v) => v != null)).toEqual([17]);
    });

    test('이미 다른 메뉴 있는 슬롯에 박기 → 옛 메뉴 즐겨찾기에서 제거 (사장님 의도 = 자리 강제)', () => {
      const g = emptyGrid();
      g[0][3] = 5; // id:5 가 3번 슬롯에
      const out = placeIdInFavoriteGrid(g, 17, 3);
      const flat = flatten(out);
      expect(flat[3]).toBe(17);
      expect(flat.indexOf(5)).toBe(-1); // 5 는 즐겨찾기에서 빠짐
    });

    test('id 가 이미 다른 슬롯에 있을 때 → 옛 슬롯 비우고 새 슬롯에 박음 (중복 방지)', () => {
      const g = emptyGrid();
      g[0][5] = 17; // 17 이 5번 슬롯에
      const out = placeIdInFavoriteGrid(g, 17, 10);
      const flat = flatten(out);
      expect(flat[5]).toBe(null); // 옛 자리 비움
      expect(flat[10]).toBe(17); // 새 자리에
      expect(flat.filter((v) => v === 17)).toHaveLength(1); // 중복 없음
    });

    test('같은 슬롯에 같은 id 박기 → 변화 없음', () => {
      const g = emptyGrid();
      g[1][2] = 17; // flatIdx = 8
      const out = placeIdInFavoriteGrid(g, 17, 8);
      expect(flatten(out)[8]).toBe(17);
      expect(flatten(out).filter((v) => v === 17)).toHaveLength(1);
    });

    test('id null → 변화 없음', () => {
      const g = emptyGrid();
      expect(placeIdInFavoriteGrid(g, null, 0)).toBe(g);
    });

    test('flatIdx 범위 초과 → 변화 없음', () => {
      const g = emptyGrid();
      expect(placeIdInFavoriteGrid(g, 17, -1)).toBe(g);
      expect(placeIdInFavoriteGrid(g, 17, 24)).toBe(g);
      expect(placeIdInFavoriteGrid(g, 17, 100)).toBe(g);
    });

    test('격자가 부분적으로 sparse 해도 정상 (빈 행 padding)', () => {
      const sparse = [[1, 2, 3]]; // 1행 3칸만
      const out = placeIdInFavoriteGrid(sparse, 17, 5);
      const flat = flatten(out);
      expect(out.length).toBe(4); // 4행
      expect(out[0].length).toBe(6); // 6칸
      expect(flat[0]).toBe(1);
      expect(flat[1]).toBe(2);
      expect(flat[2]).toBe(3);
      expect(flat[5]).toBe(17);
    });
  });

  describe('removeIdFromFavoriteGrid', () => {
    test('있는 id 제거', () => {
      const g = emptyGrid();
      g[2][3] = 17; // flatIdx = 15
      const out = removeIdFromFavoriteGrid(g, 17);
      const flat = flatten(out);
      expect(flat[15]).toBe(null);
      expect(flat.indexOf(17)).toBe(-1);
    });

    test('없는 id 제거 → 변화 없음', () => {
      const g = emptyGrid();
      g[0][0] = 5;
      const out = removeIdFromFavoriteGrid(g, 99);
      expect(out).toBe(g);
    });

    test('id null → 변화 없음', () => {
      const g = emptyGrid();
      expect(removeIdFromFavoriteGrid(g, null)).toBe(g);
    });
  });

  describe('findIdSlotInGrid', () => {
    test('있는 id 위치 반환', () => {
      const g = emptyGrid();
      g[1][3] = 17; // flatIdx = 9
      expect(findIdSlotInGrid(g, 17)).toBe(9);
    });

    test('없는 id → -1', () => {
      const g = emptyGrid();
      expect(findIdSlotInGrid(g, 99)).toBe(-1);
    });

    test('id null → -1', () => {
      expect(findIdSlotInGrid(emptyGrid(), null)).toBe(-1);
    });

    test('첫 번째 등장만 반환 (중복 방지된 격자라 정상)', () => {
      const g = emptyGrid();
      g[0][2] = 17;
      g[2][4] = 17; // 이론상 중복 안 생기지만
      expect(findIdSlotInGrid(g, 17)).toBe(2); // 첫 등장
    });
  });

  test('placeIdInFavoriteGrid + findIdSlotInGrid 라운드트립', () => {
    const g = emptyGrid();
    const out = placeIdInFavoriteGrid(g, 17, 13);
    expect(findIdSlotInGrid(out, 17)).toBe(13);
  });

  test('placeIdInFavoriteGrid → removeIdFromFavoriteGrid 로 원상복귀', () => {
    const g = emptyGrid();
    const placed = placeIdInFavoriteGrid(g, 17, 5);
    const removed = removeIdFromFavoriteGrid(placed, 17);
    const flat = flatten(removed);
    expect(flat.every((v) => v == null)).toBe(true);
  });
});
