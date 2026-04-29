// 네이티브(iOS/Android) 빌드용 — 폰에서는 영수증 프린터 사용 안 함.
// 매장 영수증 출력은 카운터 PC (Electron) 흐름.

export async function printReceipt() {
  return { ok: false, reason: 'native', message: '폰 빌드는 영수증 출력을 지원하지 않습니다.' };
}

export function isPrinterAvailable() {
  return false;
}
