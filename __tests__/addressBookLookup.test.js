import {
  findAddressEntry,
  getCustomerRequest,
  getAddressAlias,
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
