// 메뉴 카탈로그 합치기 — default(코드 내장) + Firestore(매장 customize/신규).
//
// 배경 (2026-05-26 사고 회고):
//   MenuContext listener 가 Firestore list 로 setItems 통째 덮어쓰던 옛 동작은
//   사장님 매장처럼 Firestore menu collection 이 거의 비어있는 매장에서 default
//   메뉴를 다 사라지게 했다 (들깨칼제비 추가 시 Firestore = [들깨칼제비] 하나만
//   남아 setItems([들깨칼제비]) → 화면 default 12개 메뉴 증발).
//
// 처방:
//   - default 를 baseline 으로 항상 유지.
//   - Firestore 가 같은 id 를 들고 있으면 그게 customize 우선 (가격/이름/이미지/카테
//     고리 변경 등). spread merge: { ...def, ...fs } — fs 가 후승.
//   - Firestore 에만 있는 id (신규 메뉴 — 들깨칼제비 같은 케이스) 는 뒤에 append.
//
// 트레이드오프:
//   사용자가 default 메뉴를 의도적으로 *삭제* 할 수는 없다 (다음 부팅 시 default 다시
//   살아남). 사장님 매장은 default 메뉴 삭제 흔적 없음 — 안전. 향후 명시적 "default
//   삭제" 가 필요해지면 deletedDefaultIds marker collection 추가하는 옵션 C 로 확장.

export function mergeMenuItems(defaults, fromFirestore) {
  const safeDefaults = Array.isArray(defaults) ? defaults : [];
  const safeFs = Array.isArray(fromFirestore) ? fromFirestore : [];

  const fsById = new Map();
  for (const m of safeFs) {
    if (m && m.id != null) fsById.set(m.id, m);
  }

  const merged = [];
  const seen = new Set();
  for (const def of safeDefaults) {
    if (def == null || def.id == null) continue;
    if (fsById.has(def.id)) {
      merged.push({ ...def, ...fsById.get(def.id) });
    } else {
      merged.push(def);
    }
    seen.add(def.id);
  }
  for (const m of safeFs) {
    if (!m || m.id == null) continue;
    if (seen.has(m.id)) continue;
    merged.push(m);
    seen.add(m.id);
  }
  return merged;
}
