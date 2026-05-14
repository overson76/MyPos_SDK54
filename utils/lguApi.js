// LG U+ Centrex Rest API 클라이언트 — 1.0.44 부터 신설.
//
// 명세: C:\MyProjects\참고자료\LG U+_070인터넷전화 OpenAPI_API 규격서\Centrex\RestAPI\Centrex_Rest_API_v4.3.pdf
// 매뉴얼 챕터: 13(전화 수신시 URL알림 설정), 22(외부인입번호별 수신 통화이력), 8(통화이력 조회).
//
// 인증:
//   - id: 070번호 (예: 07040702874) — SIP 단말 식별번호(1L777133) 와 다름
//   - pass: centrex.uplus.co.kr 로그인 비번을 SHA-512 hex 로 암호화
//   - 비번은 3개월마다 변경 필요 (매뉴얼 1.6)
//
// 운영 안전:
//   - 동시 호출 / 짧은 시간 연달아 호출 시 차단 (매뉴얼 1.6) → 호출 간격 최소 5초 강제
//   - TLS v1.2 준수 (Node.js fetch 기본값 OK)
//
// 사용:
//   const { setRingCallback, sha512 } = require('./lguApi');
//   await setRingCallback({ callbackUrl: '/cid/ring', callbackHost: '119.71.90.184', callbackPort: 8080 });

'use strict';

const crypto = require('node:crypto');

const ENDPOINT_BASE = 'https://centrex.uplus.co.kr/RestApi';

// 매뉴얼 1.5: 비밀번호 SHA-512 hex 암호화.
function sha512(text) {
  return crypto.createHash('sha512').update(String(text)).digest('hex');
}

function getCredentials() {
  const id = process.env.MYPOS_LGU_API_ID;
  const pass = process.env.MYPOS_LGU_API_PASS;
  if (!id || !pass) {
    throw new Error('MYPOS_LGU_API_ID / MYPOS_LGU_API_PASS 환경변수 누락');
  }
  return { id, passHash: sha512(pass) };
}

// 마지막 호출 시각 — rate limit 회피.
let _lastCallAt = 0;
const MIN_CALL_INTERVAL_MS = 5000;

async function _throttleAndFetch(url, options = {}) {
  // 최소 5초 간격 강제 — LG U+ 차단 회피.
  const wait = Math.max(0, MIN_CALL_INTERVAL_MS - (Date.now() - _lastCallAt));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  _lastCallAt = Date.now();

  // 15초 응답 타임아웃.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      ...options,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { SVC_RT: 'PARSE_ERR', SVC_MSG: text.slice(0, 200) }; }
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

// 챕터 13.2/13.3: 전화 수신시 URL알림 정보 설정.
// LG U+ 가 전화 들어오는 순간 callbackHost:callbackPort/callbackUrl 로 HTTP GET 호출.
//
// 응답 SVC_RT:
//   "0000" = OK
//   "1005" = NO_API_PERM_ERR (API 부가서비스 미가입 — 매뉴얼 1.4)
//   기타 = 챕터 29 에러코드 참고
async function setRingCallback({ callbackUrl, callbackHost, callbackPort }) {
  const { id, passHash } = getCredentials();
  if (!callbackUrl || !callbackHost || !callbackPort) {
    throw new Error('callbackUrl / callbackHost / callbackPort 필수');
  }
  // 매뉴얼 13.3 (3): https 지원 X. host 는 IPv4 만.
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(String(callbackHost))) {
    throw new Error(`callbackHost 는 IPv4 만: 받은 값 "${callbackHost}"`);
  }
  const params = new URLSearchParams({
    id,
    pass: passHash,
    callbackurl: callbackUrl,
    callbackhost: callbackHost,
    callbackport: String(callbackPort),
  });
  const url = `${ENDPOINT_BASE}/setringcallback?${params.toString()}`;
  const { ok, status, json } = await _throttleAndFetch(url);
  return {
    ok: ok && json?.SVC_RT === '0000',
    status,
    code: json?.SVC_RT || null,
    message: json?.SVC_MSG || null,
    raw: json,
  };
}

// 진단용 헬스체크 — 환경변수 설정 여부.
function healthCheck() {
  try {
    const { id } = getCredentials();
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

module.exports = {
  sha512,
  setRingCallback,
  healthCheck,
  ENDPOINT_BASE,
};
