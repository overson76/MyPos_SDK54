// 백업 폴더(business_addresses.html) 의 4월 말 카카오 로컬 API 검색 결과를 JS 모듈화.
// 기준: 부산 사하구 하신번영로177번길 50, 반경 2km. 총 75건 (확인 56 + 미확인 19).
//
// "확인" = 카카오맵 등록 + 상호/주소/거리/전화 확보. 바로 entry 화.
// "미확인" = 카카오맵 미등록 또는 상호명 불일치. keyword 만 보존 → pendingAddress entry.
//
// importAddresses(setAddressBook, mode) 로 일괄 등록. mode = 'foundOnly' | 'all'.

import { normalizeAddressKey } from './orderHelpers';
import { sanitizeDeliveryAddress } from './validate';

// 75개 원본. found=false 는 keyword 만 사용.
export const SEED_BUSINESS_ADDRESSES = [
  { num: 1, keyword: '영진정보', found: false },
  { num: 2, keyword: '동원카센터', found: true, name: '동원종합카센타', address: '부산 사하구 하신번영로201번길 25', distanceM: 69, phone: '051-207-1234' },
  { num: 3, keyword: '해신슈퍼', found: true, name: '해신탑마트', address: '부산 사하구 하신번영로159번길 32', distanceM: 200, phone: '051-206-8296' },
  { num: 4, keyword: '이상민치과', found: true, name: '이상민치과의원', address: '부산 사하구 하신번영로 177', distanceM: 252, phone: '051-207-4564' },
  { num: 5, keyword: '김사웅내과', found: true, name: '김사웅내과의원', address: '부산 사하구 하신번영로 199', distanceM: 107, phone: '051-206-3806' },
  { num: 6, keyword: '하나헤어', found: true, name: '하나헤어', address: '부산 사하구 하신번영로 185', distanceM: 242, phone: '051-949-8111' },
  { num: 7, keyword: '이노티안경', found: false },
  { num: 8, keyword: '현대구두방', found: false },
  { num: 9, keyword: '개성녹각삼계탕', found: false },
  { num: 10, keyword: '신평한신아파트', found: true, name: '한신공인중개사무소', address: '부산 사하구 비봉로 42', distanceM: 760, phone: '051-293-2004' },
  { num: 11, keyword: '신익강변아파트', found: true, name: '신익강변타운아파트', address: '부산 사하구 하신중앙로 180', distanceM: 655, phone: '' },
  { num: 12, keyword: '퀸즈타운', found: true, name: '퀸즈타운W사하오피스텔', address: '부산 사하구 비봉로 93', distanceM: 497, phone: '' },
  { num: 13, keyword: '가락2단지', found: true, name: '가락타운2단지아파트', address: '부산 사하구 하신번영로 233 인근', distanceM: 274, phone: '' },
  { num: 14, keyword: '가락3단지', found: true, name: '가락타운3단지아파트', address: '부산 사하구 하신중앙로 265', distanceM: 209, phone: '' },
  { num: 15, keyword: '모델미용실', found: true, name: '모델미용실', address: '부산 사하구 하신번영로 208', distanceM: 146, phone: '051-208-7385' },
  { num: 16, keyword: '대가고기백화점', found: true, name: '대가고기백화점', address: '부산 사하구 하신번영로 207', distanceM: 138, phone: '051-291-8090' },
  { num: 17, keyword: '뚱삼이삼겹살', found: true, name: '뚱삼이와대삼이 신평점', address: '부산 사하구 하신번영로 187-1', distanceM: 213, phone: '051-529-7737' },
  { num: 18, keyword: '남원추어탕', found: true, name: '한방남원추어탕', address: '부산 사하구 하신번영로159번길 13', distanceM: 258, phone: '051-201-0069' },
  { num: 19, keyword: '대성카에어컨', found: false },
  { num: 20, keyword: '더치엔커피', found: true, name: '더치엔커피', address: '부산 사하구 하신번영로177번길 20', distanceM: 153, phone: '010-2222-8075' },
  { num: 21, keyword: '정복당', found: true, name: '정복당', address: '부산 사하구 하신번영로177번길 36', distanceM: 66, phone: '051-207-4376' },
  { num: 22, keyword: '시온전자', found: true, name: '시온전자 부산총판', address: '부산 사하구 하신번영로167번길 50', distanceM: 98, phone: '051-294-1040' },
  { num: 23, keyword: '하나의료기', found: true, name: '하나전자의료기', address: '부산 사하구 하신번영로167번길 54', distanceM: 100, phone: '051-202-1581' },
  { num: 24, keyword: '청솔서점', found: true, name: '청솔서점', address: '부산 사하구 하신번영로 195', distanceM: 144, phone: '051-202-6338' },
  { num: 25, keyword: '신익약국', found: true, name: '신익약국', address: '부산 사하구 하신중앙로 184', distanceM: 590, phone: '051-208-7933' },
  { num: 26, keyword: '퀸즈부동산', found: true, name: '퀸즈부동산', address: '부산 사하구 하신중앙로 184', distanceM: 562, phone: '051-208-2114' },
  { num: 27, keyword: '현대아이파크부동산', found: true, name: '아이파크공인중개사무소', address: '부산 사하구 하신중앙로 170', distanceM: 792, phone: '051-201-1323' },
  { num: 28, keyword: '아델리아미용실', found: true, name: '아델리아헤어', address: '부산 사하구 하신중앙로 170', distanceM: 801, phone: '' },
  { num: 29, keyword: '삼창아파트', found: true, name: '삼창강변1차아파트', address: '부산 사하구 비봉로 37', distanceM: 683, phone: '' },
  { num: 30, keyword: '큰사랑요양병원', found: true, name: '큰사랑요양병원', address: '부산 사하구 하신중앙로 174', distanceM: 705, phone: '051-203-0288' },
  { num: 31, keyword: '한솔탁구', found: false },
  { num: 32, keyword: '대림고속관광', found: true, name: '뉴대림고속관광', address: '부산 사하구 하신중앙로 236-1', distanceM: 398, phone: '051-266-5600' },
  { num: 33, keyword: '미림장식', found: false },
  { num: 34, keyword: '벽산페인트', found: true, name: '경성기업', address: '부산 사하구 하신번영로 171', distanceM: 261, phone: '051-201-0233' },
  { num: 35, keyword: '사랑샘어린이집', found: true, name: '사랑샘어린이집', address: '부산 사하구 하신번영로177번길 6', distanceM: 223, phone: '051-293-6777' },
  { num: 36, keyword: '유신교통', found: true, name: '유신교통', address: '부산 사하구 하신중앙로 252', distanceM: 434, phone: '051-201-0801' },
  { num: 37, keyword: '하나고속', found: true, name: '하나고속관광', address: '부산 사하구 하신번영로151번길 14', distanceM: 314, phone: '010-3538-2211' },
  { num: 38, keyword: '비엔나제과', found: true, name: '비엔나제과점', address: '부산 사하구 하신번영로169번길 31', distanceM: 125, phone: '051-204-4087' },
  { num: 39, keyword: '김해시락국', found: false },
  { num: 40, keyword: '현대아이파크아파트', found: false },
  { num: 41, keyword: '영진국밥', found: true, name: '영진돼지국밥 본점', address: '부산 사하구 하신번영로157번길 39', distanceM: 225, phone: '051-206-3820' },
  { num: 42, keyword: '한우목장', found: true, name: '한우목장', address: '부산 사하구 하신번영로167번길 11', distanceM: 220, phone: '051-202-2336' },
  { num: 43, keyword: '돼지불백', found: true, name: '미정이네 돼지불백김치찌개', address: '부산 사하구 하신번영로159번길 36', distanceM: 189, phone: '051-205-0792' },
  { num: 44, keyword: '부산수산횟집', found: true, name: '부산수산횟집', address: '부산 사하구 하신번영로151번길 42', distanceM: 247, phone: '' },
  { num: 45, keyword: 'BHC치킨', found: true, name: 'BHC치킨 새신평점', address: '부산 사하구 하신번영로171번길 31', distanceM: 109, phone: '051-292-5292' },
  { num: 46, keyword: '환성물회', found: true, name: '환성물회', address: '부산 사하구 하신번영로167번길 26', distanceM: 151, phone: '051-202-3285' },
  { num: 47, keyword: '낮밤상회', found: true, name: '낮밤상회', address: '부산 사하구 하신번영로169번길 32', distanceM: 115, phone: '051-202-0116' },
  { num: 48, keyword: '꽃비네헤어클리닉', found: false },
  { num: 49, keyword: '경성식육점', found: false },
  { num: 50, keyword: '어택공인중개사무소', found: false },
  { num: 51, keyword: '윤경플라워', found: false },
  { num: 52, keyword: '진미영양돌솥밥', found: false },
  { num: 53, keyword: '낙동교회', found: true, name: '낙동교회', address: '부산 사하구 동매로23번길 15', distanceM: 725, phone: '051-205-6256' },
  { num: 54, keyword: '진헤어샵', found: false },
  { num: 55, keyword: '진실보석', found: true, name: '진실보석', address: '부산 사하구 하신번영로167번길 20', distanceM: 181, phone: '051-202-9312' },
  { num: 56, keyword: '회동상사', found: true, name: '회동상사', address: '부산 사하구 하신번영로151번길 6', distanceM: 339, phone: '051-204-5529' },
  { num: 57, keyword: '명보전자', found: false },
  { num: 58, keyword: '프로카서비스', found: true, name: '프로카서비스', address: '부산 사하구 하신번영로151번길 34', distanceM: 265, phone: '051-293-6884' },
  { num: 59, keyword: '차사랑카서비스', found: false },
  { num: 60, keyword: '옥스포드', found: true, name: '옥스포드', address: '부산 사하구 하신번영로151번길 55', distanceM: 302, phone: '051-205-4792' },
  { num: 61, keyword: 'SGS', found: true, name: '한국에스지에스 사하사무소', address: '부산 사하구 신산로29번길 50', distanceM: 487, phone: '051-630-7000' },
  { num: 62, keyword: '덕영슈퍼', found: true, name: '덕영할인마트', address: '부산 사하구 하신번영로161번길 20', distanceM: 218, phone: '051-206-5260' },
  { num: 63, keyword: '경은산업', found: true, name: '경은산업 제2공장', address: '부산 사하구 하신번영로127번길 11', distanceM: 520, phone: '' },
  { num: 64, keyword: '블루텍스', found: false },
  { num: 65, keyword: '동진다이닝', found: true, name: '동진다이닝', address: '부산 사하구 하신번영로127번길 25', distanceM: 519, phone: '051-202-9405' },
  { num: 66, keyword: '석진이엔티', found: true, name: '석진이엔티 본사', address: '부산 사하구 신산로13번길 45', distanceM: 467, phone: '051-203-8420' },
  { num: 67, keyword: '동진섬유', found: true, name: '동진다이닝 (유사검색)', address: '부산 사하구 하신번영로127번길 25', distanceM: 519, phone: '051-202-9405' },
  { num: 68, keyword: '새소망교회', found: true, name: '새소망교회', address: '부산 사하구 하신중앙로 168', distanceM: 788, phone: '' },
  { num: 69, keyword: '부산교통공사', found: true, name: '부산교통공사 신평체육관', address: '부산 사하구 하신번영로 140', distanceM: 472, phone: '051-200-5125' },
  { num: 70, keyword: '하구언성결교회', found: true, name: '하구언성결교회', address: '부산 사하구 동매로5번길 12', distanceM: 654, phone: '' },
  { num: 71, keyword: '강변프라자', found: true, name: '네오피트니스 하단1호점', address: '부산 사하구 하신번영로201번길 10', distanceM: 82, phone: '010-5698-8147' },
  { num: 72, keyword: '낙동옷수선', found: false },
  { num: 73, keyword: '사하보건소', found: true, name: '사하구보건소', address: '부산 사하구 하신중앙로 185', distanceM: 552, phone: '051-220-5701' },
  { num: 74, keyword: '사하구청', found: true, name: '사하구청 제2청사', address: '부산 사하구 하신중앙로 185', distanceM: 555, phone: '' },
  { num: 75, keyword: '건강보험공단', found: true, name: '국민건강보험공단 부산사하지사', address: '부산 사하구 하신중앙로 179', distanceM: 597, phone: '1577-1000' },
];

// 일괄 등록 — 기존 entry 와 충돌하지 않도록 (key 또는 phone digits 기준) 스킵.
// mode='foundOnly' : 확인 56개만
// mode='all'       : 75개 전체 (미확인 19개는 pendingAddress=true 로 keyword 만 보존)
// 반환: { added, skipped, total }
export function importAddresses(setAddressBook, mode = 'foundOnly') {
  const includeAll = mode === 'all';
  const list = includeAll
    ? SEED_BUSINESS_ADDRESSES
    : SEED_BUSINESS_ADDRESSES.filter((s) => s.found);

  let added = 0;
  let skipped = 0;

  setAddressBook((prev) => {
    const nextEntries = { ...prev.entries };
    const existingPhones = new Set(
      Object.values(prev.entries)
        .map((e) => (e.phone || '').replace(/\D/g, ''))
        .filter(Boolean)
    );

    for (const seed of list) {
      if (seed.found) {
        const safe = sanitizeDeliveryAddress(seed.address || '');
        if (!safe) {
          skipped += 1;
          continue;
        }
        const key = normalizeAddressKey(safe);
        if (!key || nextEntries[key]) {
          skipped += 1;
          continue;
        }
        const phoneDigits = (seed.phone || '').replace(/\D/g, '');
        if (phoneDigits && existingPhones.has(phoneDigits)) {
          skipped += 1;
          continue;
        }
        const entry = {
          key,
          label: safe,
          alias: seed.name || seed.keyword,
          count: 0,
          pinned: false,
          firstSeenAt: Date.now(),
          lastUsedAt: Date.now(),
        };
        if (phoneDigits) {
          entry.phone = phoneDigits;
          existingPhones.add(phoneDigits);
        }
        nextEntries[key] = entry;
        added += 1;
      } else {
        // 미확인 — keyword 만 pending entry 로
        const key = `__pending:${seed.keyword}`;
        if (nextEntries[key]) {
          skipped += 1;
          continue;
        }
        nextEntries[key] = {
          key,
          label: `(주소 미입력) ${seed.keyword}`,
          alias: seed.keyword,
          pendingAddress: true,
          count: 0,
          pinned: false,
          firstSeenAt: Date.now(),
          lastUsedAt: Date.now(),
        };
        added += 1;
      }
    }

    return { ...prev, entries: nextEntries };
  });

  return { added, skipped, total: list.length };
}

// 미확인 19개만 — 사장님이 직원에게 "이 키워드 주소 채우라" 표시하고 싶을 때.
export function importPendingOnly(setAddressBook) {
  return importAddresses(
    setAddressBook,
    'all',
  );
}
