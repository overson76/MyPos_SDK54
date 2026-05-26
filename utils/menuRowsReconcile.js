// 메뉴 격자 (rows) 데이터의 self-healing 헬퍼.
//
// 배경 (2026-05-26 사고):
//   메뉴 추가 시 클라이언트 cache 가 빈/sparse 데이터로 오염될 수 있고, 그 데이터가
//   listener emission 으로 들어와 모든 카테고리 격자가 사라지는 사고 발생.
//
// 처방:
//   listener / mutation 양쪽에서 reconcileRowsWithDefaults() 거치고,
//   누락된 카테고리는 defaultCategoryRows 에서 채우고, 격자가 모두 null 인 카테고리도
//   default 로 복원. 사용자가 의도적으로 카테고리 통째 비울 일은 없으므로 자동 복원이
//   안전하다.

const GRID_COLS = 6;
const GRID_ROWS = 4;
const GRID_TOTAL = GRID_COLS * GRID_ROWS;

function gridifyCategory(catRows) {
  const src = catRows || [];
  const alreadyGrid =
    src.length === GRID_ROWS &&
    src.every((r) => Array.isArray(r) && r.length === GRID_COLS);
  if (alreadyGrid) {
    return src.map((row) => [...row]);
  }
  const flat = [].concat(...src.filter(Array.isArray));
  const grid = new Array(GRID_TOTAL).fill(null);
  let p = 0;
  for (let i = 0; i < flat.length && p < GRID_TOTAL; i++) {
    const v = flat[i];
    if (v != null) grid[p++] = v;
  }
  const rebuilt = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    rebuilt.push(grid.slice(r * GRID_COLS, (r + 1) * GRID_COLS));
  }
  return rebuilt;
}

function cloneCategory(catRows) {
  return (catRows || []).map((row) => [...(Array.isArray(row) ? row : [])]);
}

function isAllNullGrid(grid) {
  if (!Array.isArray(grid) || grid.length === 0) return true;
  for (const row of grid) {
    if (!Array.isArray(row)) continue;
    for (const cell of row) {
      if (cell != null) return false;
    }
  }
  return true;
}

// 누락된 카테고리 + 격자 모두 null 인 카테고리는 defaults 에서 복원.
// 반환: { rows, recovered } — recovered=true 면 복원 발생 (Firestore 도 다시 써야 영구 청소).
export function reconcileRowsWithDefaults(input, defaults, categoryList) {
  const safeInput =
    input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const safeDefaults =
    defaults && typeof defaults === 'object' && !Array.isArray(defaults)
      ? defaults
      : {};
  const cats =
    Array.isArray(categoryList) && categoryList.length > 0
      ? categoryList
      : Object.keys(safeDefaults);

  const out = {};
  let recovered = false;
  for (const cat of cats) {
    const present = Array.isArray(safeInput[cat]);
    if (present) {
      const grid = gridifyCategory(safeInput[cat]);
      if (isAllNullGrid(grid)) {
        const def = safeDefaults[cat];
        if (def) {
          out[cat] = gridifyCategory(cloneCategory(def));
          recovered = true;
        } else {
          out[cat] = grid;
        }
      } else {
        out[cat] = grid;
      }
    } else {
      const def = safeDefaults[cat];
      out[cat] = gridifyCategory(cloneCategory(def));
      recovered = true;
    }
  }
  for (const cat of Object.keys(safeInput)) {
    if (cats.includes(cat)) continue;
    if (Array.isArray(safeInput[cat])) {
      out[cat] = gridifyCategory(safeInput[cat]);
    }
  }
  return { rows: out, recovered };
}
