// 주문 메모 자주 쓰는 문구(템플릿) 영속화 + 순수 헬퍼.
// - 사장님이 관리자에서 직접 편집 (매장마다 자주 쓰는 메모 다름)
// - OrderScreen 메모 모달의 칩으로 노출 — 누르면 입력창에 append
// - validate 정책: 한 칩 12자, 최대 30개. 빈/중복/제어문자 제거.

import { loadJSON, saveJSON } from './persistence';

const STORAGE_KEY = 'memoTemplates';

export const MEMO_TEMPLATE_LIMITS = {
  CHIP_MAX_LEN: 12, // 한 칩 (UI 좁아서 짧게)
  CHIP_MAX_COUNT: 30, // 모달 한 줄에 깔리는 최대 개수
  MEMO_INPUT_MAX_LEN: 60, // 메모 입력창 자체 (OrderScreen TextInput maxLength 와 동일)
};

// 한식·분식·중식·치킨·카페 어디서나 흔히 쓰는 기본값.
// 사장님이 마음에 안 들면 관리자에서 자유롭게 갈아엎을 수 있음.
export const DEFAULT_MEMO_TEMPLATES = [
  '덜 맵게',
  '안 맵게',
  '많이',
  '적게',
  '포장',
  '따로 포장',
  '빨리',
  '아이용',
  '잘 익혀',
  '덜 익혀',
];

// 제어문자(NUL/탭/CR/LF) 제거. 일반 공백·하이픈 보존.
function stripControlChars(s) {
  return s.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '');
}

// 한 칩(문구) 정규화. 빈 문자열 = 무효.
export function sanitizeMemoChip(input) {
  const s = stripControlChars(String(input ?? '')).trim();
  if (!s) return '';
  return s.slice(0, MEMO_TEMPLATE_LIMITS.CHIP_MAX_LEN);
}

// 배열 전체 정규화 — 빈/중복(대소문자/공백 정규화 기준) 제거, 최대 개수 cap.
export function normalizeMemoTemplates(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const v = sanitizeMemoChip(raw);
    if (!v) continue;
    // 중복 판정은 공백 압축 + lowercase. 표시는 원형 유지.
    const k = v.replace(/\s+/g, ' ').toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
    if (out.length >= MEMO_TEMPLATE_LIMITS.CHIP_MAX_COUNT) break;
  }
  return out;
}

// 추가 — 이미 있으면 그대로 반환 (UI 측에서 hint 표시 가능).
export function addMemoTemplate(list, value) {
  const arr = normalizeMemoTemplates(list);
  const v = sanitizeMemoChip(value);
  if (!v) return arr;
  const k = v.replace(/\s+/g, ' ').toLowerCase();
  if (arr.some((x) => x.replace(/\s+/g, ' ').toLowerCase() === k)) return arr;
  if (arr.length >= MEMO_TEMPLATE_LIMITS.CHIP_MAX_COUNT) return arr;
  return [...arr, v];
}

export function removeMemoTemplate(list, index) {
  const arr = normalizeMemoTemplates(list);
  if (index < 0 || index >= arr.length) return arr;
  return arr.filter((_, i) => i !== index);
}

// 순서 변경 — fromIdx 항목을 toIdx 위치로 이동.
export function moveMemoTemplate(list, fromIdx, toIdx) {
  const arr = normalizeMemoTemplates(list);
  if (
    fromIdx < 0 ||
    fromIdx >= arr.length ||
    toIdx < 0 ||
    toIdx >= arr.length ||
    fromIdx === toIdx
  ) {
    return arr;
  }
  const next = arr.slice();
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return next;
}

// 칩을 메모 입력값 뒤에 자연스럽게 붙임.
// - 이미 같은 단어가 들어있으면 토글(제거).
// - 콤마 + 공백 으로 구분. 마지막 길이가 MEMO_INPUT_MAX_LEN 초과하면 무시.
// - 메모 입력창에서 토글 UX 의 핵심 로직.
export function appendChipToMemo(currentMemo, chip) {
  const memo = String(currentMemo ?? '');
  const c = sanitizeMemoChip(chip);
  if (!c) return memo;

  // 콤마/공백 구분으로 token 분해 — 토글 판정용.
  const tokens = memo
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter(Boolean);
  const ck = c.replace(/\s+/g, ' ').toLowerCase();
  const matchIdx = tokens.findIndex(
    (t) => t.replace(/\s+/g, ' ').toLowerCase() === ck
  );

  let nextTokens;
  if (matchIdx >= 0) {
    // 이미 있으면 제거 (토글)
    nextTokens = tokens.filter((_, i) => i !== matchIdx);
  } else {
    nextTokens = [...tokens, c];
  }

  const joined = nextTokens.join(', ');
  if (joined.length > MEMO_TEMPLATE_LIMITS.MEMO_INPUT_MAX_LEN) {
    // 길이 초과면 변경 안 함 — UI 가 hint 띄울 수 있음.
    return memo;
  }
  return joined;
}

// 현재 메모에 칩이 포함되어 있는지 — UI 가 칩의 활성/비활성 상태 표시.
export function isChipActive(currentMemo, chip) {
  const memo = String(currentMemo ?? '');
  const c = sanitizeMemoChip(chip);
  if (!c) return false;
  const ck = c.replace(/\s+/g, ' ').toLowerCase();
  return memo
    .split(/[,，]/)
    .map((t) => t.trim().replace(/\s+/g, ' ').toLowerCase())
    .filter(Boolean)
    .some((t) => t === ck);
}

// AsyncStorage 영속화. 저장값 없으면 기본값 반환.
export async function loadMemoTemplates() {
  const raw = await loadJSON(STORAGE_KEY, null);
  if (raw == null) return DEFAULT_MEMO_TEMPLATES.slice();
  return normalizeMemoTemplates(raw);
}

export async function saveMemoTemplates(list) {
  const cleaned = normalizeMemoTemplates(list);
  await saveJSON(STORAGE_KEY, cleaned);
  return cleaned;
}
