// 영수증 프린터 출력 — Electron 메인 프로세스에서만 동작.
//
// 지원 방식 (요청 시점에 동적 로딩):
//   1. USB 서멀 프린터 — node-thermal-printer (Bixolon, Epson, Star 호환)
//   2. IP/네트워크 프린터 — TCP 9100 포트 직접 송신
//   3. simulate — 로그만 출력 (실 프린터 없을 때 흐름 검증)
//
// node-thermal-printer 는 Phase 2 시점에 옵셔널 — 매장이 프린터 모델 결정하면 추가 설치.
// 라이브러리 미설치 상태에서도 import 자체는 안 깨지게 try/catch + 동적 require.
//
// 호출 모양:
//   await printReceiptIpc(receipt, {
//     mode: 'simulate' | 'network' | 'usb',
//     host: '192.168.1.100',  // network mode
//     port: 9100,              // network mode
//     interface: 'printer:Bixolon SRP-330II', // usb mode (node-thermal-printer)
//     type: 'epson',           // usb mode
//   });

const net = require('node:net');
const { buildReceiptText, buildReceiptBytes, buildTextBytes } = require('../../utils/escposBuilder');

// 매장이 프린터 모델 결정 후 활성화. 그 전엔 simulate 가 default.
function getDefaultOptions() {
  return {
    mode: process.env.MYPOS_PRINTER_MODE || 'simulate',
    host: process.env.MYPOS_PRINTER_HOST || '192.168.1.100',
    port: Number(process.env.MYPOS_PRINTER_PORT || 9100),
    iface: process.env.MYPOS_PRINTER_IFACE || '',
    type: process.env.MYPOS_PRINTER_TYPE || 'epson',
    timeoutMs: 5000,
  };
}

// 메인 진입점 — IPC 가 호출.
// receipt: utils/escposBuilder 의 receipt 객체. options 는 위 모양.
// 반환: { ok: boolean, mode, error?, info? }
async function printReceiptIpc(receipt, options = {}) {
  const opts = { ...getDefaultOptions(), ...options };
  try {
    if (opts.mode === 'simulate') {
      // rawText: 주문지 등 미리 만들어진 텍스트 직접 전달. 없으면 결제영수증 빌더 사용.
      const text = receipt.rawText || buildReceiptText(receipt);
      // eslint-disable-next-line no-console
      console.log('[printer/simulate] ----- begin -----\n' + text + '\n----- end -----');
      return { ok: true, mode: 'simulate', info: { lines: text.split('\n').length } };
    }

    if (opts.mode === 'network') {
      const bytes = receipt.rawText ? buildTextBytes(receipt.rawText) : buildReceiptBytes(receipt);
      const info = await sendToNetworkPrinter(bytes, opts);
      return { ok: true, mode: 'network', info };
    }

    if (opts.mode === 'usb') {
      const result = await sendToUsbPrinter(receipt, opts);
      return { ok: true, mode: 'usb', info: result };
    }

    return { ok: false, mode: opts.mode, error: `Unknown printer mode: ${opts.mode}` };
  } catch (e) {
    return { ok: false, mode: opts.mode, error: String(e && e.message || e) };
  }
}

// IP 프린터 (Bixolon / Epson 등 네트워크) — TCP 9100 포트로 raw bytes 송신.
// 표준 ESC/POS 네트워크 출력 방식. 별도 라이브러리 불필요.
function sendToNetworkPrinter(bytes, opts) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (err, info) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch {}
      if (err) reject(err);
      else resolve(info || {});
    };

    socket.setTimeout(opts.timeoutMs);
    socket.on('error', (err) => finish(err));
    socket.on('timeout', () => finish(new Error(`Network printer timeout (${opts.host}:${opts.port})`)));
    socket.connect(opts.port, opts.host, () => {
      socket.write(Buffer.from(bytes), (err) => {
        if (err) return finish(err);
        // 짧게 기다린 후 close — 프린터 buffer 비우는 시간
        setTimeout(() => finish(null, { bytesSent: bytes.length, host: opts.host, port: opts.port }), 200);
      });
    });
  });
}

// USB 프린터 — node-thermal-printer 라이브러리 위임.
// 1.0.17: driver 옵션 누락 fix. node-thermal-printer 4.x 는 interface "printer:이름"
// 형식 사용 시 driver 옵션에 OS-native 프린터 모듈을 함께 전달해야 함. 안 그러면
// lib/interfaces/printer.js 가 "No driver set!" 던짐.
async function sendToUsbPrinter(receipt, opts) {
  let ThermalPrinter;
  try {
    // eslint-disable-next-line global-require
    ({ printer: ThermalPrinter } = require('node-thermal-printer'));
  } catch (e) {
    throw new Error(
      'node-thermal-printer 패키지가 설치되어 있지 않습니다. 매장 프린터 모델 결정 후 ' +
      '`npm install node-thermal-printer` 로 추가하세요.'
    );
  }

  // Electron 환경에서는 electron-printer (prebuild 포함, native 컴파일 X) 사용.
  // node-thermal-printer README 가 권장하는 패턴: driver: require('electron-printer').
  let printerDriver;
  try {
    // eslint-disable-next-line global-require
    printerDriver = require('electron-printer');
  } catch (e) {
    throw new Error(
      'electron-printer 패키지가 설치되어 있지 않습니다. ' +
      '`npm install electron-printer` 로 추가하세요. ' +
      '(node-thermal-printer 의 USB/printer-queue 모드에 OS 네이티브 driver 모듈로 필요)'
    );
  }

  if (!opts.iface) {
    throw new Error(
      'USB 프린터의 interface 가 지정되지 않았습니다. 환경변수 MYPOS_PRINTER_IFACE 또는 ' +
      'options.iface 에 "printer:매장프린터이름" 형식으로 지정하세요.'
    );
  }

  const printer = new ThermalPrinter({
    type: opts.type || 'epson',
    interface: opts.iface,
    driver: printerDriver, // ← 1.0.17 추가: native printer 모듈 전달 (없으면 "No driver set!")
    width: 32,
    characterSet: 'KOREA',
    removeSpecialCharacters: false,
    lineCharacter: '-',
  });

  const isConnected = await printer.isPrinterConnected();
  if (!isConnected) {
    throw new Error(`USB 프린터 연결 안 됨: ${opts.iface}`);
  }

  const text = receipt.rawText || buildReceiptText(receipt);
  printer.println(text);
  printer.cut();
  await printer.execute();
  return { iface: opts.iface, type: opts.type };
}

module.exports = {
  printReceiptIpc,
  getDefaultOptions,
};
