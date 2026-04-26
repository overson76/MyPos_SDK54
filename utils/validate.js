// 사용자 입력 정규화 / 길이·형식 검증.
// 정책: 가능하면 잘라서 통과(silent clamp), 명백히 잘못된 형식만 무효화.
// 입력값이 잘못 들어와도 앱이 멎지 않도록 안전하게 동작하는 게 목표.

const LIMITS = {
  MENU_NAME: 30,
  MENU_SHORT_NAME: 12,
  MENU_PRICE_MAX: 10_000_000, // 천만원 — 합리적 상한
  DELIVERY_ADDR: 200,
  DELIVERY_TIME_RAW: 8, // "23:59" + 여유
  // expo-image-picker quality 0.7 + 적절한 사이즈면 1MB 이내. 안전 마진 2MB.
  IMAGE_DATA_URL_BYTES: 2 * 1024 * 1024,
};

// 제어문자(NUL/탭/CR/LF/...) 제거. 일반 공백·하이픈은 보존.
function stripControlChars(s) {
  return s.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '');
}

export function sanitizeMenuName(input) {
  const s = stripControlChars(String(input ?? '')).trim();
  if (!s) return '';
  return s.slice(0, LIMITS.MENU_NAME);
}

export function sanitizeMenuShortName(input) {
  const s = stripControlChars(String(input ?? '')).trim();
  return s.slice(0, LIMITS.MENU_SHORT_NAME);
}

// 숫자 외 문자 제거, 정수화, 0..MAX 클램프
export function sanitizeMenuPrice(input) {
  if (input == null || input === '') return 0;
  const cleaned = String(input).replace(/[^0-9]/g, '');
  if (!cleaned) return 0;
  const n = parseInt(cleaned, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(LIMITS.MENU_PRICE_MAX, n);
}

export function sanitizeDeliveryAddress(input) {
  const s = stripControlChars(String(input ?? '')).trim();
  return s.slice(0, LIMITS.DELIVERY_ADDR);
}

// 자유 입력 (예: "11", "1130", "11:30") → 숫자/콜론만, 길이만 캡. 파싱은 timeUtil 책임.
export function sanitizeDeliveryTimeRaw(input) {
  const s = String(input ?? '').replace(/[^0-9:]/g, '');
  return s.slice(0, LIMITS.DELIVERY_TIME_RAW);
}

// data:image/...;base64,... 형식만 허용. 너무 큰 이미지는 거부.
export function sanitizeImageDataUrl(input) {
  if (typeof input !== 'string') return null;
  if (!/^data:image\/[a-zA-Z0-9+.\-]+;base64,/.test(input)) return null;
  // base64 길이 ≈ 원본 바이트 * 4/3. 빠른 근사로 문자열 길이 체크.
  if (input.length > LIMITS.IMAGE_DATA_URL_BYTES) return null;
  return input;
}

export const VALIDATE_LIMITS = LIMITS;
