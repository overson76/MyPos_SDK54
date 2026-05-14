// CID (발신자 번호 자동 감지) — LG U+ 센트릭스 SIP 연동.
//
// 동작:
//   1. SIP 서버에 REGISTER → 착신 수신 대기
//   2. 전화 오면(INVITE) → 발신번호 추출 → Firebase 에 기록
//   3. 모든 기기(폰/PC)가 실시간 감지 → 배달 주소록 조회 → 팝업 표시
//
// 설정 (환경변수 또는 직접):
//   MYPOS_SIP_HOST     — SIP 서버 주소 (예: sip.lgdacom.net)
//   MYPOS_SIP_USER     — SIP 사용자 ID (예: tmpid7133)
//   MYPOS_SIP_PASS     — SIP 비밀번호
//   MYPOS_SIP_DOMAIN   — SIP 도메인 (예: premium_c_347878.lgdacom.net)
//   MYPOS_SIP_PORT     — SIP 포트 (기본 5060)

'use strict';

const dgram = require('node:dgram');

// 진단 상태 — production .exe 에서 SIP 가 어디서 막히는지 IPC 로 읽어내기 위함.
// console.log 는 매장 PC 사장님이 못 봄. 그래서 모든 단계를 메모리에 캡처.
const _diag = {
  sipPackageLoaded: false,
  sipPackageError: null,
  listenerStartCalled: false,
  listenerStartedAt: null,
  configSnapshot: null,
  sipStartError: null,
  registerSentCount: 0,
  registerLastAt: null,
  lastResponseStatus: null,
  lastResponseAt: null,
  lastInviteAt: null,
  lastInviteFrom: null,
  lastError: null,
};

// sip 0.0.6 은 EventEmitter 가 아닌 함수 모음. on/digest 가 직접 export 안 돼 있음.
// digest 는 별도 모듈(sip/digest)로 require 해야 함. on 은 아예 없으므로 호출 X.
let sip;
let sipDigest;
try {
  sip = require('sip');
  try { sipDigest = require('sip/digest'); } catch { sipDigest = null; }
  _diag.sipPackageLoaded = true;
} catch (e) {
  // sip 패키지 없으면 조용히 disable + 진단 캡처
  sip = null;
  sipDigest = null;
  _diag.sipPackageError = (e && e.message) || String(e);
}

// ── 설정 ──────────────────────────────────────────────────────────────────────
function getConfig() {
  return {
    host: process.env.MYPOS_SIP_HOST || '192.168.10.100',  // LG U+ 센트릭스 로컬 SIP 서버
    port: Number(process.env.MYPOS_SIP_PORT) || 5060,
    user: process.env.MYPOS_SIP_USER || 'tmpid7133',
    pass: process.env.MYPOS_SIP_PASS || '1L777133',
    domain: process.env.MYPOS_SIP_DOMAIN || 'lgdacom.net',
    ext: process.env.MYPOS_SIP_EXT || '7133',
    transport: process.env.MYPOS_SIP_TRANSPORT || 'udp',
  };
}

// 진단용 — PASS 는 길이만, 환경변수 설정 여부도 함께.
function snapshotConfig() {
  const cfg = getConfig();
  return {
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    domain: cfg.domain,
    ext: cfg.ext,
    transport: cfg.transport,
    passSet: !!cfg.pass,
    passLength: cfg.pass ? cfg.pass.length : 0,
    envHostSet: !!process.env.MYPOS_SIP_HOST,
    envUserSet: !!process.env.MYPOS_SIP_USER,
    envPassSet: !!process.env.MYPOS_SIP_PASS,
    envDomainSet: !!process.env.MYPOS_SIP_DOMAIN,
    envPortSet: !!process.env.MYPOS_SIP_PORT,
    envExtSet: !!process.env.MYPOS_SIP_EXT,
  };
}

// ── 번호 파싱 ─────────────────────────────────────────────────────────────────
// SIP From 헤더에서 전화번호 추출.
// 형태: "name" <sip:01012345678@domain>, sip:01012345678@domain
function parseSipFrom(from) {
  if (!from) return null;
  const fromStr = Array.isArray(from) ? from[0] : from;
  const uriStr = typeof fromStr === 'object' ? (fromStr.uri || '') : String(fromStr);
  const m = uriStr.match(/sip:([0-9+\-\(\)]+)@/) ||
            uriStr.match(/<sip:([0-9+\-\(\)]+)@/);
  if (!m) return null;
  return m[1].replace(/[-\(\)\s]/g, '');
}

// 한국 전화번호 포맷 (표시용)
function formatKoreanPhone(num) {
  if (!num) return num;
  const n = num.replace(/\D/g, '');
  if (n.length === 11 && n.startsWith('010')) {
    return `${n.slice(0, 3)}-${n.slice(3, 7)}-${n.slice(7)}`;
  }
  if (n.length === 10) {
    return `${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6)}`;
  }
  if (n.length === 9) {
    return `${n.slice(0, 2)}-${n.slice(2, 5)}-${n.slice(5)}`;
  }
  return num;
}

// ── 상태 ──────────────────────────────────────────────────────────────────────
let _running = false;
let _onCallCb = null;
let _regTimer = null;

// ── SIP REGISTER ──────────────────────────────────────────────────────────────
function sendRegister(cfg, cseq, authHeader) {
  if (!sip || !_running) return;
  const toUri = `sip:${cfg.user}@${cfg.domain}`;
  const msg = {
    method: 'REGISTER',
    uri: `sip:${cfg.domain}`,
    headers: {
      to: { uri: toUri },
      from: { uri: toUri, params: { tag: `mypos${Date.now()}` } },
      'call-id': `mypos-reg-${cfg.ext}@mypos`,
      cseq: { method: 'REGISTER', seq: cseq },
      contact: [{ uri: `sip:${cfg.user}@mypos-client` }],
      expires: 300,
      'content-length': 0,
    },
  };
  if (authHeader) msg.headers.authorization = authHeader;
  try {
    // sip 0.0.6 의 sip.send(msg, responseCallback) — 응답 정확히 캡처.
    // examples/make_call.js 패턴 따름.
    sip.send(msg, function(response) {
      try {
        if (response && typeof response.status === 'number') {
          _diag.lastResponseStatus = response.status;
          _diag.lastResponseAt = new Date().toISOString();
        }
      } catch (cbErr) {
        _diag.lastError = `REGISTER 응답 처리 오류: ${cbErr.message}`;
      }
    });
    _diag.registerSentCount += 1;
    _diag.registerLastAt = new Date().toISOString();
  } catch (e) {
    _diag.lastError = `REGISTER 전송 실패: ${e.message}`;
    console.warn('[cid] REGISTER 전송 실패:', e.message);
  }
}

// ── 메인: CID 리스너 시작 ────────────────────────────────────────────────────
// onIncomingCall(phoneNumber: string, formattedNumber: string) — 착신 시 호출
function startCidListener(onIncomingCall) {
  _diag.listenerStartCalled = true;
  _diag.listenerStartedAt = new Date().toISOString();
  _diag.configSnapshot = snapshotConfig();

  // 1.0.44: SIP 직접 등록 비활성화 — LG U+ Centrex Rest API Webhook(cidServer.js)으로 대체.
  // 함수 시그니처는 유지 (main.js 호환). 환경변수 MYPOS_CID_MODE=sip 일 때만 옛 흐름 fallback.
  if ((process.env.MYPOS_CID_MODE || 'webhook') !== 'sip') {
    _diag.lastError = 'SIP 비활성화 (1.0.44 부터 Webhook 모드 — cidServer.js 참고)';
    return false;
  }

  if (!sip) {
    _diag.lastError = 'sip 패키지 로드 안 됨';
    console.warn('[cid] sip 패키지 없음 — CID 비활성화');
    return false;
  }
  if (_running) return true;

  const cfg = getConfig();
  _onCallCb = onIncomingCall;

  try {
    // sip 0.0.6 은 EventEmitter 가 아니라 단순 함수 모음 — on() 메서드가 아예 없음.
    // 1.0.9 진단 빌드에서 "sip.on is not a function" 에러로 SIP 시작 자체 실패한 원인.
    // 안전하게 typeof 가드. (있으면 등록, 없으면 skip)
    if (typeof sip.on === 'function') {
      sip.on('error', (e) => {
        _diag.lastError = `sip 내부 오류: ${(e && e.message) || e}`;
        console.error('[cid] sip 내부 오류 (무시):', e && e.message || e);
      });
    }

    sip.start({
      host: '0.0.0.0',
      port: cfg.port,
      // UDP 기본 — 일부 환경에서 TCP 필요시 추가
    }, function(request) {
      // 콜백 전체를 try/catch — unhandled exception → main process crash 방지.
      try {
        // ── INVITE: 전화 수신 ──────────────────────────────────────
        if (request.method === 'INVITE') {
          const raw = parseSipFrom(
            request.headers['from'] || request.headers['p-asserted-identity']
          );
          const formatted = formatKoreanPhone(raw || '번호 없음');
          _diag.lastInviteAt = new Date().toISOString();
          _diag.lastInviteFrom = formatted;
          console.info(`[cid] 📞 착신: ${formatted}`);

          // 180 Ringing (전화 수신 알림만, 자동 응답 X)
          try {
            sip.send(sip.makeResponse(request, 180, 'Ringing'));
          } catch {}

          // 콜백도 try/catch — Firebase 기록 실패해도 앱 유지.
          try {
            if (_onCallCb && raw) {
              _onCallCb(raw, formatted);
            }
          } catch (cbErr) {
            _diag.lastError = `착신 콜백 오류: ${(cbErr && cbErr.message) || cbErr}`;
            console.error('[cid] 착신 콜백 오류:', cbErr && cbErr.message || cbErr);
          }
        }

        // ── 응답 status 캡처 (200/401/500 등) ────────────────────
        if (typeof request.status === 'number') {
          _diag.lastResponseStatus = request.status;
          _diag.lastResponseAt = new Date().toISOString();
        }

        // ── 401/407: 인증 필요 (REGISTER 응답) ─────────────────────
        // sip 0.0.6 의 sip.digest 는 직접 export 안 됨 — sip/digest 모듈 별도 require.
        // 그것마저 calculateDigest / calculateHA1 같은 저수준 함수만 있음.
        // 진단 단계에서는 일단 401 수신 자체만 캡처. 인증 후 재REGISTER 는 다음 fix.
        if ((request.status === 401 || request.status === 407) &&
            request.headers['www-authenticate']) {
          _diag.lastError = `${request.status} 인증 필요 — 다음 빌드에서 digest 인증 흐름 추가 예정`;
        }
      } catch (e) {
        // SIP 메시지 처리 중 예외 — 로그만 남기고 앱 유지.
        _diag.lastError = `SIP 요청 처리 오류: ${(e && e.message) || e}`;
        console.error('[cid] SIP 요청 처리 오류 (무시):', e && e.message || e);
      }
    });

    // 1.0.13 fix: _running = true 를 sendRegister 첫 호출 전으로 이동.
    // sendRegister 안에 `if (!sip || !_running) return;` 가드가 있어서
    // 1.0.12 까지는 첫 REGISTER 가 가드에 막혀 즉시 return → 영원히 0회 송신.
    _running = true;

    // 첫 REGISTER
    sendRegister(cfg, 1, null);

    // 5분마다 re-REGISTER
    _regTimer = setInterval(() => sendRegister(cfg, 1, null), 270_000);
    console.info(`[cid] SIP 리스너 시작 — ${cfg.user}@${cfg.host}:${cfg.port}`);
    return true;
  } catch (e) {
    _diag.sipStartError = (e && e.message) || String(e);
    _diag.lastError = `SIP 시작 실패: ${_diag.sipStartError}`;
    console.error('[cid] SIP 시작 실패:', e.message);
    return false;
  }
}

function stopCidListener() {
  if (_regTimer) { clearInterval(_regTimer); _regTimer = null; }
  if (sip && _running) {
    try { sip.stop(); } catch {}
  }
  _running = false;
  _onCallCb = null;
}

// ── 진단 ──────────────────────────────────────────────────────────────────────
// UDP 포트가 잡혀있는지(EADDRINUSE) 시험으로 확인. SIP 가 정상이면 잡혀있어야 함.
function probeUdpPort(port) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { sock.close(); } catch {}
      resolve(result);
    };
    sock.once('error', (err) => {
      finish({
        bound: err.code === 'EADDRINUSE',
        errorCode: err.code || null,
        errorMessage: err.message || null,
      });
    });
    try {
      sock.bind(port, () => {
        // 우리가 잡았다 = SIP 가 안 잡고 있다
        finish({ bound: false, errorCode: null, errorMessage: null });
      });
    } catch (e) {
      finish({ bound: false, errorCode: 'BIND_THROW', errorMessage: e.message });
    }
    // 1.5 초 안에 결과 못 받으면 timeout
    setTimeout(() => finish({ bound: false, errorCode: 'TIMEOUT', errorMessage: null }), 1500);
  });
}

// 진단 스냅샷 — IPC 'mypos/cid-status' 가 호출.
async function getCidDiagnosis() {
  const cfg = getConfig();
  const probe = await probeUdpPort(cfg.port);
  return {
    ...(_diag),
    running: _running,
    portProbe: {
      port: cfg.port,
      bound: probe.bound,
      errorCode: probe.errorCode,
      errorMessage: probe.errorMessage,
    },
    nowIso: new Date().toISOString(),
  };
}

module.exports = { startCidListener, stopCidListener, formatKoreanPhone, getCidDiagnosis };
