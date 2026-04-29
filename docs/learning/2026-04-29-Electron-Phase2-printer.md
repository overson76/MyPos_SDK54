# 2026-04-29 (밤 2) — Electron Phase 2: 영수증 프린터 코드

> **세션 한 줄 요약**: ESC/POS 영수증 프린터 출력 코드를 미리 작성. 순수 함수 빌더(Jest 21 케이스) + Electron IPC + 3 모드(simulate/network/usb 동적 require). 매장이 실 프린터 모델 결정하면 환경변수 한 줄로 활성화.

---

## 🕐 작업 흐름

| 단계 | 한 줄 |
|---|---|
| 1 | utils/escposBuilder.js — 순수 함수 (CMD 상수, pad2col, divider, buildReceiptText, buildReceiptBytes) |
| 2 | __tests__/escposBuilder.test.js — 21 케이스 (한글 칼럼 폭 / 정렬 / VAT 포함 / 명령 바이트열 검증) |
| 3 | electron/printer/print.js — IPC 핸들러. simulate / network (TCP 9100) / usb (node-thermal-printer 동적) |
| 4 | electron/main.js — ipcMain.handle('mypos/print-receipt', ...) |
| 5 | electron/preload.js — window.mypos.printReceipt(receipt, options) |
| 6 | utils/printReceipt.js (네이티브 no-op) + utils/printReceipt.web.js (Electron 체크 + IPC 호출) |
| 7 | RevenueScreen — printerAvailable 면 history row 에 "🖨️ 출력" 버튼 |
| 8 | Jest 202 통과 — 회귀 0 |
| 9 | CLAUDE.md Electron 섹션 업데이트 + 학습노트 |

---

## 📚 새로 배운 / 정리한 개념

### 1) ESC/POS 명령 — 매장 서멀 프린터 표준

| 명령 | 바이트 | 의미 |
|---|---|---|
| ESC @ | 0x1B 0x40 | Initialize printer (reset) |
| ESC E n | 0x1B 0x45 n | Bold ON(1)/OFF(0) |
| ESC ! n | 0x1B 0x21 n | Print mode (font, double-w, double-h 등 비트마스크) |
| ESC a n | 0x1B 0x61 n | Justification 0 left, 1 center, 2 right |
| GS V n | 0x1D 0x56 n | Cut paper (0=full, 1=partial) |
| LF | 0x0A | Line feed |

대부분 80mm 매장 프린터 (Bixolon, Epson, Star) 가 호환. 한글은 자체 코드페이지(주로 EUC-KR / CP949) 지원 — 출력 라이브러리가 자동 변환.

### 2) 80mm 영수증 한 줄 = 32 ASCII 칼럼 / 16 한글 칼럼

`pad2col(left, right, 32)` 으로 좌/우 정렬:
```
치킨 x2                  20,000원
콜라 x1                   2,000원
--------------------------------
공급가액                  20,000원
부가세 (10%)               2,000원
합계                      22,000원
```

핵심: 한글 1자 = 2칼럼 카운트 (`visualWidth` 함수). ASCII 1자 = 1칼럼.

### 3) IP 프린터 = TCP 9100 raw bytes

가장 간단한 네트워크 출력. ESC/POS 바이트열을 그냥 9100 포트로 송신. Bixolon / Epson 매장 프린터 대부분 지원. 별도 라이브러리 불필요 — Node.js `net.Socket` 만으로 충분.

```js
const socket = new net.Socket();
socket.connect(9100, '192.168.1.100', () => {
  socket.write(escposBytes);
  setTimeout(() => socket.destroy(), 200);
});
```

USB 보다 IP 가 도입 쉬움 — 네트워크 케이블만 꽂으면 어떤 OS 에서도 동작. 매장 라우터에 IP 고정 한 번이면 끝.

### 4) USB 프린터 — node-thermal-printer 위임 + 동적 require

매장이 IP 가 아닌 USB 직결을 원하면:
- `node-thermal-printer` 패키지 — 표준
- Bixolon / Epson / Star 모두 호환
- `interface: 'printer:Bixolon SRP-330II'` 형식으로 OS 프린터 큐 이름 지정

라이브러리는 옵셔널 — 매장이 결정하기 전에 미리 설치할 필요 없음. **동적 require + try/catch** 패턴:
```js
try {
  ({ printer: ThermalPrinter } = require('node-thermal-printer'));
} catch {
  throw new Error('node-thermal-printer 미설치. 매장 결정 후 npm install.');
}
```

### 5) Electron 메인 ↔ 렌더러 IPC 표준 패턴

```js
// 메인
ipcMain.handle('mypos/print-receipt', async (_event, receipt, options) => {
  return await printReceiptIpc(receipt, options);
});

// preload (contextBridge)
contextBridge.exposeInMainWorld('mypos', {
  printReceipt: (receipt, options) => ipcRenderer.invoke('mypos/print-receipt', receipt, options),
});

// 렌더러 (RN/Web)
const result = await window.mypos.printReceipt(receipt);
```

세 단계 다 비동기 + 결과 객체 반환 (`{ ok, error?, info? }`) — 매장에서 실패 시 alert 띄울 수 있게.

### 6) `.web.js` / `.js` 분리 패턴 — Electron 환경 식별

웹 빌드 (RN web) 가 Electron 안에서 돌 때 / 일반 Chrome 에서 돌 때 분기:
```js
// utils/printReceipt.web.js
export function isPrinterAvailable() {
  return !!window.mypos?.isElectron;
}
```

같은 코드가 라이브 URL 일반 브라우저에서는 false → 버튼 숨김. .exe 안에서는 true → 버튼 표시. 한 코드베이스 두 환경.

### 7) 환경변수로 프린터 설정 — 운영 매뉴얼 단순화

```
MYPOS_PRINTER_MODE=network
MYPOS_PRINTER_HOST=192.168.1.100
MYPOS_PRINTER_PORT=9100
```

매장 PC 의 .env 또는 .exe 시작 시 환경변수만 박으면 끝. 코드 재빌드 / 재배포 불필요.

향후 Phase 2.1: 매장 운영 화면(관리자 → 시스템) 에 프린터 설정 UI — 환경변수 대신 IndexedDB 저장 + 즉시 반영.

---

## 🐛 발견한 함정 + 해결

### 함정 — `useStore` vs `useOrders` 혼동

처음에 `useOrders()` destructure 에 `storeInfo` 넣었더니 undefined. `storeInfo` 는 `useStore()` (StoreContext) 에서 옴. RevenueScreen 도 useStore import 추가.

### 함정 (회피) — node-thermal-printer 미설치 시 main.js 부팅 깨짐?

동적 require + try/catch 로 회피. 라이브러리 없어도 simulate/network 모드는 동작. 매장이 USB 모드 시도할 때만 명확한 에러 메시지 (`패키지 설치 필요`).

---

## 🛠 변경 파일

### 신규
- `utils/escposBuilder.js` (170줄) — ESC/POS 명령 + 영수증 빌더 순수 함수
- `__tests__/escposBuilder.test.js` (21 케이스)
- `electron/printer/print.js` — IPC 핸들러 (simulate/network/usb)
- `utils/printReceipt.js` (네이티브 no-op) + `utils/printReceipt.web.js` (Electron IPC)
- `docs/learning/2026-04-29-Electron-Phase2-printer.md` (이 노트)

### 수정
- `electron/main.js` — IPC 핸들러 등록 + printer/print 모듈 require
- `electron/preload.js` — window.mypos.printReceipt 노출
- `screens/RevenueScreen.js` — useStore 추가, history row "🖨️ 출력" 버튼 (Electron 조건부)
- `CLAUDE.md` — Electron Phase 2 섹션 추가

---

## 🧠 자기 점검 — 다음에 떠올릴 것

1. **순수 함수 + Jest = 하드웨어 없이도 ESC/POS 검증 가능** — 명령 바이트열을 byte-by-byte 테스트할 수 있어 매장 프린터 도착 전에 코드 안정화.

2. **3 모드 패턴 (simulate / network / usb) 이 점진적 도입에 자연스러움** — 매장 결정 못 했으면 simulate, IP 프린터면 network, USB 직결이면 usb. 코드 분기 한 번에 모두 커버.

3. **TCP 9100 이 USB 보다 도입 쉬움** — 네트워크 케이블만 꽂으면 OS 무관 동작. USB 는 OS 별 드라이버 + 큐 이름 식별 필요. 매장 추천은 IP 우선.

4. **동적 require + try/catch 가 옵셔널 의존성 표준 패턴** — node-thermal-printer 설치 전에도 simulate/network 모드 정상. 매장이 결정 시점에 npm install 하면 즉시 활성화.

5. **Electron contextBridge IPC 는 4단계 흐름** — 메인 ipcMain.handle → preload contextBridge → 렌더러 window.mypos.X → 결과 Promise. 한 번 패턴 잡히면 향후 자동업데이트 / 설정 동기화 등 다 같은 모양.

6. **isPrinterAvailable() 같은 capability check 가 UI 단순화** — RevenueScreen 의 출력 버튼은 Electron 환경에서만 보임. 일반 브라우저는 버튼 자체 없음 — 매장 사장님 헷갈릴 일 X.

---

## 🔜 후속 작업 (다음 세션)

- **사용자 검증 — 본관에서 .exe 빌드 + 시뮬 모드 영수증 콘솔 출력 확인**:
  ```bash
  cd C:/MyProjects/MyPos_SDK54
  git pull --ff-only
  npm install
  npm run electron       # dev 창 → 관리자 → 수익현황 → 🖨️ 출력 버튼
  # DevTools 콘솔에 "[printer/simulate] ----- begin -----" 영수증 텍스트 출력
  ```

- **매장 실 프린터 결정 후 활성화**:
  1. 프린터 모델 확인 (Bixolon SRP-330II 등)
  2. 네트워크 vs USB 결정
  3. 환경변수 설정 (또는 향후 운영 UI)
  4. USB 면 `npm install node-thermal-printer` 추가
  5. 첫 영수증 시범 출력 — 한글 깨짐 / 정렬 / 절단 동작 확인

- **결제 picker 에 "결제 후 자동 출력" 옵션** (Phase 2.1):
  - PaymentMethodPicker 에 체크박스 "결제 후 영수증 자동 출력"
  - markPaid + clearTable 직후 printReceipt 자동 호출
  - LocalStorage 로 사장님 선호 저장

- **운영 UI 에서 프린터 설정** (Phase 2.2):
  - 관리자 → 시스템 → 프린터 섹션
  - 모드 / 호스트 / 포트 / interface 입력
  - "테스트 출력" 버튼 — 한 줄 영수증 시뮬

- **Electron Phase 3** — electron-updater + GitHub Releases 자동 업데이트
