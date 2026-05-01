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
//   MYPOS_SIP_DOMAIN   — SIP 도메인 (예: lgdacom.net)
//   MYPOS_SIP_PORT     — SIP 포트 (기본 5060)

'use strict';

let sip;
try {
  sip = require('sip');
} catch (e) {
  // sip 패키지 없으면 조용히 disable
  sip = null;
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
    sip.send(msg);
  } catch (e) {
    console.warn('[cid] REGISTER 전송 실패:', e.message);
  }
}

// ── 메인: CID 리스너 시작 ────────────────────────────────────────────────────
// onIncomingCall(phoneNumber: string, formattedNumber: string) — 착신 시 호출
function startCidListener(onIncomingCall) {
  if (!sip) {
    console.warn('[cid] sip 패키지 없음 — CID 비활성화');
    return false;
  }
  if (_running) return true;

  const cfg = getConfig();
  _onCallCb = onIncomingCall;

  try {
    sip.start({
      host: '0.0.0.0',
      port: cfg.port,
      // UDP 기본 — 일부 환경에서 TCP 필요시 추가
    }, function(request) {
      // ── INVITE: 전화 수신 ──────────────────────────────────────
      if (request.method === 'INVITE') {
        const raw = parseSipFrom(
          request.headers['from'] || request.headers['p-asserted-identity']
        );
        const formatted = formatKoreanPhone(raw || '번호 없음');
        console.info(`[cid] 📞 착신: ${formatted}`);

        // 180 Ringing (전화 수신 알림만, 자동 응답 X)
        try {
          sip.send(sip.makeResponse(request, 180, 'Ringing'));
        } catch {}

        if (_onCallCb && raw) {
          _onCallCb(raw, formatted);
        }
      }

      // ── 401/407: 인증 필요 (REGISTER 응답) ─────────────────────
      if ((request.status === 401 || request.status === 407) &&
          request.headers['www-authenticate']) {
        const auth = request.headers['www-authenticate'];
        const authHeader = sip.digest(
          { user: cfg.user, password: cfg.pass },
          'REGISTER',
          `sip:${cfg.domain}`,
          auth
        );
        sendRegister(cfg, 2, authHeader);
      }
    });

    // 첫 REGISTER
    sendRegister(cfg, 1, null);

    // 5분마다 re-REGISTER
    _regTimer = setInterval(() => sendRegister(cfg, 1, null), 270_000);
    _running = true;
    console.info(`[cid] SIP 리스너 시작 — ${cfg.user}@${cfg.host}:${cfg.port}`);
    return true;
  } catch (e) {
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

module.exports = { startCidListener, stopCidListener, formatKoreanPhone };
