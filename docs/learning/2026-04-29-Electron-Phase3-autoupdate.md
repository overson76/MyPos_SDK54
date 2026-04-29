# 2026-04-29 (밤 3) — Electron Phase 3: 자동 업데이트 (electron-updater + GitHub Releases)

> **세션 한 줄 요약**: 매장 PC 의 .exe 가 GitHub Releases 의 새 버전을 자동 감지·다운로드 → 다음 시작 시 적용. 영업 중 강제 재시작 X — `autoInstallOnAppQuit` + `quitAndInstall()` 호출 안 함. 관리자 화면에 실시간 상태 카드 + 수동 "지금 확인" 버튼.

---

## 🕐 작업 흐름

| 단계 | 한 줄 |
|---|---|
| 1 | npm install electron-updater |
| 2 | electron/builder.config.js — publish: github (owner/repo) |
| 3 | electron/updater.js — autoUpdater 래퍼. 7개 이벤트 → 모든 윈도우 broadcast |
| 4 | electron/main.js — setupAutoUpdater(getWindows) + IPC 핸들러 (mypos/update-check, mypos/update-status) |
| 5 | electron/preload.js — checkUpdate / getUpdateStatus / onUpdateStatus(callback) |
| 6 | utils/electronUpdate.js (네이티브 no-op) + .web.js (Electron 체크 + IPC) |
| 7 | AdminScreen 시스템 섹션 — "🔄 자동 업데이트" 카드 (Electron 환경에서만 보임) |
| 8 | Jest 202 통과 + 4개 electron 파일 syntax 통과 |

---

## 📚 새로 배운 / 정리한 개념

### 1) electron-updater 의 안전 default — 매장 운영용 추가 가드

```js
autoUpdater.autoDownload = true;          // 백그라운드 다운로드 (default true)
autoUpdater.autoInstallOnAppQuit = true;  // 앱 종료 시 자동 적용 (default true)
// 절대: autoUpdater.quitAndInstall();    // 강제 재시작 — 영업 중 사고
```

매장처럼 24/7 운영 환경에서는 강제 reload 가 가장 큰 위험. 두 정책 명시적으로 박아두고 코드 어디에도 quitAndInstall 호출 안 함. 사장님이 자연스럽게 영업 종료 후 .exe 닫는 순간 = 자동 적용 시점.

### 2) 메인 → 모든 윈도우 broadcast 패턴

```js
function broadcastStatus(getWindows, status) {
  for (const win of getWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('mypos/update-status', status);
    }
  }
}
```

여러 BrowserWindow 동시 열려있을 때 모두에 전달. 단일 인스턴스 가드 적용된 매장 환경에서는 사실상 1개지만, 미래 보조 모니터 / 멀티 윈도우 시나리오 대비.

### 3) 마지막 알려진 상태 캐시 — 늦게 mount 한 렌더러도 즉시 받음

```js
let lastStatus = { kind: 'idle', message: '아직 확인 안 됨', at: null };
function setStatus(getWindows, status) {
  lastStatus = { ...status, at: Date.now() };
  broadcastStatus(getWindows, lastStatus);
}
```

렌더러가 broadcast 보다 먼저 일어났든 늦게 일어났든:
- 늦게 일어남: `getUpdateStatus()` IPC 한 번 호출로 캐시 받음
- 빨리 일어남: `onUpdateStatus(cb)` 구독으로 broadcast 받음

두 패턴 합치면 어떤 mount 타이밍에서도 정확한 상태 표시.

### 4) IPC 이벤트 구독 + 해제 패턴 — preload contextBridge

```js
// preload
onUpdateStatus(callback) {
  if (typeof callback !== 'function') return () => {};
  const handler = (_event, status) => callback(status);
  ipcRenderer.on('mypos/update-status', handler);
  return () => ipcRenderer.removeListener('mypos/update-status', handler);
}

// 렌더러 (React useEffect)
useEffect(() => {
  const unsub = subscribeElectronUpdate(setUpdateStatus);
  return () => unsub();
}, []);
```

memory leak 방지 — useEffect cleanup 으로 리스너 자동 제거. contextBridge 가 closure 캡처해서 unsub 함수 반환.

### 5) electron-builder 의 publish: github — GitHub Releases 가 update server

```js
publish: {
  provider: 'github',
  owner: 'overson76',
  repo: 'MyPos_SDK54',
}
```

빌드 시:
```bash
GH_TOKEN=ghp_... npx electron-builder --publish always
```

→ GitHub Releases 에 자동으로:
- `MyPos-1.0.1-x64.exe` (portable)
- `MyPos Setup 1.0.1.exe` (NSIS installer)
- `latest.yml` (electron-updater 가 읽는 메타데이터)

매장 PC 의 .exe 부팅 시 latest.yml 의 version 과 `app.getVersion()` 비교 → 새 버전이면 .exe 다운로드.

### 6) Public vs Private repo

- Public: 매장 PC 가 GH_TOKEN 없이도 다운로드 가능 — 가장 단순
- Private: 매장 PC 도 GH_TOKEN 필요 → .env 또는 빌드 시 박음 → 보안 위험 (.exe 분해하면 토큰 노출)

private 이 필요하면 별도 update 서버 (Cloudflare R2, Wasabi 등) 고려. 현재는 public repo 전제로 진행.

### 7) `isUpdaterActive()` dev 빌드 회피

```js
if (!autoUpdater.isUpdaterActive || !autoUpdater.isUpdaterActive()) {
  setStatus(getWindows, { kind: 'disabled', message: 'dev 빌드 — 업데이트 비활성' });
  return;
}
```

dev 모드 (app.isPackaged === false) 에서는 GitHub 호출 자체가 의미 없음. 명시적으로 disabled 상태 broadcast 후 종료. 관리자 화면에 "dev 빌드 — 업데이트 비활성" 메시지 표시되어 헷갈림 방지.

---

## 🐛 발견한 함정 + 해결

### 함정 — `electron-updater` 가 `dependencies` 에 들어감

기본 `npm install electron-updater` 가 dev 의존성 아닌 일반 dependency 로 추가됨. 이유: 매장 PC 의 .exe **런타임에서 사용**되므로 실제 정상. devDep 으로 옮기면 빌드 시 빠짐.

확인: 그대로 둠. electron 본체와 다른 정책.

---

## 🛠 변경 파일

### 신규
- `electron/updater.js` — autoUpdater 래퍼 (이벤트 7개 + broadcast + lastStatus 캐시)
- `utils/electronUpdate.js` (네이티브 no-op) + `utils/electronUpdate.web.js` (Electron IPC + 구독)
- `docs/learning/2026-04-29-Electron-Phase3-autoupdate.md` (이 노트)

### 수정
- `package.json` (+ `electron-updater@6.8.3` dependency)
- `electron/main.js` — setupAutoUpdater 호출 + 2개 IPC 핸들러
- `electron/preload.js` — checkUpdate / getUpdateStatus / onUpdateStatus 노출
- `electron/builder.config.js` — `publish: { provider: 'github', owner, repo }`
- `screens/AdminScreen.js` — 시스템 섹션에 "🔄 자동 업데이트" 카드 + state + 구독 useEffect
- `CLAUDE.md` — Phase 3 상세 + 발행 절차

---

## 🧠 자기 점검 — 다음에 떠올릴 것

1. **매장 운영 환경 = 강제 재시작 절대 금지** — `quitAndInstall()` 같은 강제 메서드 호출 안 함. 영업 종료 후 자연 재시작 시점이 적용 시점. 패턴이 모든 update 코드의 default.

2. **broadcast + lastStatus 캐시 = 어떤 mount 타이밍에서도 동작** — 컴포넌트가 빨리 / 늦게 mount 됐는지 신경 안 써도 됨. 일반화된 update notification 패턴.

3. **GitHub Releases 가 update 서버로 가장 무료 + 표준** — public repo 면 토큰도 매장 PC 에 안 박아도 됨. private 이면 별 서버 (R2 등) 고려.

4. **publish: provider github 한 줄로 update 서버 셋업 완료** — `electron-builder --publish always` 가 빌드 + 업로드 자동. 별 CI 없이도 매장에 배포 가능.

5. **자동 업데이트 카드 가시성을 capability check 로 결정** — `isElectronUpdateAvailable()` 이 false 면 카드 자체 숨김. 일반 브라우저 / 폰 사용자 헷갈림 0.

6. **버전 정책 = semver + appVersion** — package.json version 올림 = 새 release. major/minor 바꿔도 electron-updater 는 동작. 의도적으로 호환성 깨고 싶을 때만 latest.yml 직접 수정 (예: 큰 schema 변경).

---

## 🔜 후속 작업 (다음 세션)

- **사용자 검증 — 첫 GitHub Release 시범 배포**:
  ```bash
  cd C:/MyProjects/MyPos_SDK54
  git pull --ff-only
  npm install
  # GitHub Personal Access Token 생성 (repo write 권한)
  # https://github.com/settings/tokens
  # Windows PowerShell:
  $env:GH_TOKEN="ghp_..."
  npx electron-builder --config electron/builder.config.js --publish always
  ```
  → GitHub Releases 페이지에 v1.0.0 release 생성 + .exe 자동 업로드 확인.

- **시범 .exe 매장 PC 설치 → 다음 release 자동 감지 검증**:
  1. v1.0.0 .exe 매장 PC 설치
  2. package.json 의 version 을 1.0.1 로 올리고 publish
  3. 매장 PC 의 .exe 재시작 → AdminScreen 시스템 → "새 버전 1.0.1 다운로드 시작" 확인
  4. 영업 종료 후 .exe 닫고 다시 시작 → 1.0.1 활성화 확인

- **Phase 4 — 오프라인 캐시** (별 워크트리 권장):
  - 라이브 URL 캐시를 .exe 안에 미리 번들 (dist/ 통째)
  - 인터넷 끊겨도 화면 살아있음 (현재는 PWA SW 가 어느 정도 커버)
  - protocol handler 로 file:// 부터 로드

- **GH Actions 자동 빌드** (선택):
  - main 푸시 시 자동 .exe 빌드 + GitHub Releases 자동 발행
  - GH_TOKEN 은 secrets.GITHUB_TOKEN
  - 사장님 수동 빌드 부담 X
