# 2026-04-29 (새벽) — Electron Phase 4: 오프라인 캐시 (dist/ 번들 + 폴백)

> **한 줄 요약**: Cloudflare CDN 가 다운돼도 매장 화면 살아있게. 라이브 URL 6초 응답 없으면 .exe 안에 번들된 dist/ 로 폴백. Expo 빌드의 절대 경로 이슈는 커스텀 scheme mypos:// 로 해결.

---

## 📚 개념

### 1) network-first + bundle-fallback — PWA SW 와 다른 점

| | PWA Service Worker (이미 구현) | Electron Phase 4 |
|---|---|---|
| 수준 | 브라우저 캐시 (assets) | OS 레벨 로드 (index.html 포함) |
| 실패 시나리오 | 네트워크 끊겨도 SW 가 assets 서빙 | index.html 자체 로드 실패 |
| 완전 오프라인 (첫 부팅) | X — 첫 방문은 실패 | ✅ .exe 안에 번들 포함 |

SW 는 브라우저가 index.html 을 로드한 후에야 활성. Electron 이 loadURL 실패하면 SW 조차 실행 안 됨. Phase 4 는 그 한 단계 아래를 커버.

### 2) Expo web 빌드의 절대 경로 문제

```html
<!-- Expo 빌드된 index.html -->
<script src="/_expo/static/js/web/entry-xxxxx.js"></script>
```

file:// 로 로드 시: `/_expo/...` → `file:///_expo/...` → 404

해결: **커스텀 scheme** (`mypos://`) 을 http 처럼 등록.

```js
protocol.registerSchemesAsPrivileged([
  { scheme: 'mypos', privileges: { standard: true, secure: true, ... } }
]);
// → mypos://localhost/ 기준: /_expo/... = mypos://localhost/_expo/... → dist/_expo/...
```

표준 scheme 처럼 동작 → 절대 경로도 정상 해석.

### 3) `protocol.registerSchemesAsPrivileged` 는 app ready 이전에 호출

```js
// main.js 최상단
const { registerOfflineScheme } = require('./offline');
registerOfflineScheme(); // ← app.whenReady() 전에 반드시

app.whenReady().then(() => {
  mountLocalServer(); // ← ready 이후에 등록
  createWindow();
});
```

두 단계:
- `registerSchemesAsPrivileged`: app 준비 전 — 스킴 "선언"
- `protocol.handle(SCHEME, ...)`: app 준비 후 — 요청 핸들러 "등록"

### 4) loadWithFallback — 6초 타임아웃 패턴

```js
const timer = setTimeout(fallback, 6000);
win.loadURL(liveUrl)
  .then(() => { clearTimeout(timer); finish('live'); })
  .catch(() => { clearTimeout(timer); fallback(); });
```

- timeout: 느린 인터넷 / CDN 응답 지연 대응
- catch: 완전 오프라인 / DNS 실패 대응
- 두 경우 모두 localURL 로 폴백

### 5) dist/ 번들 → .exe 사이즈 증가

| 항목 | 사이즈 |
|---|---|
| Electron 기반 | ~150MB |
| Expo web 빌드 (dist/) | ~10-15MB |
| 총 .exe | ~170MB |

Cloudflare CDN 가 실질적으로 매우 안정적이므로, 대부분의 경우엔 번들은 사용 안 됨. 보험 개념.

### 6) build:web 을 electron:build 에 선행

```json
"build:web": "npx expo export --platform web",
"electron:build": "npm run build:web && electron-builder --config ..."
```

.exe 빌드 시 항상 최신 web 번들 포함 → "라이브 URL 과 폴백이 같은 코드" 보장.
사장님 polyfill = 어떤 상황에도 최신 화면.

---

## 🛠 변경 파일

- `electron/offline.js` (신규) — registerOfflineScheme / mountLocalServer / loadWithFallback
- `electron/main.js` — registerOfflineScheme() 최상단 + mountLocalServer() + loadWithFallback 적용
- `electron/builder.config.js` — files 에 `dist/**/*` 추가
- `package.json` — `build:web` 스크립트 추가 + `electron:build` 에 피리클스트 연결
- `CLAUDE.md` — Phase 4 ✅ + 상세 섹션

---

## 🧠 자기 점검

1. **registerSchemesAsPrivileged = app ready 전** — 순서 바꾸면 "프로토콜 이미 등록됨" 오류. main.js 최상단 패턴 고정.

2. **Expo 절대 경로 = 커스텀 scheme 필수** — file:// 로는 SPA 안 됨. `mypos://localhost/` 가 표준 해법.

3. **번들 폴백 ≠ 100% 오프라인** — Firestore 는 별도 (Firebase SDK 가 IndexedDB persistence 로 어느 정도 커버). UI 코드만 로컬, 데이터는 온라인 복귀 시 sync.

4. **빌드 파이프라인 순서** — build:web 선행 없이 electron:build 하면 dist/ 없는 .exe 생성 → 폴백 실패. npm run electron:build 한 줄로 두 단계 자동.

---

## 🔜 다음

- **GitHub Release 첫 배포 + 매장 PC .exe 설치** — Phase 1-4 모두 검증
- **Phase 2.2 프린터 설정 UI** (관리자 → 시스템)
- **iOS / Android EAS 새 빌드** — 오늘 모든 변경 활성화
