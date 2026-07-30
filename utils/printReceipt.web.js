// 웹 빌드용 영수증 출력 — Electron 환경에서만 활성. 일반 브라우저(Chrome 등) 에서는 no-op.
//
// `window.mypos.isElectron` 체크 — preload.js 가 contextBridge 로 노출.
// .exe 빌드 안의 렌더러는 true / 일반 브라우저는 undefined.
//
// 호출 모양:
//   const result = await printReceipt(receipt, { mode: 'simulate' });
//   if (!result.ok) showError(result.error);

import { buildReceiptText } from './escposBuilder';

export function isPrinterAvailable() {
  if (typeof window === 'undefined') return false;
  return !!window.mypos?.isElectron;
}

// 영수증 객체를 여기(렌더러) 에서 텍스트로 굳혀 rawText 로 넘긴다.
//
// 2026-07-30: 넘기기 전에 굳히는 이유 — 배포 경로. rawText 없이 객체만 보내면
// .exe 메인 프로세스가 *자기 안에 번들된* buildReceiptText 로 본문을 만든다.
// 즉 영수증 양식을 고쳐도 .exe 를 재빌드할 때까지 매장에 안 들어간다.
// 렌더러는 라이브 URL 번들이라 deploy:web 즉시 반영 — 양식 변경 전부가 이 경로를 탄다.
function freezeToRawText(receipt) {
  const r = receipt || {};
  if (r.rawText) return r;
  try {
    return { ...r, rawText: buildReceiptText(r) };
  } catch {
    // 빌드 실패해도 출력은 살린다 — 메인 프로세스 폴백(구 양식) 으로 진행.
    return r;
  }
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
    return await window.mypos.printReceipt(freezeToRawText(receipt), options);
  } catch (e) {
    return {
      ok: false,
      reason: 'ipc-error',
      error: String(e && e.message || e),
    };
  }
}
