import { reconcileRowsWithDefaults } from '../utils/menuRowsReconcile';

// 작은 테스트용 default — defaultCategoryRows 와 동일 구조 (6×4 격자)
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
    expect(Object.keys(rows).sort()).toEqual([...CATS].sort());
    expect(rows['즐겨찾기'][0][0]).toBe(1);
    expect(rows['국수/만백'][0][4]).toBe(5);
    expect(rows['음료'][0][1]).toBe(25);
  });

  test('null 입력 → 모든 카테고리 default 복원', () => {
    const { rows, recovered } = reconcileRowsWithDefaults(null, DEFAULTS, CATS);
    expect(recovered).toBe(true);
    expect(rows['즐겨찾기']).toBeDefined();
    expect(rows['국수/만백']).toBeDefined();
    expect(rows['음료']).toBeDefined();
  });

  test('Array 입력 (잘못된 타입) → default 로 복원', () => {
    const { rows, recovered } = reconcileRowsWithDefaults(
      [1, 2, 3],
      DEFAULTS,
      CATS
    );
    expect(recovered).toBe(true);
    expect(rows['국수/만백'][0][0]).toBe(1);
  });

  test('일부 카테고리만 포함 → 누락분만 default 복원 + recovered=true', () => {
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
    expect(rows['즐겨찾기'][0][0]).toBe(99); // 사용자 배치 보존
    expect(rows['국수/만백'][0][0]).toBe(1); // default 로 복원
    expect(rows['음료'][0][0]).toBe(24); // default 로 복원
  });

  test('모든 카테고리 포함 → recovered=false + 그대로 통과', () => {
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
      '음료': emptyGrid(),
    };
    const { rows, recovered } = reconcileRowsWithDefaults(input, DEFAULTS, CATS);
    expect(recovered).toBe(false);
    expect(rows['즐겨찾기'][0][0]).toBe(10);
    expect(rows['국수/만백'][0][1]).toBe(21);
    expect(rows['음료'][0][0]).toBe(null);
  });

  test('sparse 배열 (격자 모양 아님) → 6×4 로 gridify', () => {
    const input = {
      '즐겨찾기': [[100, 101], [102]], // 2행 2칸 / 1칸
      '국수/만백': emptyGrid(),
      '음료': emptyGrid(),
    };
    const { rows } = reconcileRowsWithDefaults(input, DEFAULTS, CATS);
    expect(rows['즐겨찾기']).toHaveLength(4);
    rows['즐겨찾기'].forEach((row) => expect(row).toHaveLength(6));
    expect(rows['즐겨찾기'][0][0]).toBe(100);
    expect(rows['즐겨찾기'][0][1]).toBe(101);
    expect(rows['즐겨찾기'][0][2]).toBe(102);
  });

  test('카테고리 값이 배열 아닌 객체/숫자 → default 복원', () => {
    const input = {
      '즐겨찾기': { weird: true },
      '국수/만백': 42,
      '음료': emptyGrid(),
    };
    const { rows, recovered } = reconcileRowsWithDefaults(input, DEFAULTS, CATS);
    expect(recovered).toBe(true);
    expect(rows['즐겨찾기'][0][0]).toBe(1); // default
    expect(rows['국수/만백'][0][0]).toBe(1); // default
  });

  test('categoryList 외 사용자 정의 카테고리 → 보존', () => {
    const input = {
      '즐겨찾기': emptyGrid(),
      '국수/만백': emptyGrid(),
      '음료': emptyGrid(),
      '새카테고리': [[200, null, null, null, null, null]],
    };
    const { rows } = reconcileRowsWithDefaults(input, DEFAULTS, CATS);
    expect(rows['새카테고리']).toBeDefined();
    expect(rows['새카테고리'][0][0]).toBe(200);
  });

  test('categoryList 미지정 → defaults 키 사용', () => {
    const { rows } = reconcileRowsWithDefaults({}, DEFAULTS);
    expect(Object.keys(rows).sort()).toEqual([...CATS].sort());
  });

  test('회귀 시나리오: 사장님 사고 케이스 — Firestore 가 { value: {} } 로 저장됨', () => {
    // 어제 사고: addNewItemAt 흐름이 빈 rowsRef 로 시작 →
    // 그 카테고리만 추가한 sparse 데이터가 Firestore 에 저장됨.
    const corrupted = {
      '국수/만백': [
        [26, null, null, null, null, null], // 사장님이 추가한 새 메뉴 ID 26
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
    // 사장님 추가 메뉴는 보존
    expect(rows['국수/만백'][0][0]).toBe(26);
    // 다른 카테고리는 default 로 복원
    expect(rows['즐겨찾기'][0][0]).toBe(1);
    expect(rows['음료'][0][0]).toBe(24);
  });
});
