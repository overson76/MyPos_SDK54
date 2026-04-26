import { Platform } from 'react-native';

const KOREAN_NUMS = {
  한그릇: 1,
  한잔: 1,
  한개: 1,
  하나: 1,
  한: 1,
  두그릇: 2,
  두잔: 2,
  두개: 2,
  둘: 2,
  두: 2,
  세그릇: 3,
  세잔: 3,
  세개: 3,
  셋: 3,
  세: 3,
  네그릇: 4,
  네잔: 4,
  네개: 4,
  넷: 4,
  네: 4,
  다섯: 5,
  여섯: 6,
  일곱: 7,
  여덟: 8,
  아홉: 9,
  열: 10,
};

const NUM_ENTRIES = Object.entries(KOREAN_NUMS).sort(
  (a, b) => b[0].length - a[0].length
);

// 플랫폼 감지 — Web Speech API 는 브라우저(웹)에서만 동작한다.
// Expo Go(폰) 환경에서는 네이티브 음성 인식 모듈이 없으므로 불가 → 사용자에게 안내 목적 플래그 구분
export function getVoicePlatform() {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return 'unsupported';
    if (window.SpeechRecognition || window.webkitSpeechRecognition) return 'web';
    return 'web-unsupported';
  }
  // iOS / Android (Expo Go) — 네이티브 모듈 필요
  return 'native-unsupported';
}

export function isVoiceInputSupported() {
  return getVoicePlatform() === 'web';
}

// 음성 인식을 사용할 수 없는 경우 안내 메시지. UI 쪽에서 Alert 로 표시.
export function getVoiceUnsupportedMessage() {
  const p = getVoicePlatform();
  if (p === 'web') return null;
  if (p === 'web-unsupported') {
    return '이 브라우저는 음성 인식을 지원하지 않습니다. Chrome 또는 Edge 브라우저에서 시도해 주세요.';
  }
  // 폰(Expo Go)
  return (
    '폰에서 음성 인식을 사용하려면 개발 빌드(expo run:android / run:ios)가 필요합니다.\n' +
    '현재 Expo Go 에서는 웹 브라우저 (Chrome/Edge) 에서만 마이크 기능이 동작합니다.\n\n' +
    '임시: 컴퓨터/태블릿의 웹 브라우저에서 접속하여 사용해 주세요.'
  );
}

export function createRecognition() {
  if (Platform.OS !== 'web') return null;
  if (typeof window === 'undefined') return null;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = 'ko-KR';
  rec.continuous = true;
  rec.interimResults = true;
  return rec;
}

function parseQtyAfter(after) {
  const trimmed = after.replace(/^\s+/, '');
  const digit = trimmed.match(/^([0-9]+)/);
  if (digit) return parseInt(digit[1], 10);
  const nospace = trimmed.replace(/\s+/g, '');
  for (const [k, v] of NUM_ENTRIES) {
    if (nospace.startsWith(k)) return v;
  }
  return 1;
}

export function parseVoiceOrder(text, menuItems) {
  if (!text) return [];
  const results = [];

  const names = [];
  menuItems.forEach((item) => {
    if (item.shortName) names.push({ item, name: item.shortName });
    if (item.name && item.name !== item.shortName) {
      names.push({ item, name: item.name });
    }
  });
  names.sort((a, b) => b.name.length - a.name.length);

  let scratch = text;

  for (const { item, name } of names) {
    const idx = scratch.indexOf(name);
    if (idx < 0) continue;
    const after = scratch.slice(idx + name.length, idx + name.length + 20);
    const qty = parseQtyAfter(after);
    results.push({ item, qty });
    scratch =
      scratch.slice(0, idx) +
      '\u0000'.repeat(name.length) +
      scratch.slice(idx + name.length);
  }

  return results;
}
