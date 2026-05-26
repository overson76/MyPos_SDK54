// 메뉴 격자 (rows) 데이터의 자기 복원 (self-healing) 헬퍼.
//
// 배경 (2026-05-26 사고):
//   - Firestore stores/{storeId}/state/menu_rows 가 어떤 경로로 빈 객체 `{}` 또는
//     일부 카테고리만 포함한 sparse 데이터로 저장될 수 있다.
//   - MenuContext listener 가 그대로 setRows(빈 객체) 호출 → rowsRef.current = {}.
//   - 그 상태에서 addNewItem / addNewItemAt mutation 호출되면
//     cloneRows({}) = {} → 그 카테고리만 추가 → Firestore 에도 sparse 데이터 저장.
//   - 결과: 모든 기기의 격자가 빈 상태로 동기화 → 영업 중 메뉴 클릭 자체가 불가.
//
// 처방:
//   - listener 와 mutation 양쪽에서 reconcileRowsWithDefaults() 를 통과시켜
//     누락된 카테고리는 defaultCategoryRows 에서 채우고,
//     기존 사용자 배치는 그대로 보존한다.
//   - "사장님이 의도적으로 모든 카테고리를 비웠다" 시나리오는 사실상 없으므로
//     누락 = 데이터 손상으로 간주하고 자동 복원이 안전하다.

const GRID_COLS = 6;
const GRID_ROWS = 4;
const GRID_TOTAL = GRID_COLS * GRID_ROWS;

// 단일 카테고리 배열을 GRID_ROWS × GRID_COLS 고정 격자로 정규화.
// MenuContext.js 의 gridifyCategory 와 동일 동작 — 모듈 간 의존성 피하려 복제.
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
    if (v != null) {
      grid[p++] = v;
    }
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

// 누락된 카테고리는 defaults 에서 채워서 반환. 기존 카테고리는 그대로 (gridify 만 적용).
// 카테고리 키 목록(categoryList) 이 주어지면 그 순서로 정렬된 객체 반환.
//
// 반환: { rows, recovered } — rows = 복원된 격자, recovered = 누락이 발견되어 채워졌는지.
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
      out[cat] = gridifyCategory(safeInput[cat]);
    } else {
      const def = safeDefaults[cat];
      out[cat] = gridifyCategory(cloneCategory(def));
      recovered = true;
    }
  }
  // input 에 categoryList 외의 사용자 정의 카테고리가 있으면 보존 (gridify 만)
  for (const cat of Object.keys(safeInput)) {
    if (cats.includes(cat)) continue;
    if (Array.isArray(safeInput[cat])) {
      out[cat] = gridifyCategory(safeInput[cat]);
    }
  }
  return { rows: out, recovered };
}
