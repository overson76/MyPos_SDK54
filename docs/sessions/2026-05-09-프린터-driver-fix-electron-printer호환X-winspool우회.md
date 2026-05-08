# 2026-05-09 · 영수증 프린터 driver fix — electron-printer 호환 X → PowerShell winspool 우회 (1.0.17→1.0.18)

> 어제(5/8) 매장 맥북 1.0.16 빌드 후 미해결로 마감했던 SEWOO SLK-TS400 USB 출력을 작업용 PC(집 윈도우) 에서 이어받아 마무리. node-thermal-printer 4.x 의 USB 모드를 정공법으로 가는 모든 길(electron-printer 옛 prebuild, fork 들 native compile 필요 + VS Build Tools 부재) 이 막힘. PowerShell + Add-Type 인라인 C# 의 winspool API 직접 호출 패턴으로 전환 → 매장 PC SEWOO USB 출력 정상.

## 핵심 Q&A

**Q1. 작업용 PC 로 왔으니 풀할 거 있으면 다 해줘 + 매장 PC NSIS installer "Failed to uninstall" 끊김 + 지난번 처방 뭐였지?**
**A1.** 풀 0건 — 본관/별관/origin 모두 `5fcef75` 동일. 워크트리 정리 (quirky-gates 1개 + 잔여 클로드 브랜치 3개 + origin 1개). 지난번 처방(2026-05-06): 작업관리자 강제 종료 → Remove-Item Programs 폴더 → 결국 portable 우회. 작업용 PC 진단 결과 mypos 프로세스 0, 잔재 폴더 0, 디스크 free 508GB → 1.0.16 NSIS 빌드(어제 wine 컴파일) 자체 의심. 즉시 처방: portable 1.0.16 다운로드.

**Q2. 매장 PC 영수증 출력 "출력 실패: No driver set!" — electron 측 진단 부탁.**
**A2.** RevenueScreen 의 🖨️ 재출력 버튼 alert (`screens/RevenueScreen.js:70`). 메시지 출처 = `node_modules/node-thermal-printer/lib/interfaces/printer.js:10` 의 throw. 조건 = `interface: 'printer:이름'` 형식 사용 시 별도 `driver` 옵션에 OS-native 프린터 모듈 객체 전달 필수인데 [electron/printer/print.js:115-122](../../electron/printer/print.js:115) 에 빠져있었음.

**Q3. 영업 끝 — A→B 일괄 진행.**
**A3.** A안 (매장 PC simulate 우회 setx) 안내, B안 (1.0.17 fix 빌드) 시작. 매장 PC 의 GH_TOKEN 이 환경변수에 박혀있어 publish 자동화 가능 확인.

**Q4. 1.0.17 portable 띄웠더니 "출력 실패: electron-printer 패키지가 설치되어 있지 않습니다" — 우리 친절 메시지 표시.**
**A4.** asar 검사 결과 모듈은 들어갔는데 `build/Release/electron-v0.36-win32-x64/node_printer.node` — Electron v0.36(2016) prebuild 만 포함된 dead 패키지. Electron 41 에서 NODE_MODULE_VERSION 불일치 → require 시 binding 로드 실패 → 우리 catch 진입 → "패키지 안 깔림" 으로 마스킹된 메시지. **electron-printer 0.0.5 자체가 사실상 dead.**

**Q5. 다른 fork 시도 후 막힘 — 옵션 결정.**
**A5.** 시도한 모듈:
- `@thesusheer/electron-printer@2.0.4` — N-API 라고 광고됐지만 prebuild 없음 → node-gyp 컴파일 시도 → VS Build Tools 부재로 실패
- `@thiagoelg/node-printer@0.6.2` — 동일
- `@grandchef/node-printer@0.8.0` — 동일 가능성

3가지 길 제시 → 사장님 선택: **B안 (PowerShell + Add-Type winspool API 인라인 우회)**.

**Q6. 응 → PowerShell winspool 우회 1.0.18 fix.**
**A6.** `electron/printer/print.js` 의 `sendToUsbPrinter` 통째 교체. native 모듈 의존 0. 매장 PC PowerShell 5.1 + .NET Framework 4.5+ 기본 탑재. raw ESC/POS bytes 그대로 RAW datatype 으로 SEWOO 송신. 빌드 + publish + 매장 PC 검증 → **SEWOO USB 출력 정상 ✅**.

**Q7. 출력 성공 시 어떤 모양?**
**A7.** 32칼럼 80mm 영수증 — 매장명/일시/테이블 (가운데), 메뉴 라인 (왼쪽-가격 좌우), 부가세 분리, 결제수단/상태, 자동 절단. ESC @ → ESC a 0 → 본문 → LF×3 → GS V 1 시퀀스. SEWOO 가 ESC/POS 명령 직접 처리. 시뮬레이션 모양 본문에 보여줌.

---

## 진행 흐름

```
[풀 / 워크트리 정리]
1. git pull → 0건 (5fcef75 이미 받아둔 상태)
2. 워크트리 정리: quirky-gates worktree remove + branch -d
3. 잔여 클로드 브랜치 강제 삭제 (elastic-bhabha local+remote, youthful-cannon local)
4. → 본관 main 만 남음

[매장 PC NSIS installer hang 진단]
5. 작업용 PC 잔재 0 (Programs 폴더 X, 레지스트리 X), 디스크 free 508GB → 1.0.16 NSIS 빌드 자체 의심
6. 어제 wine 컴파일의 installer.nsh hook 박혔는지 미확인 항목 그대로
7. 즉시 처방: portable 1.0.16 우회 가능

[매장 PC USB 출력 "No driver set!" 진단]
8. RevenueScreen.js:70 의 alert format 매칭 → 🖨️ 재출력 버튼
9. node-thermal-printer 의 lib/interfaces/printer.js:10 throw 위치 추적
10. 조건: interface "printer:이름" + driver 옵션 객체 미전달
11. 우리 코드 print.js:115-122 에 driver 옵션 빠짐 확정

[1.0.17 fix 시도 → 실패]
12. node-thermal-printer README 의 권장 driver: electron-printer 확인
13. electron-printer ^0.0.5 install (prebuild 포함, native 컴파일 X)
14. print.js 에 driver: require('electron-printer') + 친절 fallback 추가
15. version 1.0.16 → 1.0.17 (커밋 fd842df)
16. native NSIS 빌드 + GitHub Release v1.0.17 publish (4개 자산 업로드 OK)
17. 매장 PC 검증 → 다른 에러 "electron-printer 패키지가 설치되어 있지 않습니다"
18. asar 검사 → electron-printer 안에 electron-v0.36 prebuild 만 → Electron 41 호환 X
19. → 우리 catch 가 모든 에러를 "패키지 안 깔림" 으로 마스킹한 게 추가 발견 (1.0.18 fallback 메시지에 detail 포함)

[다른 fork 시도 → 모두 막힘]
20. @thesusheer/electron-printer@2.0.4 install → node-gyp rebuild 실패 (VS Build Tools 부재)
21. @thiagoelg/node-printer@0.6.2 → 동일
22. WebSearch + npm view → 모든 활성 fork 가 prebuild 없거나 누락
23. 옵션 정리: A) VS Build Tools 설치, B) PowerShell + Add-Type 인라인, C) C# 별도 bridge

[1.0.18 fix → 성공]
24. 사장님 선택: B안
25. node-thermal-printer + electron-printer dependencies 통째 제거
26. print.js 의 sendToUsbPrinter 통째 교체:
    · 임시 파일에 ESC/POS bytes 저장
    · spawn('powershell.exe', ...) 으로 PowerShell 실행 (10초 타임아웃)
    · Add-Type -TypeDefinition 으로 C# 인라인 정의
    · winspool.Drv 의 OpenPrinter / StartDocPrinter / WritePrinter / EndDocPrinter API 호출
    · RAW datatype 으로 raw bytes 송신
27. C# 메시지 영문화 (cmd line 인코딩 cp949 충돌 회피)
28. version 1.0.17 → 1.0.18 (커밋 f6c89b1)
29. 빌드 + GitHub Release v1.0.18 publish (4개 자산)
30. 매장 PC 검증 → SEWOO SLK-TS400 USB 영수증 출력 정상 ✅
```

| 시점 | 커밋/단계 | 액션 | 결과 |
|---|---|---|---|
| 1 | 워크트리 정리 | quirky-gates worktree remove + 클로드 브랜치 4개 삭제 (origin 1개 포함) | ✅ |
| 2 | `fd842df` | 1.0.17 — driver 옵션 + electron-printer 추가 | ✅ commit + push + tag |
| 3 | (작업용 PC) | native NSIS 빌드 (electron-builder + signtool) | ✅ |
| 4 | (publish) | GitHub Release v1.0.17 + 4개 자산 (PowerShell Invoke-RestMethod) | ✅ |
| 5 | (매장 PC) | 1.0.17 portable 검증 → "electron-printer 패키지 안 깔림" | ❌ binding 호환 X |
| 6 | 진단 | asar 안에 electron-v0.36 prebuild 만 발견 → dead 패키지 확정 | — |
| 7 | fork 시도 | @thesusheer/, @thiagoelg/ → native compile 실패 | ❌ |
| 8 | `f6c89b1` | 1.0.18 — PowerShell winspool 우회 (sendToUsbPrinter 통째 교체) | ✅ commit + push + tag |
| 9 | (작업용 PC) | 1.0.18 native NSIS 빌드 | ✅ |
| 10 | (publish) | GitHub Release v1.0.18 + 4개 자산 | ✅ |
| 11 | (매장 PC) | 1.0.18 portable 검증 → SEWOO USB 출력 정상 | ✅ |

## 변경 파일 (이번 세션 누적)

```
electron/printer/print.js              | sendToUsbPrinter 통째 교체 (PowerShell winspool)
package.json                            | -node-thermal-printer, -electron-printer, 1.0.16→1.0.18
package-lock.json                       | deps 트리 큰 변동

(빌드 산출물, gitignored)
electron-dist/MyPos-1.0.17-x64-portable.exe       136 MB → GitHub Release v1.0.17
electron-dist/MyPos-Setup-1.0.17-x64.exe          136 MB → GitHub Release v1.0.17
electron-dist/MyPos-1.0.18-x64-portable.exe       135 MB → GitHub Release v1.0.18
electron-dist/MyPos-Setup-1.0.18-x64.exe          135 MB → GitHub Release v1.0.18
```

## 다음 체크리스트

### 매장 PC 정식 적용

- [ ] portable 1.0.18 검증 후 NSIS Setup 1.0.18 로 정식 설치 (portable 은 자동업데이트 안 받음)
- [ ] PaymentMethodPicker 의 "결제 후 자동 출력" 토글 검증 — 결제 직후 영수증 자동 인쇄
- [ ] KitchenScreen 의 주문지 출력 검증 — 주방용 슬립 (`buildOrderSlipText`)

### 어제 미해결 항목 동시 해소 여부

- [ ] install-on-quit 트리거 안 되는 원인 진단 — 1.0.18 도 같은 매커니즘. 매장 PC 가 1.0.17 → 1.0.18 자동업데이트 받는지 확인. 안 받으면 별도 진단 필요
- [ ] `electron/updater.js` 의 `before-quit` / `window-all-closed` 이벤트 흐름 추적

### 코드 정돈 (선택)

- [ ] `print.js` 의 PowerShell catch 메시지 — 현재는 `e.message` 그대로 노출. 사용자에게 더 친절한 한국어 매핑 (예: ERROR_INVALID_PRINTER_NAME → "프린터 이름 확인" 등)
- [ ] PowerShell Add-Type JIT 첫 호출 1~2초 지연 — 영수증 첫 인쇄 시 사용자 안내 필요한지 검토

## 학습 포인트

### Electron + Windows native printer 모듈 = prebuild 호환 지옥

- `electron-printer@0.0.5` — 2016년 마지막 업데이트. asar 안에 `electron-v0.36-win32-x64/node_printer.node` 만 포함. Electron 41 에서 require 시 NODE_MODULE_VERSION 불일치로 throw.
- `@thesusheer/electron-printer@2.0.4` — N-API 라 광고하지만 prebuild 없음. install 시 node-gyp rebuild 시도 → VS Build Tools 없으면 실패.
- 모든 비슷한 fork (@thiagoelg/, @grandchef/) 가 같은 패턴. 사실상 native printer 모듈은 **컴파일 환경 갖춘 dev 머신 전용**.

### PowerShell + Add-Type 인라인 C# 패턴 — native 모듈 우회

매장 PC 의 PowerShell 5.1 + .NET Framework 4.5+ 가 Windows 7+ 기본 탑재. 추가 의존 0.

```javascript
const { spawn } = require('node:child_process');
const psScript = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -TypeDefinition @"',
  'using System;',
  'using System.Runtime.InteropServices;',
  'public class MyPosRawPrint {',
  '  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", ...)]',
  '  public static extern bool OpenPrinter(...);',
  '  // ...',
  '}',
  '"@',
  '[MyPosRawPrint]::SendBytesToPrinter(...)',
].join('\n');
spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript]);
```

핵심:
- C# 인라인 정의 → .NET JIT 가 런타임에 컴파일 (빌드 도구 X)
- `winspool.Drv` 의 OpenPrinter / StartDocPrinter / WritePrinter / EndDocPrinter API 직접 호출
- RAW datatype 으로 raw bytes 송신 → 프린터가 ESC/POS 명령 직접 처리
- raw bytes 는 임시 파일 → `[System.IO.File]::ReadAllBytes` 로 PowerShell 안에서 로드 (cmd line argument 크기 / 인코딩 한계 회피)
- C# 메시지는 영문만 (cmd line 인코딩 cp949 vs UTF-8 충돌 회피)

JIT 첫 호출 ~1~2초 지연 (.NET 캐시 후 즉시).

### 같은 패턴이 적용 가능한 분야

- USB 디바이스 직접 제어 (winusb.dll 호출)
- Windows 레지스트리 조작
- WMI 쿼리 (printer 상태 조회 등)
- 다른 Win32 API (gdi32, user32, kernel32)
- → 매장 PC 운영 환경에서 native module 의존성 부담 없이 OS API 호출이 필요할 때 첫 후보로 검토

### node-thermal-printer 4.x 의 driver 옵션

- README 가 권장: `driver: require(electron ? 'electron-printer' : 'printer')`
- `lib/interfaces/printer.js:10` 의 throw 조건: `interface: 'printer:이름'` 사용 시 driver 가 객체 아니면 throw
- 단 우리 케이스에서는 라이브러리 자체를 폐기하고 winspool 직접 호출로 대체 — 한 번 더 의존성 줄임

### "친절 fallback 메시지" 의 함정

```js
try {
  printerDriver = require('electron-printer');
} catch (e) {
  throw new Error('electron-printer 패키지가 설치되어 있지 않습니다. `npm install ...` 로 추가하세요.');
}
```

이런 패턴은 "패키지 미설치" 와 "binding 로드 실패" 를 같은 메시지로 마스킹. 사장님이 처음에 "패키지 미설치" 메시지 보고 actual 원인이 호환성 문제임을 못 봤음. 향후 catch 의 e.message 를 함께 노출하는 게 진단 친화적.

```js
} catch (e) {
  throw new Error(`electron-printer 로드 실패: ${e.message} (binding 호환 또는 미설치)`);
}
```

이런 패턴이 더 안전.
