# 2026-04-29 (밤) — Electron Phase 1: PC 카운터 데스크톱 앱화

> **세션 한 줄 요약**: 매장 카운터 PC 가 Chrome --kiosk 로 라이브 URL 띄우던 흐름을 정식 .exe 설치형 앱으로 전환할 토대 마련. `electron/` 서브폴더 + 표준 보안 + 단일 인스턴스 + Windows portable/NSIS 빌드 두 타겟. Phase 2(프린터) / Phase 3(자동 업데이트) 로 가는 디딤돌.

---

## 🕐 작업 흐름

| 단계 | 한 줄 |
|---|---|
| 1 | electron/ 서브폴더 — main.js / preload.js / builder.config.js |
| 2 | npm install --save-dev electron@41 + electron-builder@26 + cross-env |
| 3 | package.json 스크립트 — electron / electron:kiosk / electron:build |
| 4 | extraMetadata.main 으로 Expo의 index.js entry 와 충돌 회피 |
| 5 | node --check 로 3개 파일 syntax 검증 통과 |
| 6 | .gitignore 에 electron-dist/ 추가 |
| 7 | CLAUDE.md Electron 섹션 + 학습노트 |

---

## 📚 새로 배운 / 정리한 개념

### 1) Expo 와 Electron 의 entry 충돌 — `extraMetadata.main`

`package.json` 의 `"main"` 필드:
- Expo / Metro: `"index.js"` 이어야 RN 앱 부팅
- Electron 빌드: `"electron/main.js"` 이어야 .exe 가 메인 프로세스 찾음

해결: `electron-builder.config.js` 의 `extraMetadata.main` 옵션. 빌드된 .exe 의 package.json 만 main 을 override. 루트 package.json 은 그대로 두고 dev 환경 양쪽 호환.

```js
// electron/builder.config.js
extraMetadata: {
  main: 'electron/main.js',
}
```

dev 환경에서 electron 직접 실행 시엔 명령어로 entry 지정:
```
electron electron/main.js
```

### 2) Electron 표준 보안 조합 — sandbox + contextIsolation + nodeIntegration:false

매장 환경처럼 신뢰 안 되는 외부 URL (라이브 페이지 + 그 안의 외부 링크) 을 띄울 때 표준 패턴:

```js
webPreferences: {
  preload: 'preload.js',
  contextIsolation: true,    // 렌더러와 메인 프로세스 격리
  nodeIntegration: false,    // 렌더러에서 require/process 직접 접근 X
  sandbox: true,             // OS 시스템 콜 격리
}
```

Renderer (웹페이지) 에서 OS 기능 쓰려면 preload 의 `contextBridge.exposeInMainWorld` 로 안전한 API 만 노출:
```js
contextBridge.exposeInMainWorld('mypos', {
  isElectron: true,
  printReceipt: (text) => ipcRenderer.invoke('print-receipt', text), // Phase 2
});
```

### 3) 단일 인스턴스 가드 — 매장 PC 사고 방지

사장님이 바탕화면 아이콘 더블클릭을 두 번 빨리 누르면 두 창이 열림. 매장 환경에서는 한 창에서 결제하고 다른 창에서 또 결제하는 사고 가능.

```js
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  // 두 번째 시도 → 첫 번째 창 활성화
  if (mainWindow) mainWindow.focus();
});
```

### 4) 외부 링크 격리 — `setWindowOpenHandler` + `will-navigate`

매장 라이브 URL 안에서 (실수로 또는 의도적으로) 다른 origin 으로 가려고 하면, 매장 운영 컨텍스트 깨짐. 두 가지 방어:

```js
// window.open / target=_blank → OS 기본 브라우저로
mainWindow.webContents.setWindowOpenHandler(({ url }) => {
  shell.openExternal(url);
  return { action: 'deny' };
});

// link 클릭 navigate → 같은 origin 만 허용, 다른 origin 은 외부 브라우저로
mainWindow.webContents.on('will-navigate', (event, navUrl) => {
  if (new URL(navUrl).origin !== HOME_ORIGIN) {
    event.preventDefault();
    shell.openExternal(navUrl);
  }
});
```

### 5) Windows 빌드 타겟 — portable + NSIS 둘 다

| 타겟 | 사용처 |
|---|---|
| **portable** | 설치 안 함. .exe 더블클릭으로 즉시 실행. USB / 네트워크 폴더 공유로 매장 간 이동 편함 |
| **NSIS installer** | 정식 설치. 시작메뉴 / 바탕화면 바로가기 자동. 사장님이 알아서 설치 가능. 사용자 폴더 (관리자 권한 X) |

매장 사장님은 두 가지 다 받아서 편한 걸로 설치. 둘 중 하나만 빌드하려면 `--win portable` 또는 `--win nsis`.

### 6) 코드 서명 (code signing) 이 없는 상태 — SmartScreen 우회

EV Code Signing 인증서 없으면 Windows SmartScreen 이 "알 수 없는 게시자" 경고 띄움. 사용자가 "추가 정보 → 실행" 클릭 한 번이면 우회. 자체 매장 사용은 무방.

장기적으로 외부 배포 시:
- EV Code Signing — 연 ~$300 (DigiCert / Sectigo 등)
- 또는 Microsoft Store 등록 (별도 절차)
- electron-builder 에 인증서 경로 + 비밀번호 추가

### 7) `cross-env` 가 Windows 에서 환경변수 통일

```bash
# Linux/macOS: MYPOS_KIOSK=1 npm run ...
# Windows cmd: set MYPOS_KIOSK=1 && npm run ...
# Windows PowerShell: $env:MYPOS_KIOSK=1; npm run ...
```

`cross-env` 한 번 설치 후:
```json
"electron:kiosk": "cross-env MYPOS_KIOSK=1 electron electron/main.js"
```
모든 OS 에서 동일하게 동작.

---

## 🛠 변경 파일

### 신규
- `electron/main.js` — 메인 프로세스 (BrowserWindow + 보안 + 단일 인스턴스 + 외부 링크 격리)
- `electron/preload.js` — contextBridge 안전 API (Phase 1 은 isElectron 정도, Phase 2 부터 확장)
- `electron/builder.config.js` — Windows portable + NSIS 빌드 설정
- `docs/learning/2026-04-29-Electron-Phase1.md` (이 노트)

### 수정
- `package.json` — devDependencies (electron, electron-builder, cross-env) + scripts (electron, electron:kiosk, electron:build)
- `.gitignore` — electron-dist/ 추가
- `CLAUDE.md` — Electron 섹션 추가

---

## 🐛 발견한 함정 + 해결

### 함정 — `package.json` 의 main 충돌

처음엔 루트 main 을 `electron/main.js` 로 바꾸려 했음 → Expo 부팅 깨짐. extraMetadata 옵션이 표준 해법.

### 함정 (회피) — npm install 후 또 다시 metro vendor 누락?

vendor 폴더 확인 후 그대로 있어 안 깨짐. 이번 install 은 안전하게 통과.

---

## 🧠 자기 점검 — 다음에 떠올릴 것

1. **Expo + Electron 같은 dual entry 환경에서는 extraMetadata 패턴이 표준** — 빌드 시점에만 main override, 개발 시점은 그대로. 두 도구가 같은 package.json 의 같은 필드를 다른 의미로 해석할 때.

2. **Electron 보안 4종 세트** — sandbox + contextIsolation + nodeIntegration:false + preload contextBridge. 라이브 외부 URL 띄울 때 절대 빠뜨리면 안 됨.

3. **단일 인스턴스 + 외부 링크 격리** — 매장 같은 운영 환경에서 작은 사고 방지의 핵심. Chrome --kiosk 만으로는 안 됨.

4. **portable + installer 두 타겟이 매장 시나리오에 자연스러움** — 시범 사용은 portable, 정식 운영은 installer.

5. **Code signing 부재는 인지 + 우회 가이드만** — 자체 매장은 SmartScreen 한 번 클릭이면 됨. 외부 배포 직전에 EV 인증서 결정.

6. **Phase 분할이 Electron 작업의 핵심** — 한 번에 다 하려고 하면 끝없음 (프린터 / 자동 업데이트 / 오프라인 / 코드 서명 / 멀티 모니터 등). Phase 1 은 wrapper 만으로 끝내고 동작 확인 후 다음.

---

## 🔜 후속 작업 (다음 세션)

- **사용자 검증 — 본관에서 `npm run electron` 실행해서 라이브 URL 창 정상 표시 확인**
- **electron:build 시도 → .exe 산출물 검증** (electron-dist/MyPos-1.0.0-x64.exe + Setup .exe)
- **Phase 2 — 영수증 프린터** (별 워크트리 권장):
  - USB 서멀 프린터 (ESC/POS 명령) — `node-thermal-printer` 또는 `escpos` 패키지
  - 또는 IP 프린터 (네트워크 TCP) — Epson / Star
  - preload 에 `window.mypos.printReceipt(text)` 노출
- **Phase 3 — 자동 업데이트** (electron-updater + GitHub Releases / 자체 서버)
- **Phase 4 — 오프라인 캐시** (dist/ 를 .exe 안에 번들 — 인터넷 끊겨도 캐시된 화면 유지)

## 📝 사용자 가이드 (본관에서 실행)

```bash
cd C:/MyProjects/MyPos_SDK54
git pull --ff-only
npm install   # electron + electron-builder 설치 (~200MB)

# 1. dev 모드 — DevTools + 일반 창
npm run electron

# 2. 키오스크 모드 — 풀스크린 + 메뉴바 제거 (실제 운영 모드 미리보기)
npm run electron:kiosk

# 3. .exe 빌드 — 5-10분 + 디스크 ~500MB
npm run electron:build
# 산출물: electron-dist/MyPos-1.0.0-x64.exe (portable)
# 산출물: electron-dist/MyPos Setup 1.0.0.exe (installer)
```

매장 PC 에 배포 시:
- **portable 추천** — USB 로 옮기기만 하면 됨. SmartScreen 경고 → "추가 정보 → 실행" 한 번.
- 시작 시 `MYPOS_KIOSK=1` 환경변수가 자동 적용됨 (`app.isPackaged === true` 일 때).
