// 사용자 입력 (예: "420", "4:20", "1220", "12:20") + AM/PM → 파싱 결과
// 반환: { h: 1-12, m: 0-59, h24: 0-23, period: 'AM'|'PM' } 또는 null
export function parseDeliveryTime(text, isPM) {
  if (text == null) return null;
  const trimmed = String(text).trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 3 || digits.length > 4) return null;
  let h, m;
  if (digits.length === 3) {
    h = parseInt(digits.slice(0, 1), 10);
    m = parseInt(digits.slice(1), 10);
  } else {
    h = parseInt(digits.slice(0, 2), 10);
    m = parseInt(digits.slice(2), 10);
  }
  if (isNaN(h) || isNaN(m)) return null;
  if (h < 1 || h > 12 || m > 59) return null;
  let h24 = h;
  if (h === 12) h24 = isPM ? 12 : 0;
  else if (isPM) h24 = h + 12;
  return { h, m, h24, period: isPM ? 'PM' : 'AM' };
}

export function formatKorean12h(parsed) {
  if (!parsed) return '';
  const p = parsed.period === 'PM' ? '오후' : '오전';
  return `${p} ${parsed.h}시 ${parsed.m.toString().padStart(2, '0')}분`;
}

export function formatShort12h(parsed) {
  if (!parsed) return '';
  const p = parsed.period === 'PM' ? '오후' : '오전';
  return `${p} ${parsed.h}:${parsed.m.toString().padStart(2, '0')}`;
}

// 오늘 날짜 기준 Date 생성
export function deliveryDateFromParsed(parsed) {
  if (!parsed) return null;
  const d = new Date();
  d.setHours(parsed.h24, parsed.m, 0, 0);
  return d;
}
