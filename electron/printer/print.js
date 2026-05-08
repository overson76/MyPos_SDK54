// 영수증 프린터 출력 — Electron 메인 프로세스에서만 동작.
//
// 지원 방식:
//   1. USB(Windows 프린터 큐) — PowerShell + Add-Type 인라인 C# 의 winspool API 호출.
//      native 모듈/빌드도구 의존 X. raw ESC/POS bytes 그대로 SEWOO/Bixolon/Epson 프린터에 송신.
//   2. IP/네트워크 프린터 — TCP 9100 포트 직접 송신
//   3. simulate — 로그만 출력 (실 프린터 없을 때 흐름 검증)
//
// 1.0.18: node-thermal-printer + electron-printer (Electron 41 prebuild 부재) 라인 폐기.
// PowerShell winspool 우회로 변경 — 매장 PC PowerShell 5.1 + .NET Framework 4.5+ 기본 탑재라
// 추가 의존 X. raw ESC/POS 직접 전달이라 자르기/폰트/정렬 명령 모두 정상 동작.
//
// 호출 모양:
//   await printReceiptIpc(receipt, {
//     mode: 'simulate' | 'network' | 'usb',
//     host: '192.168.1.100',  // network mode
//     port: 9100,              // network mode
//     iface: 'printer:SLK-TS400', // usb mode — Windows 프린터 큐 이름 (printer: prefix 자동 제거)
//   });

const net = require('node:net');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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

// USB(Windows 프린터 큐) — PowerShell + Add-Type 인라인 C# 의 winspool API 호출.
// 1.0.18: node-thermal-printer + electron-printer 라인 폐기 후 직접 winspool 호출로 교체.
//
// 동작:
//   1. ESC/POS bytes 를 임시 파일에 저장 (PowerShell argument size 한계 회피)
//   2. spawn('powershell.exe', ...) 로 PowerShell 실행
//   3. Add-Type 으로 winspool.Drv 의 OpenPrinter/StartDoc/Write/EndDoc API 인라인 정의
//      (.NET JIT 라 빌드 도구 X — 매장 PC 에 PowerShell 5.1 + .NET 4.5+ 만 있으면 됨)
//   4. RAW datatype 으로 raw bytes 송신 → SEWOO 가 ESC/POS 명령 그대로 처리
//   5. 임시 파일 정리
async function sendToUsbPrinter(receipt, opts) {
  const printerName = String(opts.iface || '').replace(/^printer:/i, '').trim();
  if (!printerName) {
    throw new Error(
      'USB 프린터 이름이 지정되지 않았습니다. 환경변수 MYPOS_PRINTER_IFACE 또는 ' +
      'options.iface 에 "printer:매장프린터이름" 또는 프린터 이름만 지정하세요.'
    );
  }

  if (process.platform !== 'win32') {
    throw new Error('USB 프린터 모드는 Windows 에서만 지원됩니다 (winspool API).');
  }

  const bytes = receipt.rawText
    ? buildTextBytes(receipt.rawText)
    : buildReceiptBytes(receipt);

  const tmpFile = path.join(
    os.tmpdir(),
    `mypos-rawprint-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.bin`
  );
  fs.writeFileSync(tmpFile, Buffer.from(bytes));

  // PowerShell 단일 인용 here-string. 안의 ${tmpFile} / ${printerName} 만 우리가 보간.
  // C# 코드의 $ 는 그대로 — JS template 라 \$ 로 escape 한 곳 없음. 검증 OK.
  const psScript = [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -TypeDefinition @"',
    'using System;',
    'using System.IO;',
    'using System.Runtime.InteropServices;',
    'public class MyPosRawPrint {',
    '  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]',
    '  public class DOCINFO {',
    '    [MarshalAs(UnmanagedType.LPWStr)] public string DocName = "MyPos Receipt";',
    '    [MarshalAs(UnmanagedType.LPWStr)] public string OutputFile = null;',
    '    [MarshalAs(UnmanagedType.LPWStr)] public string Datatype = "RAW";',
    '  }',
    '  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]',
    '  public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPWStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);',
    '  [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]',
    '  public static extern bool ClosePrinter(IntPtr hPrinter);',
    '  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]',
    '  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);',
    '  [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]',
    '  public static extern bool EndDocPrinter(IntPtr hPrinter);',
    '  [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]',
    '  public static extern bool StartPagePrinter(IntPtr hPrinter);',
    '  [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]',
    '  public static extern bool EndPagePrinter(IntPtr hPrinter);',
    '  [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]',
    '  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);',
    '  public static int SendBytesToPrinter(string printerName, byte[] bytes) {',
    '    IntPtr hPrinter;',
    '    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))',
    '      throw new Exception("OpenPrinter failed (printer=" + printerName + " err=" + Marshal.GetLastWin32Error() + ")");',
    '    try {',
    '      var di = new DOCINFO();',
    '      if (!StartDocPrinter(hPrinter, 1, di)) throw new Exception("StartDocPrinter failed err=" + Marshal.GetLastWin32Error());',
    '      if (!StartPagePrinter(hPrinter)) { EndDocPrinter(hPrinter); throw new Exception("StartPagePrinter failed err=" + Marshal.GetLastWin32Error()); }',
    '      var pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);',
    '      try {',
    '        Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);',
    '        int written;',
    '        if (!WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out written))',
    '          throw new Exception("WritePrinter failed err=" + Marshal.GetLastWin32Error());',
    '        EndPagePrinter(hPrinter);',
    '        EndDocPrinter(hPrinter);',
    '        return written;',
    '      } finally { Marshal.FreeCoTaskMem(pUnmanagedBytes); }',
    '    } finally { ClosePrinter(hPrinter); }',
    '  }',
    '}',
    '"@',
    `$bytes = [System.IO.File]::ReadAllBytes('${tmpFile.replace(/'/g, "''")}')`,
    `$written = [MyPosRawPrint]::SendBytesToPrinter('${printerName.replace(/'/g, "''")}', $bytes)`,
    'Write-Output ("OK:" + $written)',
  ].join('\n');

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let killed = false;
    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
      { windowsHide: true }
    );
    const timer = setTimeout(() => {
      killed = true;
      try { ps.kill(); } catch {}
    }, opts.timeoutMs || 10000);

    ps.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    ps.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    ps.on('error', (err) => {
      clearTimeout(timer);
      try { fs.unlinkSync(tmpFile); } catch {}
      reject(new Error(`PowerShell 실행 실패: ${err.message}`));
    });
    ps.on('close', (code) => {
      clearTimeout(timer);
      try { fs.unlinkSync(tmpFile); } catch {}
      if (killed) return reject(new Error('PowerShell raw print 타임아웃 (10초)'));
      const okMatch = stdout.match(/OK:(\d+)/);
      if (code === 0 && okMatch) {
        resolve({
          printer: printerName,
          bytesSent: bytes.length,
          bytesWritten: parseInt(okMatch[1], 10),
        });
      } else {
        const detail = (stderr || stdout || '').trim().split('\n').slice(-5).join(' | ');
        reject(new Error(`PowerShell raw print 실패 (exit ${code}): ${detail}`));
      }
    });
  });
}

module.exports = {
  printReceiptIpc,
  getDefaultOptions,
};
