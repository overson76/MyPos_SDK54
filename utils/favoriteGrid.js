// 즐겨찾기 격자 (6열 × 4행 = 24슬롯) 조작 헬퍼.
//
// 배경 (2026-05-26 ④ UX 개선):
//   사장님 요청 — 관리자 → 메뉴 관리에서 ☆ 즐겨찾기 클릭 시 즐겨찾기 화면(격자) 이
//   바로 보이고, 박을 위치를 클릭하면 그 자리에 박힘. 옛 UX(자동 다음 빈 슬롯 + ▲▼
//   위치 이동 + "9/24" 표시) 는 직관적이지 않다는 사장님 지적.
//
// 함수:
//   - placeIdInFavoriteGrid(grid, id, flatIdx) — 격자의 flatIdx 자리에 id 박음.
//     id 가 이미 다른 자리에 있으면 그 자리 비움 (중복 방지). 그 자리에 다른 id 가
//     있었으면 *그 id 는 즐겨찾기에서 제거* (사장님 의도 = 자리 강제 박기).
//   - removeIdFromFavoriteGrid(grid, id) — id 를 격자에서 제거 (null 슬롯으로).
//   - findIdSlotInGrid(grid, id) — id 가 있는 flatIdx 반환 (없으면 -1).

const FAV_COLS = 6;
const FAV_ROWS = 4;
const FAV_TOTAL = FAV_COLS * FAV_ROWS;

function flattenAndPad(grid2D) {
  const flat = [];
  for (const row of grid2D || []) {
    if (Array.isArray(row)) flat.push(...row);
  }
  while (flat.length < FAV_TOTAL) flat.push(null);
  return flat.slice(0, FAV_TOTAL);
}

function rebuildGrid(flat) {
  const out = [];
  for (let r = 0; r < FAV_ROWS; r++) {
    out.push(flat.slice(r * FAV_COLS, (r + 1) * FAV_COLS));
  }
  return out;
}

export function placeIdInFavoriteGrid(grid2D, id, flatIdx) {
  if (id == null) return grid2D;
  if (flatIdx < 0 || flatIdx >= FAV_TOTAL) return grid2D;
  const flat = flattenAndPad(grid2D);
  const existingIdx = flat.indexOf(id);
  if (existingIdx >= 0 && existingIdx !== flatIdx) {
    flat[existingIdx] = null;
  }
  flat[flatIdx] = id;
  return rebuildGrid(flat);
}

export function removeIdFromFavoriteGrid(grid2D, id) {
  if (id == null) return grid2D;
  const flat = flattenAndPad(grid2D);
  const idx = flat.indexOf(id);
  if (idx >= 0) {
    flat[idx] = null;
    return rebuildGrid(flat);
  }
  return grid2D;
}

export function findIdSlotInGrid(grid2D, id) {
  if (id == null) return -1;
  const flat = flattenAndPad(grid2D);
  return flat.indexOf(id);
}

export const FAVORITE_GRID = {
  COLS: FAV_COLS,
  ROWS: FAV_ROWS,
  TOTAL: FAV_TOTAL,
};
