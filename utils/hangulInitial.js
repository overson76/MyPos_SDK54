// 한글 초성 추출 헬퍼 — 주소록 가나다순 빠른찾기 인덱스 바 용.
//
// "젠틀맨" → "ㅈ", "Apple" → "A", "123" → "#"
// 쌍자음(ㄲ/ㄸ/ㅃ/ㅆ/ㅉ)은 기본 자음(ㄱ/ㄷ/ㅂ/ㅅ/ㅈ)으로 정규화 — 인덱스 단순화.

const CHO_LIST = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];

const NORMALIZE = {
  'ㄲ': 'ㄱ',
  'ㄸ': 'ㄷ',
  'ㅃ': 'ㅂ',
  'ㅆ': 'ㅅ',
  'ㅉ': 'ㅈ',
};

// 인덱스 바 표시 순서. 가나다 14개 + 영문 A(영문/숫자 전체) + #(기타).
export const HANGUL_INDEX_BAR = [
  'ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
  'A', '#',
];

// 단일 문자 → 초성 인덱스.
// 한글: 초성 자음 (ㄲ→ㄱ 정규화).
// 영문(A-Z, a-z): 'A' (그룹).
// 그 외: '#' (숫자/기호/빈 문자열).
export function getInitial(str) {
  const s = String(str || '').trim();
  if (!s) return '#';
  const ch = s.charAt(0);
  const code = ch.charCodeAt(0);

  // 한글 음절(가-힣): 0xAC00 ~ 0xD7A3
  if (code >= 0xac00 && code <= 0xd7a3) {
    const offset = code - 0xac00;
    const choIdx = Math.floor(offset / 588);
    const cho = CHO_LIST[choIdx];
    return NORMALIZE[cho] || cho;
  }

  // 한글 자음 단독(ㄱ-ㅎ): 0x3131 ~ 0x314E
  if (code >= 0x3131 && code <= 0x314e) {
    return NORMALIZE[ch] || ch;
  }

  // 영문
  if (/[a-zA-Z]/.test(ch)) return 'A';

  return '#';
}

// entry 의 표시 우선순위 — 별칭 > 라벨. 빈 문자열이면 '#'.
export function getEntryInitial(entry) {
  const display = (entry?.alias || '').trim() || entry?.label || '';
  return getInitial(display);
}
