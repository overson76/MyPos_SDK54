import {
  findAddressEntry,
  getCustomerRequest,
  getAddressAlias,
  resolveDeliveryIdentity,
  entryIdentityName,
  computeNeedsAliasPrompt,
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
