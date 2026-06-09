// 메뉴 카탈로그 ↔ 주문 노출 구분 — 순수 헬퍼.
//
// 개념 (2026-06-09 사장님 정책):
//   - 관리자 메뉴목록(items) = 시즌 전체를 담는 마스터 카탈로그. 모든 메뉴가 잔류.
//   - 주문 탭 = 현재 운영 중인 부분집합 = 카테고리 그리드(rows, 즐겨찾기 제외)에 올라온 것.
//   - 시즌 종료(겨울 콩국수) = 그리드에서 빼되 items 엔 남김 → 주문엔 안 보이고 카탈로그엔 잔류.
//   - 시즌 시작(여름 콩국수) = 카탈로그에서 그리드로 올림.
//   - 주문 신규 추가 시 같은 이름이 카탈로그에 있으면 새로 만들지 말고 그걸 불러오기(중복 방지).

// 이름 정규화 — 중복 판정용. 앞뒤 공백 제거 + 내부 공백 압축. (대소문자는 한글 위주라 무의미)
export function normalizeMenuName(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ');
}

// 즐겨찾기 제외한 실제 카테고리 그리드에 올라온 menu id 집합 = "주문에 노출 중".
export function collectInOrderIds(rows) {
  const set = new Set();
  if (!rows || typeof rows !== 'object') return set;
  for (const cat of Object.keys(rows)) {
    if (cat === '즐겨찾기') continue;
    const grid = rows[cat];
    if (!Array.isArray(grid)) continue;
    for (const row of grid) {
      if (!Array.isArray(row)) continue;
      for (const id of row) {
        if (id != null) set.add(id);
      }
    }
  }
  return set;
}

export function isItemInOrder(rows, id) {
  if (id == null) return false;
  return collectInOrderIds(rows).has(id);
}

// 이름이 같은 카탈로그 메뉴 찾기 (정규화 일치). 중복 등록 방지 + 불러오기 후보.
export function findItemByName(items, name) {
  const target = normalizeMenuName(name);
  if (!target) return null;
  const list = Array.isArray(items) ? items : [];
  return (
    list.find((m) => m && normalizeMenuName(m.name) === target) || null
  );
}

// 카탈로그에는 있지만 주문(그리드)엔 없는 메뉴 = 시즌 종료/대기 중. 불러오기 picker 용.
//   onlyCategory 주면 그 category 필드의 항목만 (탭별 추천).
export function catalogOnlyItems(items, rows, onlyCategory) {
  const inOrder = collectInOrderIds(rows);
  const list = Array.isArray(items) ? items : [];
  return list.filter((m) => {
    if (!m || m.id == null) return false;
    if (inOrder.has(m.id)) return false;
    if (onlyCategory && m.category !== onlyCategory) return false;
    return true;
  });
}
