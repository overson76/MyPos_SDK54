import {
  findAddressEntry,
  getCustomerRequest,
  getAddressAlias,
  resolveDeliveryIdentity,
  entryIdentityName,
  computeNeedsAliasPrompt,
  matchCidEntry,
  resolvePendingCallerStamp,
  hasResolvableAddress,
} from '../utils/addressBookLookup';

const BOOK_OBJECT = {
  entries: {
    '부산 사하구 하신번영로 25': {
      key: '부산 사하구 하신번영로 25',
      label: '부산 사하구 하신번영로 25',
      alias: '진실보석',
      phone: '01012345678',
      customerRequest: '다진고추, 김치많이',
    },
    '서울 강남 123': {
      key: '서울 강남 123',
      label: '서울 강남 123',
      alias: '김사장',
      // customerRequest 없음
    },
  },
};

const BOOK_ARRAY = [
  {
    key: '부산 사하구 하신번영로 25',
    label: '부산 사하구 하신번영로 25',
    customerRequest: '다진고추, 김치많이',
  },
];

describe('findAddressEntry', () => {
  test('객체 형태 — 정확한 주소 매칭', () => {
    const e = findAddressEntry(BOOK_OBJECT, '부산 사하구 하신번영로 25');
    expect(e?.alias).toBe('진실보석');
  });

  test('객체 형태 — 정규화 (대소문자/공백)', () => {
    const e = findAddressEntry(BOOK_OBJECT, '  부산 사하구 하신번영로 25  ');
    expect(e?.alias).toBe('진실보석');
  });

  test('배열 형태 처리', () => {
    const e = findAddressEntry(BOOK_ARRAY, '부산 사하구 하신번영로 25');
    expect(e?.customerRequest).toBe('다진고추, 김치많이');
  });

  test('addressBook.entries 가 배열인 경우', () => {
    const wrapped = { entries: BOOK_ARRAY };
    const e = findAddressEntry(wrapped, '부산 사하구 하신번영로 25');
    expect(e?.customerRequest).toBe('다진고추, 김치많이');
  });

  test('매칭 없으면 null', () => {
    expect(findAddressEntry(BOOK_OBJECT, '없는주소')).toBeNull();
  });

  test('null/undefined 안전', () => {
    expect(findAddressEntry(null, '서울')).toBeNull();
    expect(findAddressEntry(BOOK_OBJECT, '')).toBeNull();
    expect(findAddressEntry(BOOK_OBJECT, null)).toBeNull();
    expect(findAddressEntry({}, '서울')).toBeNull();
  });
});

describe('getCustomerRequest', () => {
  test('단골요청 추출', () => {
    expect(getCustomerRequest(BOOK_OBJECT, '부산 사하구 하신번영로 25')).toBe(
      '다진고추, 김치많이'
    );
  });

  test('단골요청 없는 entry → 빈 문자열', () => {
    expect(getCustomerRequest(BOOK_OBJECT, '서울 강남 123')).toBe('');
  });

  test('매칭 안 됨 → 빈 문자열', () => {
    expect(getCustomerRequest(BOOK_OBJECT, '없는주소')).toBe('');
  });

  test('null 안전', () => {
    expect(getCustomerRequest(null, '서울')).toBe('');
  });
});

describe('getAddressAlias', () => {
  test('별칭 추출', () => {
    expect(getAddressAlias(BOOK_OBJECT, '부산 사하구 하신번영로 25')).toBe('진실보석');
  });

  test('별칭 없는 entry', () => {
    const book = {
      entries: { 'a': { key: 'a', label: 'a' } },
    };
    expect(getAddressAlias(book, 'a')).toBe('');
  });
});

describe('resolveDeliveryIdentity — phone fallback (아가맘 사고)', () => {
  // 사장님이 "아가맘" 을 번호에 저장 → entry key 는 진짜 주소.
  // 배달 슬롯 deliveryAddress 는 "(주소 미입력) 010-..." placeholder.
  const BOOK = {
    entries: {
      'addr:아가맘집': {
        key: 'addr:아가맘집',
        label: '부산 사하구 어딘가 12-3',
        alias: '아가맘',
        phones: ['01027724064'],
      },
    },
  };

  test('주소 key 로 못 찾아도 전화번호로 별칭(아가맘) 찾음', () => {
    const id = resolveDeliveryIdentity(
      BOOK,
      '(주소 미입력) 010-2772-4064', // 주소 매칭 실패하는 placeholder
      { phone: '010-2772-4064' }
    );
    expect(id.alias).toBe('아가맘'); // 핵심 — 전번으로 별칭 찾음
    expect(id.phone).toBe('010-2772-4064'); // fallback.phone 우선 (입력 형태 보존)
  });

  test('fallback.alias 가 있으면 그대로 우선 (lookup 불필요)', () => {
    const id = resolveDeliveryIdentity(BOOK, '(주소 미입력) 010-2772-4064', {
      alias: '직접입력별칭',
      phone: '010-2772-4064',
    });
    expect(id.alias).toBe('직접입력별칭');
  });

  test('주소로 바로 찾으면 phone fallback 불필요', () => {
    const id = resolveDeliveryIdentity(BOOK_OBJECT, '부산 사하구 하신번영로 25', {});
    expect(id.alias).toBe('진실보석');
  });

  test('phone 도 주소도 매칭 안 되면 빈 별칭', () => {
    const id = resolveDeliveryIdentity(BOOK, '(주소 미입력) 010-9999-0000', {
      phone: '010-9999-0000',
    });
    expect(id.alias).toBe('');
  });
});

describe('entryIdentityName', () => {
  test('alias 있으면 alias', () => {
    expect(entryIdentityName({ alias: '진실보석', label: '부산 사하구 ...' })).toBe(
      '진실보석'
    );
  });

  test('alias 없으면 label 을 식별로 인정', () => {
    expect(entryIdentityName({ alias: '', label: '진실보석 남자사장' })).toBe(
      '진실보석 남자사장'
    );
  });

  test('placeholder label (__phone:) 은 식별 아님', () => {
    expect(entryIdentityName({ label: '__phone:01012345678' })).toBe('');
  });

  test('placeholder label ((주소 미입력)) 은 식별 아님', () => {
    expect(entryIdentityName({ label: '(주소 미입력) 010-1234-5678' })).toBe('');
  });

  test('null/빈 entry 는 빈 문자열', () => {
    expect(entryIdentityName(null)).toBe('');
    expect(entryIdentityName({})).toBe('');
  });
});

describe('computeNeedsAliasPrompt', () => {
  // 진실보석: alias 비어있고 label 만 있는 단골 entry (버그 재현 핵심)
  const BOOK_LABEL_ONLY = {
    entries: {
      '부산 사하구 하신번영로 25': {
        key: '부산 사하구 하신번영로 25',
        label: '진실보석 남자사장',
        alias: '', // ← alias 비어있음
        phone: '01012345678',
      },
    },
  };

  test('홀/매장 타입은 모달 안 띄움', () => {
    expect(
      computeNeedsAliasPrompt({
        tableType: 'hall',
        addressBook: BOOK_LABEL_ONLY,
      })
    ).toBe(false);
  });

  test('order 에 별칭 있으면 skip', () => {
    expect(
      computeNeedsAliasPrompt({
        tableType: 'delivery',
        deliveryAlias: '직접입력',
        addressBook: BOOK_LABEL_ONLY,
      })
    ).toBe(false);
  });

  test('★ 진실보석 버그 — alias 비고 label 만 있는 단골은 주소로 skip', () => {
    expect(
      computeNeedsAliasPrompt({
        tableType: 'delivery',
        deliveryAddress: '부산 사하구 하신번영로 25',
        addressBook: BOOK_LABEL_ONLY,
      })
    ).toBe(false); // 핵심 — 옛 로직은 true(모달 반복) 였음
  });

  test('★ 진실보석 버그 — 전화번호로도 label 식별 → skip', () => {
    expect(
      computeNeedsAliasPrompt({
        tableType: 'delivery',
        phone: '010-1234-5678',
        addressBook: BOOK_LABEL_ONLY,
      })
    ).toBe(false);
  });

  test('완전 미상 신규 손님 (주소/전번 매칭 X) 은 모달 띄움', () => {
    expect(
      computeNeedsAliasPrompt({
        tableType: 'delivery',
        deliveryAddress: '(주소 미입력) 010-9999-0000',
        phone: '010-9999-0000',
        addressBook: BOOK_LABEL_ONLY,
      })
    ).toBe(true);
  });

  test('takeout / reservation 도 동일 정책 (단골 skip)', () => {
    expect(
      computeNeedsAliasPrompt({
        tableType: 'takeout',
        deliveryAddress: '부산 사하구 하신번영로 25',
        addressBook: BOOK_LABEL_ONLY,
      })
    ).toBe(false);
    expect(
      computeNeedsAliasPrompt({
        tableType: 'reservation',
        phone: '010-9999-0000',
        addressBook: BOOK_LABEL_ONLY,
      })
    ).toBe(true);
  });
});

// 2026-06-12: 시뮬 배너 별칭 버그 — 시뮬 경로에 주소록 매칭이 없어 저장된
// 단골(테스트1)이 번호로만 뜨던 사고. 실 CID(useCidHandler)와 같은 매칭 결과 보장.
describe('matchCidEntry', () => {
  const BOOK_CID = {
    entries: {
      '__phone:01099998888': {
        key: '__phone:01099998888',
        label: '(주소 미입력) 010-9999-8888',
        alias: '테스트1',
        phone: '01099998888',
        count: 3,
      },
      '부산 사하구 하신번영로 25': {
        key: '부산 사하구 하신번영로 25',
        label: '부산 사하구 하신번영로 25',
        alias: '진실보석',
        phones: ['01012345678'],
        count: 5,
      },
    },
  };

  test('phone-only 단골 매칭 — 별칭/주문횟수 반환 (사장님 신고 시나리오)', () => {
    const r = matchCidEntry(BOOK_CID, '01099998888');
    expect(r.alias).toBe('테스트1');
    expect(r.orderCount).toBe(3);
    expect(r.isNewNumber).toBe(false);
  });

  test('하이픈 포맷 / +82 국가코드 정규화 매칭', () => {
    expect(matchCidEntry(BOOK_CID, '010-1234-5678').alias).toBe('진실보석');
    expect(matchCidEntry(BOOK_CID, '+82-10-1234-5678').alias).toBe('진실보석');
  });

  test('address 는 entry.label 그대로 — 실 CID 와 동일 (placeholder 포함)', () => {
    expect(matchCidEntry(BOOK_CID, '01099998888').address).toBe(
      '(주소 미입력) 010-9999-8888'
    );
    expect(matchCidEntry(BOOK_CID, '01012345678').address).toBe(
      '부산 사하구 하신번영로 25'
    );
  });

  test('미등록 번호 → 신규 (isNewNumber=true, 나머지 null/0)', () => {
    const r = matchCidEntry(BOOK_CID, '01000000000');
    expect(r.entry).toBeNull();
    expect(r.alias).toBeNull();
    expect(r.address).toBeNull();
    expect(r.orderCount).toBe(0);
    expect(r.isNewNumber).toBe(true);
  });

  test('null/빈 입력 안전', () => {
    expect(matchCidEntry(null, '01099998888').isNewNumber).toBe(true);
    expect(matchCidEntry(BOOK_CID, '').entry).toBeNull();
    expect(matchCidEntry(BOOK_CID, null).alias).toBeNull();
  });
});

// 2026-06-12: PENDING → OrderTypePicker 슬롯 배당 시 발신자 도장 — 옛 코드는
// PENDING 의 (대개 빈) deliveryPhone/Alias 만 넘겨 새 슬롯 라벨이 공백이 되던 버그.
describe('resolvePendingCallerStamp', () => {
  const BOOK = {
    entries: {
      '__phone:01055554444': {
        key: '__phone:01055554444',
        label: '(주소 미입력) 010-5555-4444',
        alias: '테스트2',
        phone: '01055554444',
      },
    },
  };

  test('PENDING 비어있고 최근 착신 있으면 — 전번 + 주소록 별칭 도장', () => {
    const r = resolvePendingCallerStamp({}, BOOK, '01055554444');
    expect(r.deliveryPhone).toBe('01055554444');
    expect(r.deliveryAlias).toBe('테스트2');
  });

  test('미등록 착신 번호 — 전번만 도장 (별칭 null)', () => {
    const r = resolvePendingCallerStamp({}, BOOK, '01033332222');
    expect(r.deliveryPhone).toBe('01033332222');
    expect(r.deliveryAlias).toBeNull();
  });

  test('order 에 이미 박힌 값이 최우선 (사장님 명시 입력 보호)', () => {
    const order = {
      deliveryPhone: '01011112222',
      deliveryAlias: '직접입력손님',
      deliveryAddress: '부산 사하구 1',
    };
    const r = resolvePendingCallerStamp(order, BOOK, '01055554444');
    expect(r.deliveryPhone).toBe('01011112222');
    expect(r.deliveryAlias).toBe('직접입력손님');
    expect(r.deliveryAddress).toBe('부산 사하구 1');
  });

  test('order 전번만 있고 별칭 없으면 — 그 전번의 주소록 별칭 보강', () => {
    const r = resolvePendingCallerStamp({ deliveryPhone: '01055554444' }, BOOK, '');
    expect(r.deliveryPhone).toBe('01055554444');
    expect(r.deliveryAlias).toBe('테스트2');
  });

  test('착신도 order 정보도 없으면 — 빈 도장 (매장 직접 손님)', () => {
    const r = resolvePendingCallerStamp({}, BOOK, '');
    expect(r.deliveryPhone).toBeNull();
    expect(r.deliveryAlias).toBeNull();
  });

  // 2026-07-03 사장님 신고 재현: "진실보석 주문 담는 중 다른 배달지 전화가 오면
  // 카트가 마지막 전화 손님에게 들어간다" — 카트 시작 이후 착신은 fallback 금지.
  test('🔴 카트 시작 *이후* 걸려온 전화 — 이 카트의 주인으로 쓰지 않음', () => {
    const order = { createdAt: 1000 }; // 카트 시작 t=1000
    const r = resolvePendingCallerStamp(order, BOOK, '01055554444', 2000); // 전화 t=2000
    expect(r.deliveryPhone).toBeNull();
    expect(r.deliveryAlias).toBeNull();
  });

  test('카트 시작 *이전* 전화(전화→받아적기 흐름)는 기존대로 인정', () => {
    const order = { createdAt: 3000 };
    const r = resolvePendingCallerStamp(order, BOOK, '01055554444', 2000);
    expect(r.deliveryPhone).toBe('01055554444');
    expect(r.deliveryAlias).toBe('테스트2');
  });

  test('카트 시작 이후 전화라도 order 에 이미 박힌 도장(첫 담기 스냅샷)이 최우선', () => {
    const order = {
      createdAt: 1000,
      deliveryPhone: '01011112222',
      deliveryAlias: '진실보석',
    };
    const r = resolvePendingCallerStamp(order, BOOK, '01055554444', 2000);
    expect(r.deliveryPhone).toBe('01011112222');
    expect(r.deliveryAlias).toBe('진실보석');
  });

  test('order=null (addItem 첫 담기 스냅샷 경로) — lastCall 그대로 사용', () => {
    const r = resolvePendingCallerStamp(null, BOOK, '01055554444', 2000);
    expect(r.deliveryPhone).toBe('01055554444');
    expect(r.deliveryAlias).toBe('테스트2');
  });

  test('lastCallTs 미전달(옛 3인자 호출) — 기존 동작 유지', () => {
    const order = { createdAt: 1000 };
    const r = resolvePendingCallerStamp(order, BOOK, '01055554444');
    expect(r.deliveryPhone).toBe('01055554444');
  });
});

// 2026-06-13: 카운터 PC 딜레이 처방 — 주소 미입력 entry 의 카카오 좌표 변환 낭비 차단.
// useAddressBook 의 lazy geocode 루프가 이 함수로 진짜 주소 entry 만 골라 호출.
describe('hasResolvableAddress', () => {
  test('진짜 도로명/지번 주소 → 변환 대상', () => {
    expect(hasResolvableAddress({ label: '부산 사하구 하신번영로 25' })).toBe(true);
    expect(hasResolvableAddress({ label: '서울 강남구 테헤란로 152' })).toBe(true);
  });

  test('CID phone-only placeholder → 변환 대상 아님', () => {
    expect(
      hasResolvableAddress({ label: '(주소 미입력) 010-9999-8888' })
    ).toBe(false);
    expect(hasResolvableAddress({ label: '__phone:01099998888' })).toBe(false);
  });

  test('pendingAddress 플래그 entry → 변환 대상 아님', () => {
    expect(
      hasResolvableAddress({ label: '부산 어딘가', pendingAddress: true })
    ).toBe(false);
  });

  test('빈/공백 label → 변환 대상 아님', () => {
    expect(hasResolvableAddress({ label: '' })).toBe(false);
    expect(hasResolvableAddress({ label: '   ' })).toBe(false);
    expect(hasResolvableAddress({})).toBe(false);
    expect(hasResolvableAddress(null)).toBe(false);
  });

  test('별칭만 있고 label 이 placeholder 면 변환 대상 아님 (alias 검색은 별도)', () => {
    expect(
      hasResolvableAddress({ alias: '진실보석', label: '(주소 미입력) 010-1' })
    ).toBe(false);
  });
});
