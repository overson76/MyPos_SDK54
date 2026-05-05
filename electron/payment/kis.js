// KIS-NAGT 카드 단말기 결제 — Electron 메인 프로세스 측 IPC.
//
// 지원 모드 (요청 시점에 결정):
//   1. simulate (default) — 가짜 승인 응답. 매장이 KIS 가맹/단말기 결정 전 흐름 검증.
//   2. bridge — 번들된 KisPaymentBridge.exe 실행 → 실제 KIS OCX 호출.
//
// 영업 안전 정책:
//   - 결제 흐름은 절대 throw 안 함. 항상 { ok, mode, error?, data? } 반환.
//   - bridge 미발견 시 자동 simulate 폴백 + 명확한 에러 메시지.
//   - 타임아웃 — 매장에서 카드 단말기 30초 안 응답하면 강제 종료.
//
// 호출 모양:
//   await kisPayIpc({ amount: 12500, tradeType: 'D1' }, { mode: 'simulate' });
//   await kisPayIpc({ ... }, { mode: 'bridge', bridgePath: '...', timeoutMs: 60000 });

const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

// 환경변수 default — .exe 빌드에서 환경변수 안 바꿔도 동작.
function getDefaultOptions() {
  return {
    mode: process.env.MYPOS_KIS_MODE || 'simulate',
    bridgePath: process.env.MYPOS_KIS_BRIDGE_PATH || '',
    progId: process.env.MYPOS_KIS_PROGID || '',
    agentIP: process.env.MYPOS_KIS_AGENT_IP || '127.0.0.1',
    agentPort: Number(process.env.MYPOS_KIS_AGENT_PORT || 1515),
    catId: process.env.MYPOS_KIS_CAT_ID || '',
    timeoutMs: Number(process.env.MYPOS_KIS_TIMEOUT_MS || 60000), // 60초 — 카드 인식 + 서명 시간 고려
  };
}

// 번들된 브릿지 .exe 위치 — electron-builder 의 resources/ 에 복사됨.
// dev 빌드(npm run electron) 에서는 dotnet build 산출물을 직접 가리킴.
function resolveBridgePath(override) {
  if (override) return override;

  const candidates = [
    // 패키징된 .exe 안의 resources — builder.config.js 의 extraResources 가 여기로 복사.
    process.resourcesPath
      ? path.join(process.resourcesPath, 'bridge', 'KisPaymentBridge.exe')
      : null,
    // dev: 직접 dotnet build 한 결과물.
    path.join(__dirname, 'bridge', 'bin', 'x86', 'Release', 'net48', 'KisPaymentBridge.exe'),
    path.join(__dirname, 'bridge', 'bin', 'x86', 'Debug', 'net48', 'KisPaymentBridge.exe'),
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch { /* fs 에러는 무시 */ }
  }
  return null;
}

// 메인 진입점 — IPC 가 호출.
async function kisPayIpc(request = {}, options = {}) {
  const opts = { ...getDefaultOptions(), ...options };

  // simulate — KIS 가맹 전 또는 라이브러리 미설치 환경에서 매장 흐름 검증용.
  if (opts.mode === 'simulate') {
    return simulateApproval(request);
  }

  if (opts.mode === 'bridge') {
    const exe = resolveBridgePath(opts.bridgePath);
    if (!exe) {
      return {
        ok: false,
        mode: 'bridge',
        error: 'KisPaymentBridge.exe 를 찾을 수 없습니다. dotnet build 후 또는 패키징 시 resources/bridge 에 포함되어야 합니다.',
        fallback: simulateApproval(request),
      };
    }
    return await runBridge(exe, request, opts);
  }

  return { ok: false, mode: opts.mode, error: `Unknown KIS mode: ${opts.mode}` };
}

// 가짜 승인 — 매장에서 단말기 결정 전 모든 매출/CSV/영수증 흐름 검증 가능.
function simulateApproval(request) {
  const tradeType = request.tradeType || 'D1';
  const now = new Date();
  const yyyymmdd = now.getFullYear().toString().padStart(4, '0')
    + (now.getMonth() + 1).toString().padStart(2, '0')
    + now.getDate().toString().padStart(2, '0');
  const hhmmss = now.getHours().toString().padStart(2, '0')
    + now.getMinutes().toString().padStart(2, '0')
    + now.getSeconds().toString().padStart(2, '0');

  return {
    ok: true,
    mode: 'simulate',
    data: {
      ok: true,
      simulated: true,
      agentCode: '0000',
      replyCode: '0000',
      amount: String(request.amount || 0),
      authNo: 'SIM' + yyyymmdd.slice(2) + hhmmss.slice(0, 4),
      replyDate: yyyymmdd,
      tradeReqDate: yyyymmdd,
      tradeReqTime: hhmmss,
      issuerName: '시뮬레이션카드사',
      accepterName: '시뮬레이션매입사',
      cardBin: '999999',
      cardGubun: '0', // 신용
      replyMsg1: tradeType === 'D2' ? '시뮬레이션 취소' : '시뮬레이션 승인',
      replyMsg2: 'KIS 미설정 — simulate 모드',
      vanKey: 'SIMVANKEY' + Math.floor(Math.random() * 1e7).toString().padStart(7, '0'),
    },
  };
}

// 실제 브릿지 실행 — child_process 로 .exe 호출 + stdin/stdout JSON 교환.
function runBridge(exe, request, opts) {
  return new Promise((resolve) => {
    let done = false;
    const stdoutChunks = [];
    const stderrChunks = [];

    const env = { ...process.env };
    if (opts.progId) env.MYPOS_KIS_PROGID = opts.progId;

    let child;
    try {
      child = spawn(exe, [], {
        env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      return resolve({
        ok: false,
        mode: 'bridge',
        error: 'spawn 실패: ' + (e && e.message || e),
      });
    }

    const finish = (result) => {
      if (done) return;
      done = true;
      try { child.kill(); } catch {}
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        ok: false,
        mode: 'bridge',
        error: `브릿지 타임아웃 (${opts.timeoutMs}ms) — 카드 단말기 응답 없음`,
      });
    }, opts.timeoutMs);

    child.stdout.on('data', (d) => stdoutChunks.push(d));
    child.stderr.on('data', (d) => stderrChunks.push(d));

    child.on('error', (e) => {
      clearTimeout(timer);
      finish({ ok: false, mode: 'bridge', error: 'child_process 오류: ' + e.message });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();

      let data = null;
      try {
        if (stdout) data = JSON.parse(stdout);
      } catch (e) {
        return finish({
          ok: false,
          mode: 'bridge',
          error: '브릿지 응답 JSON 파싱 실패',
          stdout,
          stderr,
        });
      }

      // exit code 의미: 0 정상승인, 1 거절/오류, 2 시스템 에러
      const ok = code === 0 && data && data.ok === true;
      finish({
        ok,
        mode: 'bridge',
        exitCode: code,
        data,
        stderr: stderr || undefined,
      });
    });

    // 결제 요청 JSON 을 stdin 으로.
    const payload = {
      ...request,
      agentIP: request.agentIP || opts.agentIP,
      agentPort: request.agentPort || opts.agentPort,
      catId: request.catId || opts.catId,
      progId: opts.progId || undefined,
    };
    try {
      child.stdin.write(JSON.stringify(payload), 'utf8');
      child.stdin.end();
    } catch (e) {
      clearTimeout(timer);
      finish({ ok: false, mode: 'bridge', error: 'stdin 쓰기 실패: ' + e.message });
    }
  });
}

// 셋업 진단 — 매장 PC 에서 KIS 환경 정상인지 한 번에 확인.
async function kisDiagnoseIpc() {
  const opts = getDefaultOptions();
  const exe = resolveBridgePath(opts.bridgePath);

  if (opts.mode === 'simulate') {
    return {
      ok: true,
      mode: 'simulate',
      message: 'simulate 모드 — 실 결제 X. KIS 가맹 후 환경변수 MYPOS_KIS_MODE=bridge 로 전환.',
    };
  }

  if (!exe) {
    return {
      ok: false,
      mode: 'bridge',
      error: 'KisPaymentBridge.exe 미발견. C# 브릿지 빌드 또는 패키징 필요.',
    };
  }

  // dry-run 한 번 호출 — OCX 등록만 확인.
  const result = await runBridge(exe, { dryRun: true }, opts);
  return { ...result, exe };
}

module.exports = {
  kisPayIpc,
  kisDiagnoseIpc,
  getDefaultOptions,
  resolveBridgePath,
};
