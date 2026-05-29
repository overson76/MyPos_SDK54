import {
  findAddressEntry,
  getCustomerRequest,
  getAddressAlias,
  resolveDeliveryIdentity,
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
