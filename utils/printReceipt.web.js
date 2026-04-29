// 웹 빌드용 영수증 출력 — Electron 환경에서만 활성. 일반 브라우저(Chrome 등) 에서는 no-op.
//
// `window.mypos.isElectron` 체크 — preload.js 가 contextBridge 로 노출.
// .exe 빌드 안의 렌더러는 true / 일반 브라우저는 undefined.
//
// 호출 모양:
//   const result = await printReceipt(receipt, { mode: 'simulate' });
//   if (!result.ok) showError(result.error);

export function isPrinterAvailable() {
  if (typeof window === 'undefined') return false;
  return !!window.mypos?.isElectron;
}

export async function printReceipt(receipt, options) {
  if (!isPrinterAvailable()) {
    return {
      ok: false,
      reason: 'browser',
      message: 'PC 카운터 앱(.exe) 환경에서만 영수증 출력이 가능합니다.',
    };
  }
  try {
    return await window.mypos.printReceipt(receipt, options);
  } catch (e) {
    return {
      ok: false,
      reason: 'ipc-error',
      error: String(e && e.message || e),
    };
  }
}
