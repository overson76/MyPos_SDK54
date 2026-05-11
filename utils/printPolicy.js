// 주문지 출력 정책 저장 / 로드 모듈.
// 두 종류:
//   1) 글로벌 정책 (매장 단위) — 어느 범위(모두/추가/변경/배달) 를 출력할지.
//      모든 기기에서 동일. Firestore 동기화는 차후 단계에서 추가. 1단계는 AsyncStorage.
//   2) 자동 출력 토글 (기기 단위) — PC .exe 에서만 의미.
//      ON 이면 변경 감지 시 자동 출력. OFF 면 수동(🖨️ 버튼)만.
//
// 두 구분 이유: 정책은 매장 직원들이 공유, 자동 출력은 기기마다 다름
// (카운터 PC ON / 주방 PC OFF 같은 매장 약속을 기기별 토글로 표현).

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_POLICY = 'mypos:v1:print:policy';
const KEY_AUTO_ON = 'mypos:v1:print:autoOn';

// 정책 종류 — OrderSlipPicker 의 4종과 키 일치.
export const POLICY_KINDS = ['all', 'added', 'changed', 'delivery'];

// 매장 신규 운영 시 합리적 기본값.
// 추가/변경 항목만 출력 + 배달은 자동 포함. "모두" 는 직원이 명시적으로 켜야 함.
export const DEFAULT_POLICY = Object.freeze({
  kinds: ['added', 'changed', 'delivery'],
});

export function isValidKind(k) {
  return POLICY_KINDS.includes(k);
}

// 정책 로드 — 저장된 게 없으면 DEFAULT_POLICY.
// 형식 깨졌어도 절대 throw 안 함 (AsyncStorage 일반 정책: 파싱 실패 → fallback).
export async function loadPolicy() {
  try {
    const raw = await AsyncStorage.getItem(KEY_POLICY);
    if (!raw) return { ...DEFAULT_POLICY };
    const parsed = JSON.parse(raw);
    const kinds = Array.isArray(parsed?.kinds)
      ? parsed.kinds.filter(isValidKind)
      : [];
    if (kinds.length === 0) return { ...DEFAULT_POLICY };
    return { kinds };
  } catch {
    return { ...DEFAULT_POLICY };
  }
}

// 정책 저장 — kinds 배열만 받음. invalid 키는 자동 제거.
// "all" 은 "added"/"changed" 와 상호 배타로 정리 (UI 와 동일 정책).
export async function savePolicy({ kinds }) {
  const filtered = (Array.isArray(kinds) ? kinds : []).filter(isValidKind);
  const set = new Set(filtered);
  if (set.has('all')) {
    set.delete('added');
    set.delete('changed');
  }
  const sanitized = { kinds: [...set] };
  try {
    await AsyncStorage.setItem(KEY_POLICY, JSON.stringify(sanitized));
  } catch {
    // 저장 실패해도 throw 하지 않음 — 호출부 흐름 깨지면 매장 운영 영향.
  }
  return sanitized;
}

// 정책에 따라 출력할 항목 종류를 결정.
//   policy:    { kinds: [...] }
//   isDelivery: 배달 주문 여부 (배달 주소 섹션 포함 여부 결정)
//   isFresh:    신규 주문 여부
// 반환: 실제 출력에 쓸 kinds Set.
//
// 1.0.30 fix: 사장님 보고 — "배달 주문 자동 출력 옵션이 안 먹고 메뉴/배달주소 다 빠진
// 헤더만 출력". 원인: 사장님 정책에 'delivery' 만 체크하고 'added' 미체크 → kindSet 에
// 'added' 없음 → 신규 주문의 added row 모두 필터링 제거 → toPrint 비어 있음.
//
// 해결: 신규 주문(isFresh) 일 때 정책 무관하게 'added' 자동 추가. 신규 주문은 의미상
// 모든 항목이 새 추가물이므로 메뉴 표시가 자연스러움. 또한 정책 전체가 비어있으면
// 'added' + 'changed' 기본 추가 (안 보이는 사고 방지).
export function resolvePrintKinds(policy, { isDelivery = false, isFresh = false } = {}) {
  const kinds = new Set(policy?.kinds || []);

  // 신규 주문 = 무조건 added 표시 (메뉴 항목 빠짐 방지)
  if (isFresh) kinds.add('added');

  // 정책이 완전히 비어있으면 안전망 — added + changed 자동 추가
  if (kinds.size === 0) {
    kinds.add('added');
    kinds.add('changed');
  }

  if (!isDelivery) kinds.delete('delivery');
  return kinds;
}

// 자동 출력 토글 — PC .exe 에서만 의미. 폰/iPad 에서 호출되어도 storage 만 차지하고 효과 X.
export async function loadAutoOn() {
  try {
    const raw = await AsyncStorage.getItem(KEY_AUTO_ON);
    return raw === 'true';
  } catch {
    return false;
  }
}

export async function saveAutoOn(enabled) {
  try {
    await AsyncStorage.setItem(KEY_AUTO_ON, enabled ? 'true' : 'false');
  } catch {
    // 토글 저장 실패해도 침묵.
  }
}
