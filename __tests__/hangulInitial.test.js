import {
  getInitial,
  getEntryInitial,
  HANGUL_INDEX_BAR,
} from '../utils/hangulInitial';

describe('getInitial — 한글 음절', () => {
  test('ㄱ 그룹', () => {
    expect(getInitial('가나다')).toBe('ㄱ');
    expect(getInitial('김')).toBe('ㄱ');
    expect(getInitial('과일상')).toBe('ㄱ');
  });

  test('ㅈ 그룹', () => {
    expect(getInitial('젠틀맨')).toBe('ㅈ');
    expect(getInitial('진실')).toBe('ㅈ');
  });

  test('ㅂ 그룹', () => {
    expect(getInitial('보살')).toBe('ㅂ');
    expect(getInitial('밀면')).toBe('ㅁ');
  });

  test('ㅎ 그룹', () => {
    expect(getInitial('하나')).toBe('ㅎ');
  });
});

describe('getInitial — 쌍자음 정규화', () => {
  test('ㄲ → ㄱ', () => {
    expect(getInitial('까치')).toBe('ㄱ');
  });

  test('ㄸ → ㄷ', () => {
    expect(getInitial('땅콩')).toBe('ㄷ');
  });

  test('ㅃ → ㅂ', () => {
    expect(getInitial('빵집')).toBe('ㅂ');
  });

  test('ㅆ → ㅅ', () => {
    expect(getInitial('쌍문동')).toBe('ㅅ');
  });

  test('ㅉ → ㅈ', () => {
    expect(getInitial('찌개')).toBe('ㅈ');
  });
});

describe('getInitial — 한글 자음 단독', () => {
  test('ㄱ 자음 단독', () => {
    expect(getInitial('ㄱ')).toBe('ㄱ');
  });

  test('ㄲ 자음 → ㄱ 정규화', () => {
    expect(getInitial('ㄲ')).toBe('ㄱ');
  });
});

describe('getInitial — 영문 / 숫자 / 기타', () => {
  test('영문 대문자 → A', () => {
    expect(getInitial('Apple')).toBe('A');
    expect(getInitial('BHC')).toBe('A');
  });

  test('영문 소문자 → A', () => {
    expect(getInitial('apple')).toBe('A');
  });

  test('숫자 → #', () => {
    expect(getInitial('168')).toBe('#');
    expect(getInitial('010-1234')).toBe('#');
  });

  test('기호 / 빈 문자열', () => {
    expect(getInitial('')).toBe('#');
    expect(getInitial(null)).toBe('#');
    expect(getInitial(undefined)).toBe('#');
    expect(getInitial('★별')).toBe('#');
  });

  test('공백 trim', () => {
    expect(getInitial('  김사장 ')).toBe('ㄱ');
  });
});

describe('getEntryInitial — entry 우선순위 (별칭 > 라벨)', () => {
  test('별칭이 있으면 별칭 기준', () => {
    expect(getEntryInitial({ alias: '젠틀맨', label: '부산 사하구 ...' })).toBe('ㅈ');
  });

  test('별칭 없으면 라벨 기준', () => {
    expect(getEntryInitial({ label: '부산 사하구 ...' })).toBe('ㅂ');
  });

  test('별칭 공백만이면 라벨 fallback', () => {
    expect(getEntryInitial({ alias: '   ', label: 'BHC' })).toBe('A');
  });

  test('null 안전', () => {
    expect(getEntryInitial(null)).toBe('#');
    expect(getEntryInitial({})).toBe('#');
  });
});

describe('HANGUL_INDEX_BAR', () => {
  test('14 자음 + A + # 순서', () => {
    expect(HANGUL_INDEX_BAR).toEqual([
      'ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
      'A', '#',
    ]);
    expect(HANGUL_INDEX_BAR).toHaveLength(16);
  });
});
