import {
  entryPhoneDigits,
  hasRealAddress,
  realAlias,
  entryScore,
  findPhoneDuplicates,
  findSimilarAliasPairs,
  similarPairKey,
  findIncompleteEntries,
  mergeEntries,
  applyMerges,
} from '../utils/addressBookCleanup';

describe('entryPhoneDigits', () => {
  test('phone 필드', () => {
    expect(entryPhoneDigits('k', { phone: '010-1234-5678' })).toEqual(['01012345678']);
  });
  test('phones array + phone 중복 제거', () => {
    const d = entryPhoneDigits('k', { phone: '01012345678', phones: ['010-1234-5678', '0535551234'] });
    expect(d.sort()).toEqual(['01012345678', '0535551234'].sort());
  });
  test('label/key 텍스트의 전화 패턴 추출 (phone 필드 없을 때)', () => {
    const d = entryPhoneDigits('(주소 미입력) 010-2772-4064', { label: '(주소 미입력) 010-2772-4064' });
    expect(d).toEqual(['01027724064']);
  });
  test('+82 정규화', () => {
    expect(entryPhoneDigits('k', { phone: '+82 10-1234-5678' })).toEqual(['01012345678']);
  });
});

describe('hasRealAddress / realAlias', () => {
  test('진짜 주소', () => {
    expect(hasRealAddress({ label: '부산 사하구 123', alias: '사하자원' })).toBe(true);
  });
  test('placeholder 는 주소 아님', () => {
    expect(hasRealAddress({ label: '(주소 미입력) 010-1234-5678' })).toBe(false);
  });
  test('label=alias 는 주소 아님', () => {
    expect(hasRealAddress({ label: '사하자원', alias: '사하자원' })).toBe(false);
  });
  test('realAlias placeholder 제외', () => {
    expect(realAlias({ alias: '(주소 미입력) 010-1' })).toBe('');
    expect(realAlias({ alias: '사하자원' })).toBe('사하자원');
  });
});

describe('findPhoneDuplicates — 같은 번호 흩어짐', () => {
  test('아가맘 케이스 — placeholder + 별칭 entry 통합 후보, 별칭 쪽이 survivor 아님(주소없음 동점→count)', () => {
    const entries = {
      '(주소 미입력) 010-2772-4064': {
        key: '(주소 미입력) 010-2772-4064',
        label: '(주소 미입력) 010-2772-4064',
        count: 4,
      },
      '__phone:01027724064': {
        key: '__phone:01027724064',
        label: '(주소 미입력) 010-2772-4064',
        alias: '아가맘',
        phone: '01027724064',
        count: 0,
      },
    };
    const groups = findPhoneDuplicates(entries);
    expect(groups).toHaveLength(1);
    expect(groups[0].phone).toBe('01027724064');
    // 별칭 있는 쪽이 survivor (별칭 10000 > count 4*10)
    expect(groups[0].survivorKey).toBe('__phone:01027724064');
    expect(groups[0].mergeKeys).toEqual(['(주소 미입력) 010-2772-4064']);
  });

  test('survivor = 진짜 주소 있는 쪽 우선', () => {
    const entries = {
      '부산 사하구 159번길 32': {
        key: '부산 사하구 159번길 32',
        label: '부산 사하구 159번길 32',
        alias: '해신슈퍼',
        phone: '01045898935',
        count: 2,
      },
      '해신수퍼': { key: '해신수퍼', label: '해신수퍼', alias: '해신슈퍼', phone: '01045898935', count: 0 },
    };
    const groups = findPhoneDuplicates(entries);
    expect(groups).toHaveLength(1);
    expect(groups[0].survivorKey).toBe('부산 사하구 159번길 32');
  });

  test('중복 없으면 빈 배열', () => {
    const entries = {
      a: { key: 'a', phone: '01011112222' },
      b: { key: 'b', phone: '01033334444' },
    };
    expect(findPhoneDuplicates(entries)).toEqual([]);
  });

  test('빈 입력', () => {
    expect(findPhoneDuplicates({})).toEqual([]);
    expect(findPhoneDuplicates(null)).toEqual([]);
  });
});

describe('findSimilarAliasPairs — 비슷한 상호', () => {
  test('탑마트 / 신평 탑마트 부분 포함', () => {
    const entries = {
      a: { key: 'a', label: '주소A', alias: '탑마트', count: 5 },
      b: { key: 'b', label: '주소B', alias: '신평 탑마트', count: 1 },
    };
    const pairs = findSimilarAliasPairs(entries);
    expect(pairs).toHaveLength(1);
    // survivor = 점수 높은 쪽 (count 5)
    expect(pairs[0].survivorKey).toBe('a');
    expect(pairs[0].mergeKey).toBe('b');
  });

  test('정확 일치/무관 상호는 제외', () => {
    const entries = {
      a: { key: 'a', alias: '동원카' },
      b: { key: 'b', alias: '벽산페인트' },
    };
    expect(findSimilarAliasPairs(entries)).toEqual([]);
  });

  test('ignored 로 지정한 쌍은 제외 — "다른 가게" 확정 (상호명 alias 쌍)', () => {
    const entries = {
      a: { key: 'a', label: '주소A', alias: '탑마트', count: 5 },
      b: { key: 'b', label: '주소B', alias: '신평 탑마트', count: 1 },
    };
    expect(findSimilarAliasPairs(entries)).toHaveLength(1); // 무시 전
    // 쌍 키 = 상호명(alias) 정규화 정렬 조합 (entry key 아님 — 대표 key 변동 무관). 배열·Set 둘 다.
    const key = similarPairKey('탑마트', '신평 탑마트');
    expect(findSimilarAliasPairs(entries, [key])).toHaveLength(0);
    expect(findSimilarAliasPairs(entries, new Set([key]))).toHaveLength(0);
  });

  test('대표 entry key 가 바뀌어도 alias 무시는 유지 — 진실보석 단골 회귀 방지', () => {
    // 같은 상호 '진실보석' 에 entry 2개 — 주문이 쌓이면 count 로 대표 key 가 뒤바뀜.
    //   옛 entry key 쌍 무시였다면 대표가 바뀌는 순간 무시가 풀려 다시 떴음.
    const key = similarPairKey('진실보석', '진실보석(남자사장님)');
    const before = {
      p1: { key: 'p1', alias: '진실보석', count: 5 },
      p2: { key: 'p2', alias: '진실보석', count: 3 },
      q: { key: 'q', alias: '진실보석(남자사장님)', count: 1 },
    };
    expect(findSimilarAliasPairs(before, [key])).toHaveLength(0);
    // count 역전으로 대표가 p1 → p2 로 바뀌어도 alias 키라 그대로 숨김.
    const after = {
      p1: { key: 'p1', alias: '진실보석', count: 3 },
      p2: { key: 'p2', alias: '진실보석', count: 50 },
      q: { key: 'q', alias: '진실보석(남자사장님)', count: 1 },
    };
    expect(findSimilarAliasPairs(after, [key])).toHaveLength(0);
  });

  test('similarPairKey — 순서·대소문자·공백 무관 정규화', () => {
    expect(similarPairKey('탑마트', '신평 탑마트')).toBe(
      similarPairKey('신평 탑마트', '탑마트')
    );
    expect(similarPairKey(' 탑마트 ', 'TOP')).toBe(similarPairKey('top', '탑마트'));
  });
});

describe('findIncompleteEntries — 번호만/별칭만/주소만', () => {
  test('하나만 있는 entry 만, 번호만→별칭만→주소만 순', () => {
    const entries = {
      'addr|full': {
        key: 'addr|full',
        label: '부산 사하구 주소',
        alias: '완전상회',
        phone: '01000000000',
      }, // 3개 → 정상, 제외
      '__phone:01011112222': {
        key: '__phone:01011112222',
        label: '(주소 미입력) 010-1111-2222',
        phone: '01011112222',
        count: 0,
      }, // 번호만
      'alias-only': { key: 'alias-only', alias: '별칭가게' }, // 별칭만
      'addr-only': { key: 'addr-only', label: '부산 강서구 주소' }, // 주소만
    };
    const out = findIncompleteEntries(entries);
    expect(out).toHaveLength(3); // full 제외
    expect(out.map((x) => x.kind)).toEqual(['phone', 'alias', 'address']);
    expect(out[0].display).toBe('01011112222');
    expect(out[1].display).toBe('별칭가게');
    expect(out[2].display).toBe('부산 강서구 주소');
  });

  test('전화+주소(정상)·빈 entry 는 제외', () => {
    const entries = {
      ok: { key: 'ok', label: '부산 주소', phone: '01099998888' }, // 2개 → 정상
      empty: { key: 'empty' }, // 0개 → 빈
    };
    expect(findIncompleteEntries(entries)).toEqual([]);
  });
});

describe('mergeEntries — 통합 실행', () => {
  test('전번 합치고 주문횟수 합산 + 흡수 대상 삭제', () => {
    const entries = {
      survivor: { key: 'survivor', label: '부산 123', alias: '사하자원', phone: '01020185492', count: 5 },
      '(주소 미입력) 010-2018-5492': {
        key: '(주소 미입력) 010-2018-5492',
        label: '(주소 미입력) 010-2018-5492',
        count: 1,
      },
      '010-2018-5492대성빨래': { key: '010-2018-5492대성빨래', label: '010-2018-5492대성빨래', count: 1 },
    };
    const next = mergeEntries(entries, 'survivor', [
      '(주소 미입력) 010-2018-5492',
      '010-2018-5492대성빨래',
    ]);
    expect(next['(주소 미입력) 010-2018-5492']).toBeUndefined();
    expect(next['010-2018-5492대성빨래']).toBeUndefined();
    expect(next.survivor.count).toBe(7); // 5+1+1
    expect(next.survivor.alias).toBe('사하자원');
    expect(next.survivor.phones).toContain('01020185492');
  });

  test('survivor 별칭/주소 없으면 흡수 대상에서 가져옴', () => {
    const entries = {
      ph: { key: 'ph', label: '(주소 미입력) 010-1234-5678', phone: '01012345678', count: 3 },
      named: { key: 'named', label: '부산 어딘가', alias: '김사장', phone: '01012345678', count: 0 },
    };
    const next = mergeEntries(entries, 'ph', ['named']);
    expect(next.named).toBeUndefined();
    expect(next.ph.alias).toBe('김사장');
    expect(next.ph.label).toBe('부산 어딘가');
    expect(next.ph.count).toBe(3);
  });

  test('survivor 없으면 noop', () => {
    const entries = { a: { key: 'a' } };
    expect(mergeEntries(entries, 'nope', ['a'])).toBe(entries);
  });
});

describe('applyMerges — 여러 통합 순차', () => {
  test('두 그룹 통합', () => {
    const entries = {
      s1: { key: 's1', alias: 'A', phone: '01011112222', count: 1 },
      m1: { key: 'm1', label: '(주소 미입력) 010-1111-2222', count: 1 },
      s2: { key: 's2', alias: 'B', phone: '01033334444', count: 1 },
      m2: { key: 'm2', label: '(주소 미입력) 010-3333-4444', count: 1 },
    };
    const next = applyMerges(entries, [
      { survivorKey: 's1', mergeKeys: ['m1'] },
      { survivorKey: 's2', mergeKeys: ['m2'] },
    ]);
    expect(Object.keys(next).sort()).toEqual(['s1', 's2']);
    expect(next.s1.count).toBe(2);
    expect(next.s2.count).toBe(2);
  });
});
