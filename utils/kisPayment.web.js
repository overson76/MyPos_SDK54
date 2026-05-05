// KIS-NAGT 카드 단말기 결제 — 웹 빌드(Cloudflare + Electron 렌더러).
//
// Electron(.exe) 환경에서만 활성. 일반 브라우저 / 폰 빌드는 no-op (안전).
// preload.js 가 노출한 window.mypos.kisPay 호출.
//
// 호출:
//   const { ok, mode, data, error } = await kisPay({ amount: 12500, tradeType: 'D1' });
//   if (ok) { /* data.authNo 로 영수증 발행 */ } else { showError(error); }
//
// data 구조 (브릿지 → kis.js → 여기): PaymentResponse 모양 그대로.

export function isKisPaymentAvailable() {
  if (typeof window === 'undefined') return false;
  return !!window.mypos?.isElectron && typeof window.mypos.kisPay === 'function';
}

// 신용 결제 — 정상 흐름.
export async function kisPay(request, options) {
  if (!isKisPaymentAvailable()) {
    return {
      ok: false,
      reason: 'browser',
      message: 'PC 카운터 앱(.exe) 환경에서만 카드 단말기 결제가 가능합니다.',
    };
  }
  try {
    return await window.mypos.kisPay(request || {}, options || {});
  } catch (e) {
    return {
      ok: false,
      reason: 'ipc-error',
      error: String(e && e.message || e),
    };
  }
}

// 신용 취소 — 원거래의 vanKey + 승인일자 + 승인번호 필요.
//   originalApproval 은 이전 kisPay 의 data 객체 그대로 넣으면 됨.
export async function kisCancel(originalApproval, options) {
  if (!isKisPaymentAvailable()) {
    return {
      ok: false,
      reason: 'browser',
      message: 'PC 카운터 앱(.exe) 환경에서만 카드 단말기 취소가 가능합니다.',
    };
  }
  if (!originalApproval || !originalApproval.authNo) {
    return { ok: false, reason: 'invalid', message: '원거래 정보(승인번호)가 없습니다.' };
  }
  // replyDate(YYYYMMDD) → orgAuthDate(YYMMDD) 변환.
  const yyyymmdd = originalApproval.replyDate || '';
  const orgAuthDate = yyyymmdd.length === 8 ? yyyymmdd.slice(2) : '';

  return await kisPay(
    {
      tradeType: 'D2',
      amount: Number(originalApproval.amount || 0),
      orgAuthDate,
      orgAuthNo: originalApproval.authNo,
    },
    options
  );
}

// 매장 셋업 진단 — 관리자 화면 "🏧 KIS 단말기 진단" 버튼이 호출.
//   { ok, mode, message?, error?, exe? }
export async function kisDiagnose() {
  if (!isKisPaymentAvailable()) {
    return { ok: false, reason: 'browser', message: 'PC 카운터 앱(.exe) 환경에서만 진단 가능.' };
  }
  try {
    return await window.mypos.kisDiagnose();
  } catch (e) {
    return { ok: false, reason: 'ipc-error', error: String(e && e.message || e) };
  }
}
