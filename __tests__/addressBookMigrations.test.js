import {
  mergeOrphanPhoneOnlyEntries,
  mergeSameAliasPhoneOnlyEntries,
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

describe('mergeSameAliasPhoneOnlyEntries', () => {
  test('label="(주소 미입력) ..." entry + 같은 alias 의 진짜 주소 entry → 통합', () => {
    const entries = {
      'addr:집': {
        key: 'addr:집',
        label: '부산 사하구 비봉로54번안길 26-1',
        alias: '단골',
        phones: ['01011112222'],
      },
      'addr:plh': {
        key: 'addr:plh',
        label: '(주소 미입력) 010-9999-8888',
        alias: '단골',
        phone: '01099998888',
      },
    };
    const next = mergeSameAliasPhoneOnlyEntries(entries);
    expect(next['addr:plh']).toBeUndefined();
    expect(next['addr:집'].phones).toEqual(['01011112222', '01099998888']);
  });

  test('label=alias 인 pseudo entry + 같은 alias 의 진짜 주소 entry → 통합 (모래톱 케이스)', () => {
    const entries = {
      'addr:부산사하구비봉로54번안길26-1': {
        key: 'addr:부산사하구비봉로54번안길26-1',
        label: '부산 사하구 비봉로54번안길 26-1',
        alias: '모래톱',
        phone: '01072790779',
        phones: ['01072790779'],
      },
      'addr:모래톱': {
        key: 'addr:모래톱',
        label: '모래톱',
        alias: '모래톱',
        phone: '01072790779',
      },
    };
    const next = mergeSameAliasPhoneOnlyEntries(entries);
    expect(next['addr:모래톱']).toBeUndefined();
    expect(next['addr:부산사하구비봉로54번안길26-1']).toBeDefined();
    // 같은 digits 라 phones 변경 없음
    expect(next['addr:부산사하구비봉로54번안길26-1'].phones).toEqual(['01072790779']);
  });

  test('같은 alias 의 정식 entry 가 없으면 유지 (한 곳뿐인 가게 의도 보호)', () => {
    const entries = {
      'addr:모래톱': {
        key: 'addr:모래톱',
        label: '모래톱',
        alias: '모래톱',
        phone: '01072790779',
      },
    };
    const next = mergeSameAliasPhoneOnlyEntries(entries);
    expect(next).toBe(entries); // 변경 없음
    expect(next['addr:모래톱']).toBeDefined();
  });

  test('양쪽 다 label=alias 인 pseudo entry → 통합 안 함 (의도 모호)', () => {
    const entries = {
      'addr:모래톱1': {
        key: 'addr:모래톱1',
        label: '모래톱',
        alias: '모래톱',
        phone: '01011112222',
      },
      'addr:모래톱2': {
        key: 'addr:모래톱2',
        label: '모래톱',
        alias: '모래톱',
        phone: '01099998888',
      },
    };
    const next = mergeSameAliasPhoneOnlyEntries(entries);
    expect(next).toBe(entries); // 둘 다 phone-only-like → regularByAlias 비어있음 → noop
  });

  test('phone-only 새 digits → 정식 entry 의 phones 에 추가', () => {
    const entries = {
      'addr:집': {
        key: 'addr:집',
        label: '부산시 사상구 학장로 123',
        alias: '단골김',
        phones: ['01011112222'],
      },
      'addr:단골김': {
        key: 'addr:단골김',
        label: '단골김',
        alias: '단골김',
        phone: '01077778888',
      },
    };
    const next = mergeSameAliasPhoneOnlyEntries(entries);
    expect(next['addr:단골김']).toBeUndefined();
    expect(next['addr:집'].phones).toEqual(['01011112222', '01077778888']);
  });

  test('빈 entries / null', () => {
    expect(mergeSameAliasPhoneOnlyEntries({})).toEqual({});
    expect(mergeSameAliasPhoneOnlyEntries(null)).toBe(null);
  });

  test('alias 없는 entry 는 그룹화 X → 통합 안 함', () => {
    const entries = {
      'addr:집': { key: 'addr:집', label: '부산 어딘가', phone: '01011112222' },
      '__phone:01099998888': {
        key: '__phone:01099998888',
        label: '(주소 미입력) 010-9999-8888',
        phone: '01099998888',
      },
    };
    const next = mergeSameAliasPhoneOnlyEntries(entries);
    expect(next).toBe(entries);
  });
});
