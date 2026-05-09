# 2026-05-09 · electron-updater 의 한계 + JS / native 이원화 빌드의 함정

> 며칠째 자동업데이트가 작동 안 하는 패턴 반복. 결국 메커니즘 자체를 GitHub 직접 다운로드로
> 단순화하면서 마무리. 이 과정에서 얻은 운영 환경 + 빌드 흐름 학습.

## 1. JS 측 vs native(.exe) 측 빌드의 이원화

Electron 앱의 두 빌드 경로:

```
┌─────────────────────────────────────────────────────────────┐
│  사장님의 매장 PC                                           │
│                                                             │
│  ┌─────────────────────┐  ┌────────────────────────────┐  │
│  │   MyPos.exe         │  │  Cloudflare Workers        │  │
│  │   (NSIS 설치본)     │←━│  (라이브 URL)              │  │
│  │                     │  │  https://...workers.dev    │  │
│  │   electron/main.js  │  │                            │  │
│  │   electron/updater  │  │  dist/index.html           │  │
│  │   electron/printer  │  │  dist/_expo/.../index-*.js │  │
│  │   electron/payment  │  │                            │  │
│  └─────────────────────┘  └────────────────────────────┘  │
│         ↑                            ↑                      │
│         │                            │                      │
│   NSIS Setup 직접 받기      wrangler deploy 만 하면         │
│   (큰 부담)                  사장님이 새로고침 시 즉시 반영  │
└─────────────────────────────────────────────────────────────┘
```

### 분류 기준

| 디렉토리 | 빌드 경로 | 적용 시점 |
|---|---|---|
| `electron/main.js`, `electron/updater.js`, `electron/printer/`, `electron/payment/` | NSIS Setup .exe | 사장님 직접 다운로드 + 설치 |
| `electron/preload.js` | NSIS Setup .exe | 사장님 직접 다운로드 + 설치 |
| `App.js`, `screens/`, `components/`, `utils/` (Sentry 등 일부 제외) | wrangler deploy 라이브 URL | 매장 PC 새로고침 시 즉시 |
| `app.json`, `package.json` | 둘 다 — version 표시는 app.json (JS 측) | bump 시 양쪽 |

### 실수 — wrangler deploy 누락

오늘 1.0.20 ~ 1.0.22 까지 매번 .exe 빌드 + GitHub Release publish 만 하고 wrangler deploy 안 함.
JS 측 변경 ("🚀 지금 적용" 버튼, 분홍 배너, 5탭 컬러, 설정 탭, 단체 dissolve 등) 모두 라이브
URL 에 안 반영 → 매장 PC 새로고침해도 안 보임 → 사장님 며칠 짜증.

**교훈**: 매번 빌드 절차에 wrangler deploy 무조건 포함.

```bash
# 정상 빌드 절차
npm version (package.json + app.json 같이)
git commit + push + tag
npm run build:web              # Expo export → dist/
grep -rl "AIzaSy" dist/        # Firebase API key inline 검증 (CLAUDE.md 함정 2)
npx electron-builder --config electron/builder.config.js --publish never
PowerShell GitHub Release + 4개 자산 업로드
npx wrangler deploy            # ★ 절대 빠뜨리면 안 됨
```

## 2. electron-updater 의 quitAndInstall silent 실패 패턴

### 정상 흐름
```
사용자가 "🚀 지금 적용" 클릭
  ↓
quitAndInstall(false, true) 호출
  ↓
app.before-quit 이벤트 → 정리 → app.quit()
  ↓
.exe 정상 종료 + NSIS 잠금 해제
  ↓
NSIS uninstall + install + 새 버전 자동 시작
```

### 실패 패턴 (며칠 반복)
```
사용자가 "🚀 지금 적용" 클릭
  ↓
quitAndInstall(false, true) 호출
  ↓
app.before-quit 트리거 X (KIS bridge / SIP listener / 프린터 spool 살아있음)
  ↓
.exe 종료 못 함 → NSIS 잠금 해제 못 함
  ↓
silent 실패 — 사용자 화면 그대로
```

### Fix 11 시도 (8초 timeout 강제 종료)

```js
function applyNow() {
  // ...
  setTimeout(() => {
    autoUpdater.quitAndInstall(false, true);
    // 8초 후에도 .exe 살아있으면 강제 종료
    setTimeout(() => {
      const { app } = require('electron');
      app.exit(0);
    }, 8000);
  }, 50);
}
```

**한계** — Fix 11 자체가 .exe 1.0.20+ 부터 활성. 매장 PC 가 1.0.21 / 1.0.18 등에 갇혀있으면
이 코드 자체가 없어서 영원히 silent 실패. **닭-달걀 문제**.

### 결국 단순화 — GitHub 직접 다운로드

1.0.28 에서 자동업데이트 메커니즘 자체 포기:

```js
// electron/updater.js
autoUpdater.autoDownload = false;        // 자동 다운로드도 무용 (적용 못 하니)
autoUpdater.autoInstallOnAppQuit = false; // 영업 안전 (1.0.11 부터)
```

```jsx
// AdminScreen.js — 자동업데이트 카드를 GitHub 외부 링크 버튼으로 단순화
<TouchableOpacity onPress={() => window.open('https://github.com/.../releases/latest', '_blank')}>
  <Text>🔗 GitHub Releases</Text>
</TouchableOpacity>
```

사용자가 영업 끝나고 명시적으로 다운로드 + 설치. 단순/예측 가능 + spam 0.

## 3. 보수적 패치의 가치

1.0.26 에서 메뉴 인라인 편집 Phase A~D 한 번에 (4시간 작업, 200+줄 변경):
- categoryBar 의 inline `flexDirection: 'row'` 추가
- ScrollView 에 `flex: 1` 추가
- PanResponder useMemo deps 에 `currentRows` 추가

→ RN web 환경에서 **빈 화면 사고**. 어떤 변경이 정확히 깨뜨렸는지 진단 어려움.

### 1.0.27 의 보수적 재작성

각 변경을 의심해서 1.0.25 시점으로 원복:
- categoryBar layout 원복 (1.0.25)
- 편집 모드 토글 + 안내 띠 별도 행 분리
- PanResponder deps `[activeCategory]` 만
- onLayout 의 measureInWindow 호출에 try/catch

→ 정상 복구.

**교훈**: 큰 변경은 단계 분할. 또는 변경 후 매장 PC 빠른 smoke test (라이브 URL 접속 → 빈
화면 안 뜨는지) 후 publish. 1.0.26 처럼 4시간 작업 한 번에 publish 하면 사고 시 사장님 영업
지장.

## 4. version sync (package.json + app.json)

| 파일 | 사용처 | 표시 |
|---|---|---|
| `package.json` `version` | electron-builder 의 .exe build version | 자동업데이트 latest.yml 의 version (electron-updater 비교용) |
| `app.json` `version` | Expo / RN — `Constants.expoConfig.version` | 화면 하단 표시 (예: "MyPos v1.0.27") |

오늘 1.0.27 까지 — 매번 `package.json` 만 bump. `app.json` 은 옛 1.0.2 그대로. 화면 하단 표시 "MyPos v1.0.2 (12)" 부조화. 1.0.27 에서 sync.

**교훈**: 두 파일 모두 같이 bump. 자동화 스크립트 만들거나, 매번 체크리스트.

## 5. 향후 자동업데이트 재도입 검토

자동업데이트 메커니즘을 1.0.28 에서 포기했지만, 운영 효율 위해 향후 재도입 검토:

### 옵션 A — portable 자동 교체

`portable.exe` 가 자동 다운로드된 새 portable 을 다음 부팅 시 `MyPos.exe` 로 교체. NSIS 우회.
단 portable 운영 환경 (시작메뉴 자동 시작 X) 한계 존재.

### 옵션 B — autoInstallOnAppQuit:true (1.0.13 hook 신뢰)

1.0.11 부터 false. 1.0.13 의 installer.nsh hook 이 좀비 프로세스 정리. 만약 hook 이 신뢰
가능하면 true 로 되돌려도 hang 사고 없을 듯. 단 매장 PC 에서 검증 안 됨.

### 옵션 C — 별도 background updater service

`MyPosUpdater.exe` 같은 별도 service 가 GitHub 폴링 + 다운로드 + 다음 부팅 시 자동 적용.
Electron 본체와 분리되어 quitAndInstall silent 실패 무관.

### 옵션 D — OS-level scheduler

Windows Task Scheduler 가 매일 새벽 2시에 GitHub 폴링 + 다운로드 + NSIS 자동 실행. 매장 영업
영향 0.

각 옵션 별 trade-off 검토 후 1.0.30+ 에서 시도.

## 참고

- 오늘 세션 노트: [2026-05-09-올레의-대항해-1.0.20-to-1.0.28.md](../sessions/2026-05-09-올레의-대항해-1.0.20-to-1.0.28.md)
- 관련 메모리: `feedback_deploy_breaks_pc_sync.md` (deploy:web 사고)
- electron-updater docs: https://www.electron.build/auto-update
