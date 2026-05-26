// 메뉴 격자(rows) ↔ Firestore 호환 형식 codec.
//
// 배경 (2026-05-26 사고 진단 결과):
//   클라이언트는 격자를 nested array (array of array of int|null) 로 보관:
//     { '즐겨찾기': [[1,2,3,null,null,null], [5,6,7,8,9,10], ...], ... }
//
//   근데 Firestore 는 nested array 직접 저장 X. Firebase JS SDK 가 client-side
//   validation 으로 throw ("Nested arrays are not supported"). 옛 코드의
//   writeMenuRowsFs 가 *항상 silent fail* — menu_rows 가 결국 한 번도 정상 저장 안 됨.
//
//   영업 마비 트리거: 메뉴 추가 시 클라이언트 cache 가 어떤 식으로 sparse / 빈 데이터
//   영구 저장 → 부팅 시 그 cache emit → 화면 빈 격자.
//
// 처방:
//   nested array 를 1차원 flat array (per category, 6*4=24 길이) 로 encode 후 set.
//   listener 받으면 decode 후 nested array 로 복원. 클라이언트 코드 본체는 변경 없음.
//
// Firestore 저장 형식:
//   { '즐겨찾기': { rows: [1,2,3,null,null,null, 5,6,7,8,9,10, ...] }, ... }
//
//   v 필드 추가 (스키마 버전 향후 마이그레이션 대비) — 현재 v=1.

const GRID_COLS = 6;
const GRID_ROWS = 4;
const GRID_TOTAL = GRID_COLS * GRID_ROWS;

// nested-array rows → Firestore 호환 형식.
export function encodeMenuRows(rows) {
  if (!rows || typeof rows !== 'object' || Array.isArray(rows)) return {};
  const out = {};
  for (const cat of Object.keys(rows)) {
    const cat2D = rows[cat];
    const flat = new Array(GRID_TOTAL).fill(null);
    if (Array.isArray(cat2D)) {
      let p = 0;
      for (const row of cat2D) {
        if (!Array.isArray(row)) continue;
        for (const cell of row) {
          if (p >= GRID_TOTAL) break;
          flat[p++] = cell == null ? null : cell;
        }
        if (p >= GRID_TOTAL) break;
      }
    }
    out[cat] = { v: 1, rows: flat };
  }
  return out;
}

// Firestore 형식 → nested-array rows.
// 옛 nested-array 데이터도 호환 (혹시 어떤 매장이 우회로 저장한 경우).
export function decodeMenuRows(firestoreValue) {
  if (
    !firestoreValue ||
    typeof firestoreValue !== 'object' ||
    Array.isArray(firestoreValue)
  ) {
    return null;
  }
  const out = {};
  for (const cat of Object.keys(firestoreValue)) {
    const v = firestoreValue[cat];
    let flat = null;
    if (v && Array.isArray(v.rows)) {
      // 신규 codec 형식
      flat = v.rows.slice(0, GRID_TOTAL);
    } else if (Array.isArray(v)) {
      // 옛 nested array 형식 호환 — flatten
      const acc = [];
      for (const row of v) {
        if (Array.isArray(row)) acc.push(...row);
        else acc.push(row);
      }
      flat = acc.slice(0, GRID_TOTAL);
    } else {
      // 인식 못 함 — 빈 격자로
      flat = new Array(GRID_TOTAL).fill(null);
    }
    while (flat.length < GRID_TOTAL) flat.push(null);
    const grid = [];
    for (let r = 0; r < GRID_ROWS; r++) {
      const row = [];
      for (let c = 0; c < GRID_COLS; c++) {
        row.push(flat[r * GRID_COLS + c]);
      }
      grid.push(row);
    }
    out[cat] = grid;
  }
  return out;
}

export const MENU_GRID = { COLS: GRID_COLS, ROWS: GRID_ROWS, TOTAL: GRID_TOTAL };
