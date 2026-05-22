// AsyncStorage mock — persistence.js 가 사용. 영속화 함수 테스트용.
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  return {
    __store: store,
    getItem: jest.fn((k) =>
      Promise.resolve(store.has(k) ? store.get(k) : null)
    ),
    setItem: jest.fn((k, v) => {
      store.set(k, v);
      return Promise.resolve();
    }),
    removeItem: jest.fn((k) => {
      store.delete(k);
      return Promise.resolve();
    }),
    multiGet: jest.fn((keys) =>
      Promise.resolve(keys.map((k) => [k, store.has(k) ? store.get(k) : null]))
    ),
  };
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  sanitizeMemoChip,
  normalizeMemoTemplates,
  addMemoTemplate,
  removeMemoTemplate,
  moveMemoTemplate,
  appendChipToMemo,
  isChipActive,
  loadMemoTemplates,
  saveMemoTemplates,
  DEFAULT_MEMO_TEMPLATES,
  MEMO_TEMPLATE_LIMITS,
} from '../utils/memoTemplates';

describe('sanitizeMemoChip', () => {
  test('null/undefined → 빈 문자열', () => {
    expect(sanitizeMemoChip(null)).toBe('');
    expect(sanitizeMemoChip(undefined)).toBe('');
  });

  test('앞뒤 공백 제거', () => {
    expect(sanitizeMemoChip('  덜 맵게  ')).toBe('덜 맵게');
  });

  test('상한 길이로 자른다', () => {
    const long = '가'.repeat(20);
    expect(sanitizeMemoChip(long)).toHaveLength(
      MEMO_TEMPLATE_LIMITS.CHIP_MAX_LEN
    );
  });

  test('제어문자 제거, 일반 공백 보존', () => {
    expect(sanitizeMemoChip('덜\x00 맵\x0D게')).toBe('덜 맵게');
  });
});

describe('normalizeMemoTemplates', () => {
  test('배열 아니면 빈 배열', () => {
    expect(normalizeMemoTemplates(null)).toEqual([]);
    expect(normalizeMemoTemplates('not array')).toEqual([]);
  });

  test('빈/공백 제거', () => {
    expect(normalizeMemoTemplates(['', '  ', '포장'])).toEqual(['포장']);
  });

  test('중복 제거 (공백/대소문자 무시, 표시는 원형)', () => {
    expect(normalizeMemoTemplates(['포장', '포장', ' 포장 ', 'PoSt'])).toEqual([
      '포장',
      'PoSt',
    ]);
  });

  test('최대 개수 cap', () => {
    const many = Array.from({ length: 50 }, (_, i) => `메모${i}`);
    expect(normalizeMemoTemplates(many)).toHaveLength(
      MEMO_TEMPLATE_LIMITS.CHIP_MAX_COUNT
    );
  });
});

describe('addMemoTemplate', () => {
  test('새 칩 추가', () => {
    expect(addMemoTemplate(['포장'], '빨리')).toEqual(['포장', '빨리']);
  });

  test('중복은 무시', () => {
    expect(addMemoTemplate(['포장'], '포장')).toEqual(['포장']);
    expect(addMemoTemplate(['포장'], ' 포장 ')).toEqual(['포장']);
  });

  test('빈 값은 무시', () => {
    expect(addMemoTemplate(['포장'], '')).toEqual(['포장']);
    expect(addMemoTemplate(['포장'], '   ')).toEqual(['포장']);
  });

  test('최대 개수 도달 시 추가 거부', () => {
    const max = Array.from(
      { length: MEMO_TEMPLATE_LIMITS.CHIP_MAX_COUNT },
      (_, i) => `메모${i}`
    );
    expect(addMemoTemplate(max, '신규')).toHaveLength(
      MEMO_TEMPLATE_LIMITS.CHIP_MAX_COUNT
    );
    expect(addMemoTemplate(max, '신규')).not.toContain('신규');
  });
});

describe('removeMemoTemplate', () => {
  test('인덱스로 제거', () => {
    expect(removeMemoTemplate(['포장', '빨리', '많이'], 1)).toEqual([
      '포장',
      '많이',
    ]);
  });

  test('범위 밖은 그대로', () => {
    expect(removeMemoTemplate(['포장'], 5)).toEqual(['포장']);
    expect(removeMemoTemplate(['포장'], -1)).toEqual(['포장']);
  });
});

describe('moveMemoTemplate', () => {
  test('항목 이동', () => {
    expect(moveMemoTemplate(['A', 'B', 'C', 'D'], 0, 2)).toEqual([
      'B',
      'C',
      'A',
      'D',
    ]);
  });

  test('역방향 이동', () => {
    expect(moveMemoTemplate(['A', 'B', 'C', 'D'], 3, 1)).toEqual([
      'A',
      'D',
      'B',
      'C',
    ]);
  });

  test('동일 인덱스는 변경 없음', () => {
    expect(moveMemoTemplate(['A', 'B'], 0, 0)).toEqual(['A', 'B']);
  });

  test('범위 밖은 변경 없음', () => {
    expect(moveMemoTemplate(['A', 'B'], 5, 0)).toEqual(['A', 'B']);
  });
});

describe('appendChipToMemo', () => {
  test('빈 메모에 칩 추가', () => {
    expect(appendChipToMemo('', '포장')).toBe('포장');
  });

  test('기존 메모에 콤마 + 공백으로 추가', () => {
    expect(appendChipToMemo('덜 맵게', '포장')).toBe('덜 맵게, 포장');
  });

  test('이미 있는 칩은 토글로 제거', () => {
    expect(appendChipToMemo('덜 맵게, 포장', '포장')).toBe('덜 맵게');
  });

  test('대소문자/공백 차이도 같은 칩으로 인식 (토글)', () => {
    expect(appendChipToMemo('포장', ' 포장 ')).toBe('');
  });

  test('60자 초과 시 변경 안 함', () => {
    const long = 'A'.repeat(58);
    // long + ", 포장" = 58 + 4 = 62 > 60
    expect(appendChipToMemo(long, '포장')).toBe(long);
  });
});

describe('isChipActive', () => {
  test('포함되면 true', () => {
    expect(isChipActive('덜 맵게, 포장', '포장')).toBe(true);
  });

  test('미포함은 false', () => {
    expect(isChipActive('덜 맵게', '포장')).toBe(false);
  });

  test('빈 메모는 false', () => {
    expect(isChipActive('', '포장')).toBe(false);
  });

  test('대소문자/공백 무시', () => {
    expect(isChipActive('포장', ' 포장 ')).toBe(true);
  });
});

describe('load/save (AsyncStorage)', () => {
  beforeEach(() => {
    AsyncStorage.__store.clear();
  });

  test('저장값 없으면 기본 템플릿 반환', async () => {
    const list = await loadMemoTemplates();
    expect(list).toEqual(DEFAULT_MEMO_TEMPLATES);
  });

  test('save → load 라운드트립', async () => {
    await saveMemoTemplates(['포장', '빨리']);
    const list = await loadMemoTemplates();
    expect(list).toEqual(['포장', '빨리']);
  });

  test('save 시 빈/중복 자동 정리', async () => {
    const cleaned = await saveMemoTemplates(['', '포장', '포장', '빨리']);
    expect(cleaned).toEqual(['포장', '빨리']);
  });

  test('망가진 JSON 도 load 시 fallback', async () => {
    AsyncStorage.__store.set('mypos:v1:memoTemplates', '{not json');
    const list = await loadMemoTemplates();
    // persistence.loadJSON 이 null fallback → 기본값.
    expect(list).toEqual(DEFAULT_MEMO_TEMPLATES);
  });
});
