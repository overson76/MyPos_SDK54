// CID Webhook 서버 — 1.0.44 부터 신설.
//
// 동작:
//   - Electron 메인 프로세스에서 8090 (default) listen
//   - LG U+ Centrex Rest API 의 전화 수신시 URL알림 (챕터 13) 을 수신
//   - 매장 광 공유기의 NAT 포트 포워딩 (외부 8080 → 매장 PC 8090) 통해 들어옴
//   - 받은 sender 를 한국식 포맷 + 옛 SIP 흐름과 동일한 IPC ('mypos/incoming-call') 로 푸시
//     → useCidHandler.web.js 가 그대로 받아서 매장 주소록 매칭 + Firestore + TTS
//
// 보안:
//   - receiver(070번호) 가 우리 매장 번호와 일치해야만 처리
//   - sender 는 숫자만 (max 20), message 는 max 500 으로 길이 제한
//   - /cid/ring 외 다른 path 는 404
//
// Express 안 씀 — node:http 만 사용. 의존성 / 빌드 크기 절약.

'use strict';

const http = require('node:http');
const url = require('node:url');

let _server = null;
let _getWindows = null;
let _getStoreId = null;

const _diag = {
  running: false,
  port: null,
  startedAt: null,
  totalRequests: 0,
  lastRequestAt: null,
  lastRing: null,
  lastError: null,
};

// 한국식 전화번호 포맷 (010-1234-5678 등) — 옛 electron/cid.js 의 formatKoreanPhone 동일 로직.
function formatKoreanPhone(num) {
  if (!num) return num;
  const n = String(num).replace(/\D/g, '');
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

function _broadcast(phoneNumber, formattedNumber) {
  if (!_getWindows) return;
  const storeId = _getStoreId ? _getStoreId() : null;
  const payload = { phoneNumber, formattedNumber, storeId };
  try {
    for (const win of _getWindows()) {
      if (!win.isDestroyed()) {
        try { win.webContents.send('mypos/incoming-call', payload); } catch {}
      }
    }
  } catch (e) {
    _diag.lastError = `broadcast 오류: ${(e && e.message) || e}`;
  }
}

function _handleRing(req, res, parsed) {
  const expectedReceiver = (process.env.MYPOS_LGU_API_ID || '').replace(/[^0-9]/g, '');
  const q = parsed.query || {};
  const sender = String(q.sender || '').replace(/[^0-9+]/g, '').slice(0, 20);
  const receiver = String(q.receiver || '').replace(/[^0-9]/g, '').slice(0, 20);
  const kind = String(q.kind || '');
  const innerNum = String(q.inner_num || '').slice(0, 20);

  // 보안: receiver 검증 — 우리 매장 번호 일치 여부 (set 안 됐으면 skip).
  if (expectedReceiver && receiver !== expectedReceiver) {
    _diag.lastError = `receiver 불일치: ${receiver} ≠ ${expectedReceiver}`;
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ SVC_RT: '4030', SVC_MSG: 'receiver mismatch' }));
    return;
  }

  // kind == 1 = 전화 (CID 핵심). kind == 2 = SMS (별도 처리 향후).
  if (kind === '1' && sender) {
    const formatted = formatKoreanPhone(sender);
    _diag.lastRing = {
      sender,
      receiver,
      kind,
      innerNum,
      formatted,
      at: new Date().toISOString(),
    };
    _broadcast(sender, formatted);
  }

  // 매뉴얼 13.4 응답 샘플 형식.
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    SVC_RT: '0000',
    SVC_MSG: 'OK',
    DATAS: { STATUS: 'OK', DEBUG: '' },
  }));
}

function start({ port, getWindows, getStoreId }) {
  if (_server) return false;
  _getWindows = getWindows;
  _getStoreId = getStoreId;
  const expectedPath = process.env.MYPOS_LGU_CALLBACK_URL || '/cid/ring';

  _server = http.createServer((req, res) => {
    _diag.totalRequests += 1;
    _diag.lastRequestAt = new Date().toISOString();
    try {
      const parsed = url.parse(req.url, true);
      if (parsed.pathname === expectedPath || parsed.pathname === expectedPath + '/') {
        _handleRing(req, res, parsed);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    } catch (e) {
      _diag.lastError = `핸들러 오류: ${(e && e.message) || e}`;
      try {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('error');
      } catch {}
    }
  });

  _server.on('error', (e) => {
    _diag.lastError = `서버 오류: ${e.message}`;
    console.error('[cidServer] 서버 오류:', e.message);
  });

  _server.listen(port, '0.0.0.0', () => {
    _diag.running = true;
    _diag.port = port;
    _diag.startedAt = new Date().toISOString();
    console.info(`[cidServer] CID Webhook 시작 — 0.0.0.0:${port}${expectedPath}`);
  });

  return true;
}

function stop() {
  if (_server) {
    try { _server.close(); } catch {}
    _server = null;
  }
  _diag.running = false;
  _diag.port = null;
}

function getDiagnosis() {
  return { ..._diag };
}

module.exports = { start, stop, getDiagnosis, formatKoreanPhone };
