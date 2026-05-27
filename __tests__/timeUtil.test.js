import {
  parseDeliveryTime,
  formatKorean12h,
  formatShort12h,
  deliveryDateFromParsed,
} from '../utils/timeUtil';

describe('parseDeliveryTime', () => {
  test('null/빈문자/공백은 null', () => {
    expect(parseDeliveryTime(null, false)).toBeNull();
    expect(parseDeliveryTime('', false)).toBeNull();
    expect(parseDeliveryTime('   ', false)).toBeNull();
  });

  test('자릿수 부족/초과 거부', () => {
    expect(parseDeliveryTime('1', false)).toBeNull();
    expect(parseDeliveryTime('12', false)).toBeNull();
    expect(parseDeliveryTime('12345', false)).toBeNull();
  });

  test('3자리는 H + MM 으로 파싱', () => {
    expect(parseDeliveryTime('420', false)).toEqual({ h: 4, m: 20, h24: 4, period: 'AM' });
  });

  test('4자리는 HH + MM 으로 파싱', () => {
    expect(parseDeliveryTime('1130', true)).toEqual({ h: 11, m: 30, h24: 23, period: 'PM' });
  });

  test('콜론 포함도 동일하게 처리', () => {
    expect(parseDeliveryTime('4:20', true)).toEqual({ h: 4, m: 20, h24: 16, period: 'PM' });
    expect(parseDeliveryTime('11:30', false)).toEqual({ h: 11, m: 30, h24: 11, period: 'AM' });
  });

  test('12 AM 은 자정(0시)', () => {
    expect(parseDeliveryTime('1200', false).h24).toBe(0);
  });

  test('12 PM 은 정오(12시)', () => {
    expect(parseDeliveryTime('1200', true).h24).toBe(12);
  });

  test('h 가 1-12 범위 밖이면 null', () => {
    expect(parseDeliveryTime('1330', false)).toBeNull(); // h=13
    expect(parseDeliveryTime('0030', false)).toBeNull(); // h=0
  });

  test('m > 59 이면 null', () => {
    expect(parseDeliveryTime('1260', false)).toBeNull();
  });
});

describe('formatKorean12h', () => {
  test('null 은 빈 문자열', () => {
    expect(formatKorean12h(null)).toBe('');
  });

  test('AM 포맷', () => {
    expect(formatKorean12h({ h: 9, m: 5, period: 'AM' })).toBe('오전 9시 05분');
  });

  test('PM 포맷', () => {
    expect(formatKorean12h({ h: 4, m: 20, period: 'PM' })).toBe('오후 4시 20분');
  });
});

describe('formatShort12h', () => {
  test('짧은 형식 — 콜론 포함', () => {
    expect(formatShort12h({ h: 4, m: 20, period: 'PM' })).toBe('오후 4:20');
    expect(formatShort12h({ h: 9, m: 5, period: 'AM' })).toBe('오전 9:05');
  });

  // 사고 2026-05-27: TableScreen 이 문자열("420") 을 직접 넘겨서 parsed.m.toString() 폭발.
  // 호출부 fix + 여기 방어 가드 — 어떤 비정상 인자도 throw 하지 말 것.
  test('비정상 인자 — 절대 throw 하지 않고 빈 문자열', () => {
    expect(formatShort12h(null)).toBe('');
    expect(formatShort12h(undefined)).toBe('');
    expect(formatShort12h('420')).toBe('');
    expect(formatShort12h(420)).toBe('');
    expect(formatShort12h({})).toBe('');
    expect(formatShort12h({ h: 5 })).toBe('');
    expect(formatShort12h({ m: 20 })).toBe('');
    expect(formatShort12h({ h: undefined, m: 20, period: 'PM' })).toBe('');
    expect(formatShort12h({ h: 5, m: undefined, period: 'PM' })).toBe('');
  });
});

describe('formatKorean12h — 방어 가드 (사고 2026-05-27)', () => {
  test('비정상 인자 — 절대 throw 하지 않고 빈 문자열', () => {
    expect(formatKorean12h('420')).toBe('');
    expect(formatKorean12h({})).toBe('');
    expect(formatKorean12h({ h: 5 })).toBe('');
    expect(formatKorean12h({ m: 20 })).toBe('');
  });
});

describe('deliveryDateFromParsed', () => {
  test('null 입력은 null', () => {
    expect(deliveryDateFromParsed(null)).toBeNull();
  });

  test('오늘 날짜 + h24/m 으로 Date 생성', () => {
    const d = deliveryDateFromParsed({ h: 4, m: 20, h24: 16, period: 'PM' });
    expect(d).toBeInstanceOf(Date);
    expect(d.getHours()).toBe(16);
    expect(d.getMinutes()).toBe(20);
    expect(d.getSeconds()).toBe(0);
  });
});
