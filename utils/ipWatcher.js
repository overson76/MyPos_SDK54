// 매장 광 공유기 WAN IP 변경 감지 + LG U+ setringcallback 자동 재등록 — 1.0.44.
//
// 배경:
//   LG U+ Centrex API 의 callbackhost 는 IPv4 만 받음 (도메인 X). 매장 광 공유기의 WAN IP 가
//   유동(DHCP 임대 6시간) 이라 IP 가 바뀔 때마다 setringcallback 재호출 필요. 안 그러면
//   LG U+ 가 옛 IP 로 webhook 호출 → 매장 PC 도달 X.
//
// 동작:
//   - start() 호출 시 즉시 1회 setringcallback (현재 외부 IP 박음)
//   - 그 후 1시간 (3600초) 마다 ipinfo.io 호출로 외부 IP 체크
//   - 마지막 등록 IP 와 비교해서 변경됐으면 setringcallback 재호출
//   - 호출 결과는 진단 상태에 캡처 — AdminScreen 의 CID 진단 카드가 표시
//
// rate limit (매뉴얼 1.6) 회피:
//   - lguApi.js 가 호출 간격 최소 5초 강제. 우리는 1시간 간격이라 무관.

'use strict';

const lguApi = require('./lguApi');

const POLL_INTERVAL_MS = 60 * 60 * 1000; // 1시간

const _diag = {
  running: false,
  startedAt: null,
  lastCheckedAt: null,
  lastKnownIp: null,
  registeredCallbackHost: null,
  registeredCallbackUrl: null,
  registeredCallbackPort: null,
  totalChecks: 0,
  totalRegistrations: 0,
  lastRegistrationAt: null,
  lastRegistrationResult: null,
  lastError: null,
};

let _timer = null;
let _stopFlag = false;

async function _detectPublicIp() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch('https://ipinfo.io/json', { signal: ctrl.signal });
    clearTimeout(t);
    const json = await res.json();
    return json?.ip || null;
  } catch (e) {
    _diag.lastError = `외부 IP 조회 실패: ${(e && e.message) || e}`;
    return null;
  }
}

async function _registerIfChanged({ callbackUrl, callbackPort }) {
  _diag.totalChecks += 1;
  _diag.lastCheckedAt = new Date().toISOString();

  const publicIp = await _detectPublicIp();
  if (!publicIp) return; // 다음 주기 재시도
  _diag.lastKnownIp = publicIp;

  // 같은 IP + 같은 URL/PORT 면 재등록 skip (rate limit 보호).
  if (_diag.registeredCallbackHost === publicIp &&
      _diag.registeredCallbackUrl === callbackUrl &&
      _diag.registeredCallbackPort === callbackPort) {
    return;
  }

  _diag.totalRegistrations += 1;
  _diag.lastRegistrationAt = new Date().toISOString();
  try {
    const result = await lguApi.setRingCallback({
      callbackUrl,
      callbackHost: publicIp,
      callbackPort,
    });
    _diag.lastRegistrationResult = {
      ok: result.ok,
      code: result.code,
      message: result.message,
    };
    if (result.ok) {
      _diag.registeredCallbackHost = publicIp;
      _diag.registeredCallbackUrl = callbackUrl;
      _diag.registeredCallbackPort = callbackPort;
      _diag.lastError = null;
    } else {
      _diag.lastError = `setringcallback 실패: ${result.code} ${result.message}`;
    }
  } catch (e) {
    _diag.lastRegistrationResult = { ok: false, code: 'THROW', message: (e && e.message) || String(e) };
    _diag.lastError = `setringcallback 예외: ${(e && e.message) || e}`;
  }
}

async function start({ callbackUrl, callbackPort }) {
  if (_timer) return false;
  _stopFlag = false;
  _diag.running = true;
  _diag.startedAt = new Date().toISOString();

  // 부팅 시 즉시 1회.
  await _registerIfChanged({ callbackUrl, callbackPort });

  // 주기적 체크.
  _timer = setInterval(async () => {
    if (_stopFlag) return;
    await _registerIfChanged({ callbackUrl, callbackPort });
  }, POLL_INTERVAL_MS);

  return true;
}

function stop() {
  _stopFlag = true;
  if (_timer) { clearInterval(_timer); _timer = null; }
  _diag.running = false;
}

// 강제 즉시 재등록 (AdminScreen 의 "지금 등록" 버튼용).
async function forceRegisterNow({ callbackUrl, callbackPort }) {
  // 강제 — 같은 IP 라도 다시 호출하도록 비교 값 reset.
  _diag.registeredCallbackHost = null;
  await _registerIfChanged({ callbackUrl, callbackPort });
  return { ..._diag };
}

function getDiagnosis() {
  return { ..._diag };
}

module.exports = { start, stop, forceRegisterNow, getDiagnosis };
