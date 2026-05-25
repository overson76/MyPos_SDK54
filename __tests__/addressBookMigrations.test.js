import {
  mergeOrphanPhoneOnlyEntries,
  hasPhoneDigitsAnywhere,
  collectPhoneDigits,
} from '../utils/addressBookMigrations';

describe('collectPhoneDigits', () => {
  test('phone 단일만', () => {
    expect(collectPhoneDigits({ phone: '010-1234-5678' })).toEqual(['01012345678']);
  });

  test('phones array 만', () => {
    expect(collectPhoneDigits({ phones: ['010-1234-5678', '053-555-1234'] })).toEqual([
      '01012345678',
      '0535551234',
    ]);
  });

  test('phones + phone 중복 제거', () => {
    const digits = collectPhoneDigits({
      phone: '01012345678',
      phones: ['010-1234-5678', '0535551234'],
    });
    expect(digits).toEqual(['01012345678', '0535551234']);
  });

  test('빈 entry', () => {
    expect(collectPhoneDigits({})).toEqual([]);
    expect(collectPhoneDigits(null)).toEqual([]);
  });

  test('빈 문자열 / 잘못된 값 무시', () => {
    expect(collectPhoneDigits({ phones: ['', null, '010'], phone: '' })).toEqual(['010']);
  });
});

describe('hasPhoneDigitsAnywhere', () => {
  const entries = {
    'addr:대구중구1': { key: 'addr:대구중구1', label: '대구 중구 1', phone: '01012345678' },
    'addr:대구중구2': {
      key: 'addr:대구중구2',
      label: '대구 중구 2',
      phones: ['01099998888', '0535551234'],
    },
  };

  test('phone 단일 매치', () => {
    expect(hasPhoneDigitsAnywhere(entries, '01012345678')).toBe(true);
    expect(hasPhoneDigitsAnywhere(entries, '010-1234-5678')).toBe(true);
  });

  test('phones array 매치', () => {
    expect(hasPhoneDigitsAnywhere(entries, '01099998888')).toBe(true);
    expect(hasPhoneDigitsAnywhere(entries, '0535551234')).toBe(true);
  });

  test('매치 없음', () => {
    expect(hasPhoneDigitsAnywhere(entries, '01000000000')).toBe(false);
  });

  test('빈 입력', () => {
    expect(hasPhoneDigitsAnywhere({}, '01012345678')).toBe(false);
    expect(hasPhoneDigitsAnywhere(entries, '')).toBe(false);
    expect(hasPhoneDigitsAnywhere(null, '01012345678')).toBe(false);
  });
});

describe('mergeOrphanPhoneOnlyEntries', () => {
  test('phones array 만 있는 정식 entry + 같은 digits orphan → orphan 삭제 (동진카에어컨 케이스)', () => {
    const entries = {
      'addr:동진카에어컨주소': {
        key: 'addr:동진카에어컨주소',
        label: '대구 중구 동진카에어컨',
        alias: '동진카에어컨',
        phones: ['01012345678'],
      },
      '__phone:01012345678': {
        key: '__phone:01012345678',
        label: '(주소 미입력) 010-1234-5678',
        phone: '01012345678',
        pendingAddress: true,
      },
    };
    const next = mergeOrphanPhoneOnlyEntries(entries);
    expect(next).not.toBe(entries);
    expect(next['__phone:01012345678']).toBeUndefined();
    expect(next['addr:동진카에어컨주소']).toEqual(entries['addr:동진카에어컨주소']);
  });

  test('phone 단일만 있는 정식 entry + 같은 digits orphan → orphan 삭제', () => {
    const entries = {
      'addr:집': { key: 'addr:집', label: '집', phone: '01099998888', alias: '단골' },
      '__phone:01099998888': {
        key: '__phone:01099998888',
        phone: '01099998888',
        pendingAddress: true,
      },
    };
    const next = mergeOrphanPhoneOnlyEntries(entries);
    expect(next['__phone:01099998888']).toBeUndefined();
    expect(next['addr:집']).toBeDefined();
  });

  test('매치 안 되는 orphan → 유지 (사장님이 나중에 주소 채울 의미 있는 데이터)', () => {
    const entries = {
      'addr:집': { key: 'addr:집', label: '집', phone: '01011112222' },
      '__phone:01099998888': {
        key: '__phone:01099998888',
        phone: '01099998888',
        pendingAddress: true,
      },
    };
    const next = mergeOrphanPhoneOnlyEntries(entries);
    expect(next).toBe(entries); // 변경 없음 — 동일 reference
    expect(next['__phone:01099998888']).toBeDefined();
  });

  test('phone-only 전혀 없음 → noop, 동일 reference', () => {
    const entries = {
      'addr:집': { key: 'addr:집', label: '집', phone: '01011112222' },
      'addr:가게': { key: 'addr:가게', label: '가게', phones: ['0212345678'] },
    };
    expect(mergeOrphanPhoneOnlyEntries(entries)).toBe(entries);
  });

  test('빈 entries', () => {
    expect(mergeOrphanPhoneOnlyEntries({})).toEqual({});
    expect(mergeOrphanPhoneOnlyEntries(null)).toBe(null);
  });

  test('여러 orphan 중 매치되는 것만 통합', () => {
    const entries = {
      'addr:동진': {
        key: 'addr:동진',
        label: '동진카에어컨',
        alias: '동진카에어컨',
        phones: ['01012345678'],
      },
      '__phone:01012345678': {
        key: '__phone:01012345678',
        phone: '01012345678',
      },
      '__phone:01099998888': {
        key: '__phone:01099998888',
        phone: '01099998888',
      },
    };
    const next = mergeOrphanPhoneOnlyEntries(entries);
    expect(next['__phone:01012345678']).toBeUndefined();
    expect(next['__phone:01099998888']).toBeDefined();
    expect(next['addr:동진']).toBeDefined();
  });

  test('phone-only entry 의 phone 이 정식 entry 의 phones array 와 매치 (양방향 검사)', () => {
    const entries = {
      'addr:1': { key: 'addr:1', phones: ['01012345678', '0535551234'] },
      '__phone:0535551234': { key: '__phone:0535551234', phone: '0535551234' },
    };
    const next = mergeOrphanPhoneOnlyEntries(entries);
    expect(next['__phone:0535551234']).toBeUndefined();
    expect(next['addr:1']).toBeDefined();
  });

  test('정식 entry 가 같은 digits 의 phone 과 phones 둘 다 가져도 OK', () => {
    const entries = {
      'addr:1': {
        key: 'addr:1',
        phone: '01012345678',
        phones: ['01012345678', '0535551234'],
      },
      '__phone:01012345678': { key: '__phone:01012345678', phone: '01012345678' },
    };
    const next = mergeOrphanPhoneOnlyEntries(entries);
    expect(next['__phone:01012345678']).toBeUndefined();
  });
});
