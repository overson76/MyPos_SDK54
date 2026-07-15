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
// 2026-07-15 옵션 C 도입 (사장님 신고 "지웠는데 다시 나타난다"):
//   deleteItem 이 Firestore 문서를 실제 삭제하면, default 메뉴는 이 합치기가 코드
//   내장 baseline 으로 즉시 되살렸다 — 삭제가 구조적으로 불가능했던 트레이드오프가
//   실제 사고가 됨. 이제 삭제는 { deleted: true } 표식(tombstone) 문서로 남고,
//   표식된 id 는 deletedIds 로 넘어와 default 에서도 제외한다. 같은 id 로 메뉴를
//   다시 만들면 full set 이 표식을 덮어 자연 부활 (주소록 휴지통 6/12 와 동일 패턴).

// 단일 메뉴 update 시 Firestore 에 *전체* item 으로 쓰기 위한 합치기.
//
// 배경 (2026-05-26 사고 회고 — 가격 수정 안 먹힘):
//   updateItem 이 partial fields (예: { price: 9000 }) 만 writeMenuItemFs 에 전달하면
//   set merge:true 로 Firestore doc 에 `{ price: 9000 }` 만 저장 (id / name 없이).
//   listener 의 filter `(m) => m.id != null` 에서 그 doc 이 빠짐 → mergeMenuItems 가
//   default 만 사용 → 사장님 customize 가 listener emit 으로 즉시 default 로 원복.
//
// 처방:
//   write 직전에 default + 현재 + partial 합쳐서 전체 item 으로 set. id 보장 (마지막 스프레드
//   로 강제) — partial 에 id 가 들어와도, default 가 없어도 docId 와 일관성 유지.
export function mergeItemForWrite(id, partial, currentItems, defaults) {
  const current =
    (Array.isArray(currentItems) ? currentItems : []).find(
      (m) => m && m.id === id
    ) || null;
  const defaultItem =
    (Array.isArray(defaults) ? defaults : []).find((m) => m && m.id === id) ||
    null;
  return {
    ...(defaultItem || {}),
    ...(current || {}),
    ...(partial || {}),
    id,
  };
}

export function mergeMenuItems(defaults, fromFirestore, deletedIds) {
  const safeDefaults = Array.isArray(defaults) ? defaults : [];
  const safeFs = Array.isArray(fromFirestore) ? fromFirestore : [];
  const deleted =
    deletedIds instanceof Set
      ? deletedIds
      : new Set(Array.isArray(deletedIds) ? deletedIds : []);

  const fsById = new Map();
  for (const m of safeFs) {
    if (m && m.id != null) fsById.set(m.id, m);
  }

  const merged = [];
  const seen = new Set();
  for (const def of safeDefaults) {
    if (def == null || def.id == null) continue;
    if (deleted.has(def.id)) {
      seen.add(def.id); // 삭제 표식 — default 부활 금지
      continue;
    }
    if (fsById.has(def.id)) {
      merged.push({ ...def, ...fsById.get(def.id) });
    } else {
      merged.push(def);
    }
    seen.add(def.id);
  }
  for (const m of safeFs) {
    if (!m || m.id == null) continue;
    if (seen.has(m.id) || deleted.has(m.id)) continue;
    merged.push(m);
    seen.add(m.id);
  }
  return merged;
}
