import { reconcileRowsWithDefaults } from '../utils/menuRowsReconcile';

const CATS = ['즐겨찾기', '국수/만백', '음료'];

function emptyGrid() {
  return [
    [null, null, null, null, null, null],
    [null, null, null, null, null, null],
    [null, null, null, null, null, null],
    [null, null, null, null, null, null],
  ];
}

const DEFAULTS = {
  '즐겨찾기': [
    [1, 2, 3, null, null, null],
    [null, null, null, null, null, null],
    [null, null, null, null, null, null],
    [null, null, null, null, null, null],
  ],
  '국수/만백': [
    [1, 2, 3, 4, 5, null],
    [null, null, null, null, null, null],
    [null, null, null, null, null, null],
    [null, null, null, null, null, null],
  ],
  '음료': [
    [24, 25, null, null, null, null],
    [null, null, null, null, null, null],
    [null, null, null, null, null, null],
    [null, null, null, null, null, null],
  ],
};

describe('reconcileRowsWithDefaults', () => {
  test('빈 객체 입력 → 모든 카테고리 default 복원 + recovered=true', () => {
    const { rows, recovered } = reconcileRowsWithDefaults({}, DEFAULTS, CATS);
    expect(recovered).toBe(true);
    expect(rows['즐겨찾기'][0][0]).toBe(1);
    expect(rows['국수/만백'][0][4]).toBe(5);
    expect(rows['음료'][0][1]).toBe(25);
  });

  test('null 입력 → 모든 카테고리 default 복원', () => {
    const { rows, recovered } = reconcileRowsWithDefaults(null, DEFAULTS, CATS);
    expect(recovered).toBe(true);
    expect(rows['즐겨찾기']).toBeDefined();
  });

  test('일부 카테고리 누락 → 누락분 default 복원', () => {
    const input = {
      '즐겨찾기': [
        [99, null, null, null, null, null],
        [null, null, null, null, null, null],
        [null, null, null, null, null, null],
        [null, null, null, null, null, null],
      ],
    };
    const { rows, recovered } = reconcileRowsWithDefaults(input, DEFAULTS, CATS);
    expect(recovered).toBe(true);
    expect(rows['즐겨찾기'][0][0]).toBe(99);
    expect(rows['국수/만백'][0][0]).toBe(1);
    expect(rows['음료'][0][0]).toBe(24);
  });

  test('카테고리 키 있고 격자 모두 null → default 복원 (사고 시나리오)', () => {
    const input = {
      '즐겨찾기': emptyGrid(),
      '국수/만백': emptyGrid(),
      '음료': emptyGrid(),
    };
    const { rows, recovered } = reconcileRowsWithDefaults(input, DEFAULTS, CATS);
    expect(recovered).toBe(true);
    expect(rows['즐겨찾기'][0][0]).toBe(1);
    expect(rows['국수/만백'][0][4]).toBe(5);
  });

  test('모든 카테고리 메뉴 있음 → recovered=false + 그대로', () => {
    const input = {
      '즐겨찾기': [
        [10, 11, 12, null, null, null],
        [null, null, null, null, null, null],
        [null, null, null, null, null, null],
        [null, null, null, null, null, null],
      ],
      '국수/만백': [
        [20, 21, null, null, null, null],
        [null, null, null, null, null, null],
        [null, null, null, null, null, null],
        [null, null, null, null, null, null],
      ],
      '음료': [
        [30, null, null, null, null, null],
        [null, null, null, null, null, null],
        [null, null, null, null, null, null],
        [null, null, null, null, null, null],
      ],
    };
    const { rows, recovered } = reconcileRowsWithDefaults(input, DEFAULTS, CATS);
    expect(recovered).toBe(false);
    expect(rows['즐겨찾기'][0][0]).toBe(10);
  });

  test('회귀 — 사장님 사고 케이스 (sparse 데이터 후 자동 복원)', () => {
    const corrupted = {
      '국수/만백': [
        [26, null, null, null, null, null],
        [null, null, null, null, null, null],
        [null, null, null, null, null, null],
        [null, null, null, null, null, null],
      ],
    };
    const { rows, recovered } = reconcileRowsWithDefaults(
      corrupted,
      DEFAULTS,
      CATS
    );
    expect(recovered).toBe(true);
    expect(rows['국수/만백'][0][0]).toBe(26); // 사장님 추가 보존
    expect(rows['즐겨찾기'][0][0]).toBe(1); // default 복원
    expect(rows['음료'][0][0]).toBe(24); // default 복원
  });
});
