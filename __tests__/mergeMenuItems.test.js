import { mergeMenuItems, mergeItemForWrite } from '../utils/mergeMenuItems';

const DEFAULTS = [
  { id: 1, name: '칼국수', price: 7000, category: '국수/만백' },
  { id: 2, name: '수제비', price: 7000, category: '국수/만백' },
  { id: 3, name: '칼제비', price: 7000, category: '국수/만백' },
];

describe('mergeMenuItems — default + Firestore 합치기 (2026-05-26 사고 영구 처방)', () => {
  test('Firestore 비어있음 → default 그대로', () => {
    const out = mergeMenuItems(DEFAULTS, []);
    expect(out).toHaveLength(3);
    expect(out.map((m) => m.id)).toEqual([1, 2, 3]);
    expect(out[0].name).toBe('칼국수');
  });

  test('Firestore null/undefined → default 그대로 (사장님 매장 사고 직전 상태)', () => {
    expect(mergeMenuItems(DEFAULTS, null)).toHaveLength(3);
    expect(mergeMenuItems(DEFAULTS, undefined)).toHaveLength(3);
  });

  test('Firestore 의 같은 id = customize 우선 (가격/이름 override)', () => {
    const fs = [{ id: 2, name: '수제비(특)', price: 9000, category: '국수/만백' }];
    const out = mergeMenuItems(DEFAULTS, fs);
    expect(out).toHaveLength(3);
    const m2 = out.find((m) => m.id === 2);
    expect(m2.name).toBe('수제비(특)');
    expect(m2.price).toBe(9000);
    // 다른 default 는 그대로
    expect(out.find((m) => m.id === 1).name).toBe('칼국수');
  });

  test('Firestore 신규 id (들깨칼제비 시나리오) → append 합쳐짐', () => {
    const fs = [{ id: 26, name: '들깨칼제비', price: 8000, category: '국수/만백' }];
    const out = mergeMenuItems(DEFAULTS, fs);
    expect(out).toHaveLength(4);
    expect(out.map((m) => m.id)).toEqual([1, 2, 3, 26]);
    expect(out[3].name).toBe('들깨칼제비');
  });

  test('Firestore = [신규 1개] 만 있을 때 default 사라지지 않음 (사고 영구 처방 핵심)', () => {
    // 옛 동작: setItems([들깨칼제비]) → default 12개 사라짐 → 사고
    // 새 동작: setItems(default + 들깨칼제비) → 영업 정상
    const fs = [{ id: 26, name: '들깨칼제비', price: 8000 }];
    const out = mergeMenuItems(DEFAULTS, fs);
    expect(out).toHaveLength(4);
    expect(out.some((m) => m.id === 1)).toBe(true);
    expect(out.some((m) => m.id === 26)).toBe(true);
  });

  test('Firestore = override + 신규 동시', () => {
    const fs = [
      { id: 1, name: '칼국수(시그니처)', price: 8500 }, // override
      { id: 26, name: '들깨칼제비', price: 8000 },       // 신규
    ];
    const out = mergeMenuItems(DEFAULTS, fs);
    expect(out).toHaveLength(4);
    expect(out.find((m) => m.id === 1).name).toBe('칼국수(시그니처)');
    expect(out.find((m) => m.id === 1).price).toBe(8500);
    expect(out.find((m) => m.id === 26).name).toBe('들깨칼제비');
  });

  test('Firestore 의 깨진 doc (id 없음) 필터', () => {
    const fs = [
      { id: 26, name: '들깨칼제비' },
      { price: 11000 }, // id 없음 — 깨진 doc
      null,
      undefined,
    ];
    const out = mergeMenuItems(DEFAULTS, fs);
    expect(out).toHaveLength(4); // 3 default + 1 신규
    expect(out.find((m) => m.id === 26)).toBeTruthy();
  });

  test('순서 보장 — default 순서 → Firestore 신규 추가 순서', () => {
    const fs = [
      { id: 30, name: 'B' },
      { id: 26, name: 'A' },
    ];
    const out = mergeMenuItems(DEFAULTS, fs);
    expect(out.map((m) => m.id)).toEqual([1, 2, 3, 30, 26]);
  });

  test('default 와 Firestore 의 같은 id 가 여러 필드 customize → spread merge 정확', () => {
    const def = { id: 5, name: '만두', price: 5000, category: '만두/공기밥', color: '#999', image: 'a.jpg' };
    const fs = { id: 5, name: '왕만두', price: 6000 }; // 이름/가격만 변경, color/image 유지
    const out = mergeMenuItems([def], [fs]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      id: 5,
      name: '왕만두',          // FS override
      price: 6000,              // FS override
      category: '만두/공기밥', // default 유지
      color: '#999',           // default 유지
      image: 'a.jpg',          // default 유지
    });
  });

  test('defaults 빈 배열 → Firestore 만 남음', () => {
    const fs = [{ id: 100, name: '신규' }];
    expect(mergeMenuItems([], fs)).toEqual([{ id: 100, name: '신규' }]);
  });

  test('둘 다 빈 배열 → 빈 결과', () => {
    expect(mergeMenuItems([], [])).toEqual([]);
  });

  test('Firestore 같은 id 중복 → 첫 등장만 적용 (그 외 무시)', () => {
    const fs = [
      { id: 26, name: '첫번째' },
      { id: 26, name: '두번째' },
    ];
    const out = mergeMenuItems([], fs);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('첫번째');
  });
});

describe('mergeItemForWrite — 단일 item update 시 전체 item 으로 set (가격 수정 사고 영구 처방)', () => {
  const DEFAULTS = [
    { id: 17, name: '콩국수', shortName: '콩국수', price: 8000, color: '#EEE9D5', category: '국수/만백', image: '', sizeGroup: 'deulpatkong' },
    { id: 1, name: '칼국수', shortName: '칼', price: 7000, category: '국수/만백' },
  ];

  test('default 만 있고 current 없음 → default + partial', () => {
    const out = mergeItemForWrite(17, { price: 9000 }, [], DEFAULTS);
    expect(out.id).toBe(17);
    expect(out.name).toBe('콩국수');           // default 에서
    expect(out.price).toBe(9000);              // partial override
    expect(out.category).toBe('국수/만백');    // default 에서
    expect(out.color).toBe('#EEE9D5');         // default 에서
  });

  test('current 우선 적용 (default → current → partial 순으로 spread)', () => {
    const current = [
      { id: 17, name: '콩국수(시그)', price: 8500, category: '국수/만백', favorite: true },
    ];
    const out = mergeItemForWrite(17, { price: 9000 }, current, DEFAULTS);
    expect(out.id).toBe(17);
    expect(out.name).toBe('콩국수(시그)');   // current override
    expect(out.price).toBe(9000);              // partial override (current price 보다 더 후승)
    expect(out.favorite).toBe(true);           // current 보존
    expect(out.color).toBe('#EEE9D5');         // default 보존
  });

  test('가격 수정 회귀 시나리오 — Firestore 에 id 포함된 전체 item 저장 보장', () => {
    // 옛 사고: writeMenuItemFs(17, {price:9000}) → Firestore doc = {price:9000} → listener filter 에서 빠짐
    // 새 동작: 전체 item 으로 set → listener filter 통과 → mergeMenuItems 에서 customize 우선
    const out = mergeItemForWrite(17, { price: 9000 }, [], DEFAULTS);
    expect(out.id).not.toBeNull();
    expect(out.id).toBe(17);
    expect(out.name).toBeTruthy();
    // 이 out 을 listener 가 받았다고 가정 → mergeMenuItems 가 정상 처리되는지
    const listenerInput = [out];
    const merged = mergeMenuItems(DEFAULTS, listenerInput);
    const m17 = merged.find((m) => m.id === 17);
    expect(m17.price).toBe(9000);              // ⭐ 사장님 customize 보존됨 (옛 사고는 8000 으로 원복)
  });

  test('default 없는 신규 메뉴 + partial 만 → partial + id', () => {
    const out = mergeItemForWrite(99, { name: '신규', price: 5000 }, [], DEFAULTS);
    expect(out.id).toBe(99);
    expect(out.name).toBe('신규');
    expect(out.price).toBe(5000);
  });

  test('partial 에 id 가 들어와도 마지막 id 가 명시 → docId 와 항상 일치 보장', () => {
    const out = mergeItemForWrite(17, { id: 999, price: 9000 }, [], DEFAULTS);
    expect(out.id).toBe(17);                  // partial 의 id 999 무시, 호출 인자 17 보장
  });

  test('partial null/undefined → 안전 (current + default 만 반환)', () => {
    const out1 = mergeItemForWrite(17, null, [], DEFAULTS);
    expect(out1.id).toBe(17);
    expect(out1.price).toBe(8000);
    const out2 = mergeItemForWrite(17, undefined, [], DEFAULTS);
    expect(out2.price).toBe(8000);
  });

  test('currentItems / defaults null → 안전', () => {
    const out = mergeItemForWrite(17, { price: 9000 }, null, null);
    expect(out.id).toBe(17);
    expect(out.price).toBe(9000);
  });

  test('toggleFavorite 시나리오 — favorite 만 partial, 다른 필드 다 보존', () => {
    const current = [
      { id: 17, name: '콩국수(시그)', price: 8500, category: '국수/만백', image: 'abc.jpg' },
    ];
    const out = mergeItemForWrite(17, { favorite: true }, current, DEFAULTS);
    expect(out.favorite).toBe(true);
    expect(out.name).toBe('콩국수(시그)');
    expect(out.price).toBe(8500);
    expect(out.image).toBe('abc.jpg');
  });
});
