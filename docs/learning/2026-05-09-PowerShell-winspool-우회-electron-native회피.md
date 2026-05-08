# 2026-05-09 · Electron 의 native module 의존성을 PowerShell + Add-Type 으로 회피

> 매장 PC SEWOO USB 영수증 출력을 위해 시도한 모든 native printer 모듈이 Electron 41 호환 prebuild 부재 또는 native compile 환경 부재로 막힘. PowerShell + Add-Type 인라인 C# 으로 winspool API 직접 호출하는 패턴으로 우회 — native 모듈 0, 빌드 도구 0, 매장 PC 의 PowerShell 5.1 + .NET Framework 만 활용. 1.0.18 fix 의 핵심 패턴.

## 배경 — 왜 native module 의존성이 문제인가

Electron 앱에서 OS API (Windows 프린터 큐, 레지스트리, USB 디바이스 등) 에 접근하려면 보통 native module 사용. node-printer 류가 대표적.

### 호환성 사슬

```
사용 모듈      Node ABI     vs    Electron 의 Node ABI
------------------------------------------------------
electron-printer 0.0.5  →  v36 (2016)        Electron 41 (2024+) 의 v118 → ❌ 불일치
@thesusheer/electron-printer 2.0.4  →  N-API 라 광고하지만 prebuild 없음 → 컴파일 fallback → VS Build Tools 없으면 실패
@thiagoelg/node-printer 0.6.2  →  같은 패턴
```

### 우리 케이스 — 어디서 막혔나

| 시도 | 결과 |
|---|---|
| `electron-printer@0.0.5` install | 성공 (prebuild 들어감) |
| 매장 PC 에서 require | 실패 — Electron v0.36 binding 로드 시도 → ABI 불일치 |
| `@thesusheer/electron-printer@2.0.4` install | 실패 — prebuild 없음 → `node-gyp rebuild` → VS Build Tools 부재 |
| `@thiagoelg/node-printer@0.6.2` install | 실패 (같은 이유) |

### 정공법 옵션 — 왜 모두 비효율적인가

**A. Visual Studio Build Tools 설치** (5GB+, 30분+) — 작업 PC 에 영구 설치. 매장 맥북에서도 빌드 환경 (Xcode CLI tools) 필요. 매장 PC 도 매번 Electron 마다 rebuild 필요.

**B. C# 별도 콘솔 앱 bridge** (KIS bridge 패턴) — 가장 깔끔하지만 .NET SDK 7+ 필요 + extraResources 동봉 + 매번 빌드.

**C. Electron 의 `webContents.print` API** — Chromium silent print, 영수증을 HTML/CSS 로 변환 필요 → 큰 코드 변경 + ESC/POS 명령(cut, font size 등) 직접 못 보냄.

→ **D. PowerShell + Add-Type 인라인 C# 우회** 가 외부 의존성 0, 코드 변경 작음, raw ESC/POS 직접 송신 가능 — 가장 효율.

## 핵심 패턴

### 1. JavaScript 측 (Electron main process)

```javascript
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

async function sendRawToPrinter(printerName, bytes, timeoutMs = 10000) {
  // 1. Raw bytes 를 임시 파일에 저장 (cmd line argument 크기 한계 회피)
  const tmpFile = path.join(os.tmpdir(), `mypos-rawprint-${Date.now()}.bin`);
  fs.writeFileSync(tmpFile, Buffer.from(bytes));

  // 2. PowerShell 스크립트 — Add-Type 으로 C# 인라인 정의 + 호출
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
    '  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", ...)]',
    '  public static extern bool OpenPrinter(...);',
    '  // StartDocPrinter, WritePrinter, EndDocPrinter, ClosePrinter 동일 패턴',
    '  public static int SendBytesToPrinter(string printerName, byte[] bytes) { /* ... */ }',
    '}',
    '"@',
    `$bytes = [System.IO.File]::ReadAllBytes('${tmpFile.replace(/'/g, "''")}')`,
    `$written = [MyPosRawPrint]::SendBytesToPrinter('${printerName.replace(/'/g, "''")}', $bytes)`,
    'Write-Output ("OK:" + $written)',
  ].join('\n');

  // 3. PowerShell 실행 + 결과 파싱
  return new Promise((resolve, reject) => {
    let stdout = '', stderr = '', killed = false;
    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
      { windowsHide: true }
    );
    const timer = setTimeout(() => { killed = true; ps.kill(); }, timeoutMs);

    ps.stdout.on('data', (d) => stdout += d.toString('utf8'));
    ps.stderr.on('data', (d) => stderr += d.toString('utf8'));
    ps.on('close', (code) => {
      clearTimeout(timer);
      try { fs.unlinkSync(tmpFile); } catch {}
      if (killed) return reject(new Error('타임아웃'));
      const okMatch = stdout.match(/OK:(\d+)/);
      if (code === 0 && okMatch) resolve({ written: parseInt(okMatch[1], 10) });
      else reject(new Error(`PowerShell 실패 (exit ${code}): ${stderr || stdout}`));
    });
  });
}
```

### 2. C# 측 (Add-Type 안)

핵심은 `winspool.Drv` 의 4개 API:
- `OpenPrinter(printerName)` — 프린터 핸들 획득
- `StartDocPrinter(handle, level=1, DOCINFO{Datatype="RAW"})` — 문서 시작 + RAW 모드
- `WritePrinter(handle, bytes, length, &written)` — raw bytes 송신
- `EndDocPrinter(handle)` + `ClosePrinter(handle)` — 정리

```csharp
public static int SendBytesToPrinter(string printerName, byte[] bytes) {
  IntPtr hPrinter;
  if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
    throw new Exception("OpenPrinter failed err=" + Marshal.GetLastWin32Error());
  try {
    var di = new DOCINFO();
    if (!StartDocPrinter(hPrinter, 1, di)) throw new Exception("StartDocPrinter failed");
    if (!StartPagePrinter(hPrinter)) { EndDocPrinter(hPrinter); throw new Exception("StartPagePrinter failed"); }
    var pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
    try {
      Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
      int written;
      if (!WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out written))
        throw new Exception("WritePrinter failed");
      EndPagePrinter(hPrinter);
      EndDocPrinter(hPrinter);
      return written;
    } finally { Marshal.FreeCoTaskMem(pUnmanagedBytes); }
  } finally { ClosePrinter(hPrinter); }
}
```

### 3. 매장 PC 환경 요건

| 요건 | Windows 버전 | 기본 탑재 |
|---|---|---|
| PowerShell 5.1 | Windows 10 1607+, Windows 7+ (WMF 5 설치 시) | ✅ |
| .NET Framework 4.5+ | Windows 8+, Windows 7 (별도 설치 가능) | ✅ |
| `winspool.Drv` | 모든 Windows | ✅ |

매장 PC 가 Windows 10 19045 — 모두 기본 탑재. **추가 의존성 0.**

## 함정 (실제로 부딪힌 것들)

### 1. cmd line 인코딩 cp949 충돌

PowerShell 의 `-Command` 인자는 cmd line 으로 전달. 한국 Windows 의 default 인코딩 = cp949. UTF-8 한국어 → cp949 변환 시 깨질 수 있음.

→ C# 인라인 코드 안의 메시지는 **영문만** 사용. 한국어는 임시 파일 거쳐 `ReadAllBytes` 로 안전하게 전달.

### 2. PowerShell 의 `'@` (here-string 종료) 들여쓰기 금지

`@'...'@` here-string 의 닫는 `'@` 는 **반드시 column 0 에 위치**. 들여쓰면 parse error.

→ 우리 패턴은 array.join('\n') 으로 만들어서 자동으로 column 0 보장.

### 3. JIT 첫 호출 1~2초 지연

`Add-Type` 이 C# 코드를 .NET JIT 컴파일. 첫 호출만 1~2초, 이후 캐시 사용 → 즉시.

→ 영수증 첫 인쇄에서 사용자가 체감 가능. 향후 사용자 안내 또는 미리 warmup 호출 검토.

### 4. ExecutionPolicy 정책 차단 회피

매장 PC 에 `Restricted` 정책 박혀있으면 PowerShell 스크립트 실행 거부.

→ `-ExecutionPolicy Bypass` 인자로 호출 시점에만 우회 (시스템 설정 안 건드림).

### 5. Catch 메시지 마스킹 안티패턴

```js
// 안 좋음 — 모든 require 실패를 "패키지 안 깔림" 으로 마스킹
try {
  m = require('electron-printer');
} catch (e) {
  throw new Error('electron-printer 안 깔림. npm install 하세요.');
}
```

`require` 실패 원인은 **여러 가지** — 패키지 미설치, native binding 로드 실패, ABI 불일치, 의존성 누락 등. 한 가지 메시지로 다 묶으면 진단 어려움.

```js
// 더 안전
} catch (e) {
  throw new Error(`electron-printer 로드 실패: ${e.message}`);
}
```

## 적용 가능 분야

같은 패턴 (Node `child_process.spawn` + PowerShell `Add-Type` + Win32 API) 으로 가능한 것:

| 영역 | 호출 API |
|---|---|
| USB 디바이스 직접 제어 | `winusb.dll` |
| 레지스트리 조작 | `Microsoft.Win32.Registry` (PowerShell 기본) |
| WMI 쿼리 (프린터 상태, 디스크 등) | `Get-WmiObject` (PowerShell 기본) |
| 시리얼 포트 (RS-232) | `System.IO.Ports.SerialPort` |
| 화면 / 윈도우 조작 | `user32.dll` |
| 파일 시스템 권한 | `System.IO.FileInfo / GetAccessControl` |
| 네트워크 인터페이스 정보 | `System.Net.NetworkInformation` |

→ 매장 PC 운영 환경에서 native module 의존성 부담 없이 OS API 호출이 필요할 때 **첫 후보로 검토**.

## 결정 트리 — 어느 우회 방법을 쓸까?

```
Electron 에서 OS API 호출 필요?
│
├─ Yes — 호출 빈도?
│   │
│   ├─ 자주 (사용자 입력마다, 100ms+ 응답 요구)
│   │     → C# 별도 콘솔 앱 bridge (KIS 패턴) — JIT 워밍업 1회만
│   │
│   └─ 가끔 (영수증 인쇄, 진단 등 → 1~10초 응답 OK)
│         → PowerShell + Add-Type 인라인 (이번 케이스)
│
└─ No
    └─ Chromium 의 webContents.print, BrowserWindow API 등 Electron 내장 사용
```

## 참고

- 우리 코드: [electron/printer/print.js](../../electron/printer/print.js) — `sendToUsbPrinter` 함수
- KIS bridge 패턴 (별도 .exe): [electron/payment/kis.js](../../electron/payment/kis.js)
- Microsoft 공식 docs:
  - winspool.drv API: https://learn.microsoft.com/en-us/windows/win32/printdocs/printdocs-printing
  - PowerShell Add-Type: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/add-type
- node-thermal-printer GitHub: https://github.com/Klemen1337/node-thermal-printer

## 관련 세션

- [2026-05-08 영수증 프린터 USB + 매장 맥북 빌드](../sessions/2026-05-08-영수증프린터-USB-매장맥북빌드.md) — node-thermal-printer 도입 시점
- [2026-05-09 프린터 driver fix](../sessions/2026-05-09-프린터-driver-fix-electron-printer호환X-winspool우회.md) — 우회 패턴 도입한 1.0.17 → 1.0.18 사이클
