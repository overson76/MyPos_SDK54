// 네이티브(iOS/Android) 빌드 — 폰에서는 카드 단말기 연동 안 함.
// 카드 결제는 매장 카운터 PC (Electron .exe) 흐름.

export function isKisPaymentAvailable() {
  return false;
}

export async function kisPay() {
  return { ok: false, reason: 'native', message: '폰 빌드는 카드 단말기 결제를 지원하지 않습니다.' };
}

export async function kisCancel() {
  return { ok: false, reason: 'native', message: '폰 빌드는 카드 단말기 결제를 지원하지 않습니다.' };
}

export async function kisDiagnose() {
  return { ok: false, reason: 'native', message: '폰 빌드는 진단을 지원하지 않습니다.' };
}
