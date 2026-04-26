import {
  sanitizeMenuName,
  sanitizeMenuShortName,
  sanitizeMenuPrice,
  sanitizeDeliveryAddress,
  sanitizeDeliveryTimeRaw,
  sanitizeImageDataUrl,
  VALIDATE_LIMITS,
} from '../utils/validate';

describe('sanitizeMenuName', () => {
  test('null/undefined 은 빈 문자열', () => {
    expect(sanitizeMenuName(null)).toBe('');
    expect(sanitizeMenuName(undefined)).toBe('');
  });

  test('앞뒤 공백 제거', () => {
    expect(sanitizeMenuName('  김치찌개  ')).toBe('김치찌개');
  });

  test('상한 길이로 자른다 (silent clamp)', () => {
    const long = 'A'.repeat(100);
    expect(sanitizeMenuName(long)).toHaveLength(VALIDATE_LIMITS.MENU_NAME);
  });

  test('제어문자 (NUL/CR) 제거하지만 일반 공백은 보존', () => {
    expect(sanitizeMenuName('김\x00치 찌\x0D개')).toBe('김치 찌개');
  });
});

describe('sanitizeMenuShortName', () => {
  test('상한 길이로 자른다', () => {
    expect(sanitizeMenuShortName('A'.repeat(50))).toHaveLength(VALIDATE_LIMITS.MENU_SHORT_NAME);
  });
});

describe('sanitizeMenuPrice', () => {
  test('빈 값 / null 은 0', () => {
    expect(sanitizeMenuPrice('')).toBe(0);
    expect(sanitizeMenuPrice(null)).toBe(0);
    expect(sanitizeMenuPrice(undefined)).toBe(0);
  });

  test('숫자 외 문자 제거', () => {
    expect(sanitizeMenuPrice('12,000원')).toBe(12000);
    expect(sanitizeMenuPrice('₩ 8,500')).toBe(8500);
  });

  test('상한 클램프', () => {
    expect(sanitizeMenuPrice('999999999999')).toBe(VALIDATE_LIMITS.MENU_PRICE_MAX);
  });

  test('음수는 들어올 수 없음 (- 가 제거됨)', () => {
    expect(sanitizeMenuPrice('-500')).toBe(500);
  });

  test('숫자가 전혀 없으면 0', () => {
    expect(sanitizeMenuPrice('abc')).toBe(0);
  });
});

describe('sanitizeDeliveryAddress', () => {
  test('상한 길이 200', () => {
    expect(sanitizeDeliveryAddress('가'.repeat(300))).toHaveLength(VALIDATE_LIMITS.DELIVERY_ADDR);
  });

  test('하이픈 / 숫자 / 공백 보존', () => {
    expect(sanitizeDeliveryAddress(' 서울시 강남구 역삼동 123-45 ')).toBe(
      '서울시 강남구 역삼동 123-45'
    );
  });
});

describe('sanitizeDeliveryTimeRaw', () => {
  test('숫자/콜론만 남긴다', () => {
    expect(sanitizeDeliveryTimeRaw('12:30 PM')).toBe('12:30');
    expect(sanitizeDeliveryTimeRaw('abc1230')).toBe('1230');
  });

  test('길이 8 캡', () => {
    expect(sanitizeDeliveryTimeRaw('123456789')).toHaveLength(8);
  });
});

describe('sanitizeImageDataUrl', () => {
  test('올바른 data:image dataURL 통과', () => {
    const url = 'data:image/png;base64,iVBORw0KGgo=';
    expect(sanitizeImageDataUrl(url)).toBe(url);
  });

  test('http URL 거부', () => {
    expect(sanitizeImageDataUrl('http://example.com/x.png')).toBeNull();
  });

  test('비-image dataURL 거부', () => {
    expect(sanitizeImageDataUrl('data:text/plain;base64,SGVsbG8=')).toBeNull();
  });

  test('null/숫자 입력 거부', () => {
    expect(sanitizeImageDataUrl(null)).toBeNull();
    expect(sanitizeImageDataUrl(123)).toBeNull();
  });

  test('상한 초과는 거부', () => {
    const big = 'data:image/png;base64,' + 'A'.repeat(VALIDATE_LIMITS.IMAGE_DATA_URL_BYTES + 1);
    expect(sanitizeImageDataUrl(big)).toBeNull();
  });
});
