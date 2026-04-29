# MyPos_SDK54

소형 매장(배달 + 홀)을 위한 Expo / React Native POS 앱.

## 환경

- **Expo SDK 54**, React Native 0.81, React 19. Metro / new architecture (`newArchEnabled: true`).
- JS 전용 (TypeScript 미사용). 파일 단위 함수형 컴포넌트 + Hooks.
- 화면 방향 **landscape 고정** (`app.json`).
- 주요 타깃: iPhone Pro Max (가로 932×430), Android 태블릿/에뮬레이터.

## 실행

```bash
npm install
npm start          # Expo Dev
npm run ios        # iOS 시뮬레이터
npm run android    # Android 에뮬레이터
npm run web        # 웹 미리보기 (Pinch zoom 등 일부 동작은 네이티브 전용)
npm run deploy:web # PC 카운터 라이브 URL 갱신 (clean + build + grep 검증 + wrangler deploy)
```

**`deploy:web` 절차 (`scripts/deploy-web.sh`):**
1. `.env` 의 `EXPO_PUBLIC_FIREBASE_API_KEY` 존재/형식 사전 확인 — 없으면 abort
2. `dist/` + `node_modules/.cache/` 클리어
3. `npx expo export --platform web`
4. **빌드 산출물에 API 키 inline 됐는지 grep** — 0개면 abort (함정 2 방지)
5. `npx wrangler deploy`

함정 2 = `babel-preset-expo` 의 `EXPO_PUBLIC_*` inline transformer 가 직접 참조 패턴만 인식. `const env = process.env; env.X` 같은 우회는 production 빌드에서 inline 실패 → 라이브 URL Firebase init 깨짐. grep 한 줄로 1초 만에 잡는다.

## 최상위 구조

```
App.js                 # 4탭 라우팅 (테이블/주문/주문현황/관리자) + Provider 트리
index.js               # Expo 엔트리
app.json               # Expo manifest
package.json
components/            # 재사용 UI (모달, PIN 입력, 핀치줌 등)
screens/               # 탭 단위 메인 화면
utils/                 # 도메인 로직 + Context + 영속화 + 알림
assets/sounds/         # 알림 톤 (네이티브 전용 WAV)
scripts/gen_sounds.js  # WAV 생성 스크립트
docs/                  # 스크린샷, 디버그용 HTML (gitignored)
```

## 탭 구조 (App.js)

```
SafeAreaProvider
└─ LockProvider          # PIN 잠금 / 자동 잠금 상태
   └─ MenuProvider       # 메뉴 카탈로그 + 카테고리
      └─ OrderProvider   # 테이블별 주문, 매출 history, 배달 주소록
         └─ PinchZoom    # 손가락 핀치로 전체 줌 인/아웃
            ├─ 테이블    → screens/TableScreen.js (via components/OrderFlow.js)
            ├─ 주문      → screens/OrderScreen.js (via components/OrderTab.js)
            ├─ 주문현황  → screens/KitchenScreen.js
            └─ 관리자    → screens/AdminScreen.js
                          ├─ 메뉴 관리 → SettingScreen.js
                          ├─ 수익 현황 → RevenueScreen.js (LockGate 로 PIN 보호)
                          └─ 시스템   → AdminScreen 내부 SystemSettingsView
```

탭은 모두 mount 상태로 두고 `display: none` 토글 — 탭 이동 시 상태 유지를 위해.

## Context 책임

| Context | 파일 | 역할 |
|---|---|---|
| `OrderContext` | `utils/OrderContext.js` | 테이블별 주문 슬롯, 확정/미확정 상태, 매출 history, 배달 주소록, 주소록 PII 7일 만료 |
| `MenuContext` | `utils/MenuContext.js` | 메뉴 카탈로그 (이름/가격/이미지/카테고리), CRUD |
| `LockContext` | `utils/LockContext.js` | PIN 잠금/해제, 자동 잠금 타이머, 백그라운드 즉시 잠금 |

## 핵심 도메인 개념

- **slot**: 한 메뉴 항목의 한 묶음. 동일 (id + 옵션 + 메모 + cookState) 가 합쳐짐 (`OrderContext` 의 `normalizeSlots`). slotId 는 `genSlotId()` 로 생성.
- **largeQty / qty**: 한 메뉴를 "대"와 "보통"으로 동시에 주문 가능. 표시는 `utils/itemSplit.js` 가 한 행씩 분리.
- **confirmed vs current**: 주방으로 넘어간 확정분 vs 작업 중 장바구니. 차이는 `utils/orderDiff.js` 의 `computeDiffRows` 가 added/changed/removed/unchanged 로 분류.
- **PENDING_TABLE_ID** = `'__pending__'`: 테이블 미선택 상태에서 먼저 담는 가상 테이블.

## 영속화 (utils/persistence.js)

- AsyncStorage. 키 prefix `mypos:v1:` (스키마 버전 포함, 향후 마이그레이션 대비).
- `loadJSON / loadMany / saveJSON / removeKey` — parse 실패 시 fallback 반환 (절대 throw 안 함).
- `makeDebouncedSaver(delay)` — 키별 디바운스로 디스크 쓰기 폭주 방지. OrderContext 가 사용.
- 민감값(PIN) 은 `expo-secure-store` (`utils/pinLock.js`).

## 음성 / 사운드 (utils/notify.js)

- 네이티브: `expo-audio` 가 `assets/sounds/*.wav` 재생.
- 웹: Web Audio API 로 동일 시퀀스의 사인파 톤 합성.
- TTS: `expo-speech` (한국어). 웹은 `window.speechSynthesis`.
- **개인정보 정책**: 배달 주소 음성 안내는 기본 OFF (`_speakAddress`). 매장 스피커로 손님 주소 누설 방지.
- 볼륨은 모듈 단일 진실 소스 (`_volume`). UI 가 `setVolume()` 로 갱신, AsyncStorage 영속화는 호출부 책임.

## 입력 검증 (utils/validate.js)

- 정책: **가능하면 잘라서 통과(silent clamp), 명백히 잘못된 형식만 무효화**. 앱이 멎지 않게.
- 길이 상한: 메뉴명 30, 짧은 메뉴명 12, 메뉴 가격 천만원, 배달 주소 200, 이미지 dataURL 2MB.
- 제어문자(NUL/탭/CR/LF) 제거. 일반 공백/하이픈은 보존.

## 시간 (utils/timeUtil.js)

- 배달 시간 입력: "420" / "4:20" / "1220" / "12:20" + AM/PM → `{h, m, h24, period}`.
- 12시간 형식만 허용 (`h: 1-12`).
- `formatKorean12h({h:4,m:20,period:'PM'})` → `"오후 4시 20분"`.

## 반응형 (utils/useResponsive.js)

- breakpoint: xs(<600) / sm(<900) / md(<1200) / lg(>=1200).
- `isNarrow = width < 900` — 모바일 모드 분기에 가장 자주 사용.

## PIN 잠금 (utils/LockContext.js + utils/pinLock.js)

- 4자리 PIN. `expo-secure-store` 에 해시 저장 (평문 저장 X).
- 자동 잠금: 비활성 N분 후 (Slider 1-30분, 기본값 LockContext 참조).
- 백그라운드 진입 시 즉시 잠금 (AppState 리스너).
- 보호 영역: **수익 현황 / 시스템 설정의 PIN 변경** (`LockGate` 컴포넌트로 감쌈).

## 코딩 컨벤션

- **응답 / 주석 / 커밋 메시지: 한국어** (사용자 메모리).
- 함수형 컴포넌트 + Hooks. 클래스 컴포넌트 사용 X.
- 스타일: 컴포넌트 하단 `StyleSheet.create({...})` (RN 표준 패턴).
- 절대 import X. 항상 상대 경로 (`../utils/...`).
- 절대 단위는 픽셀, 색상은 hex (`#111827` 등 Tailwind 계열 톤).
- 주석은 **WHY** 만. WHAT 은 식별자로 충분. 이미 있는 보존성 있는 주석은 그대로 둘 것 (도메인 정책/PII 만료 같은 부분).
- 외부 통신 / 네트워크 모듈 없음 — 100% 로컬 앱.

## 플랫폼별 주의

- **iOS new architecture**: `<Modal>` + 중첩 `<Pressable>` 호환 이슈 발견됨. `AdminScreen.js` 의 PIN 모달은 absolute 오버레이로 우회.
- **Android**: `BackHandler` 로 하드웨어 뒤로가기 처리 (`App.js`). 비-테이블 탭 → 테이블 → 선택 해제 → OS 처리 순.
- **Web**: 일부 네이티브 API 차이 — `notify.js` 가 분기. 핀치줌은 네이티브 우선.
- SafeArea 인셋 필수 (사용자 메모리: 노치/홈인디케이터 영역 침범 주의).

## PWA (웹 설치 가능 + 오프라인)

PC 카운터 라이브 URL 을 "앱처럼" 설치 가능한 PWA 로 운영. 매니페스트 / theme-color / apple-touch-icon 메타 태그를 마운트 시점에 head 에 동적 주입.

- `public/manifest.webmanifest` — 매장명, 아이콘 셋, theme/background = `#1F2937` (navy), display: standalone, orientation: landscape
- `public/icon-192.png` `public/icon-512.png` `public/apple-touch-icon.png` — Expo SDK 50+ 의 `public/` 폴더는 빌드 시 dist/ 에 그대로 복사됨
- `public/sw.js` — Service Worker. **network-first + cached fallback**. 네트워크 실패 시 캐시 폴백 → 인터넷 잠시 끊겨도 화면 살아있음. 새 빌드 배포 시 `skipWaiting` + `clients.claim` 으로 즉시 활성화 (사용자 새로고침 1회).
- `utils/pwaSetup.js` — 네이티브 no-op
- `utils/pwaSetup.web.js` — head 에 link/meta 태그 동적 주입 + production 빌드에서만 SW 등록 (`__DEV__` 가드)
- 아이콘 디자인 동일 (navy + 영수증 + MY/POS) — `assets/icon.png` 와 같은 함수로 사이즈만 달리 렌더

PWA 설치 가능 여부는 dev 에서 fetch + DOM 점검으로 검증 (브라우저 DevTools → Application → Manifest 도 가능). 라이브 URL 에서 Chrome → 주소창 옆 "앱 설치" 아이콘 또는 Edge → "이 사이트를 앱처럼 설치".

`deploy:web` 스크립트가 빌드 후 `dist/manifest.webmanifest`, `dist/sw.js`, 아이콘 3종 존재까지 검증 — public/ 복사 누락 시 배포 abort.

## 회계 / 매장 운영 (utils/payment.js)

매일 일계 정산 + 분기 부가세 신고 + 회계 사무소 송부에 필요한 도구 모음.

- `PAYMENT_METHODS` — 4종 (현금/카드/계좌이체/지역화폐) + 미분류(`unspecified`).
- `splitVatIncluded(total)` / `addVatExcluded(supply)` — 부가세 10% (일반과세자) 분리/합산. 정수 원 단위 반올림 정책 단일화 — 사장님 신고 시 합계 정확.
- `summarizeByPaymentMethod(history)` — 결제수단별 건수 + 합계.
- `summarizeDaily(history)` — 메뉴별 / 시간대별 / 결제수단별 일계 한 번에.
- `historyToCsv(history)` — 회계 사무소용 CSV. 한국어 헤더 + 부가세 분리 컬럼 + Excel 한글 BOM 안전.

### history 스키마 — paymentMethod 필드

`buildHistoryEntry()` 가 `paymentMethod` 받음. `null` = 미분류 (옛 데이터 / 사용자 미선택). 회계 / CSV / 결제수단별 매출 분석에 사용.

`OrderContext.markPaid(tableId, paymentMethod)` / `clearTable(tableId, paymentMethod)` — 결제 진입점 두 곳이 paymentMethod 인자 받음. 미지정(null) 도 허용.

### 결제 UI 흐름

`PaymentMethodPicker` 모달 — 선불/후불/결제하기 버튼이 누르면 띄움. 4종 + 미분류 5개 큰 버튼.

OrderScreen: "선불" → picker → markPaid. "후불" → picker → clearTable + onBack.
TableScreen: "결제하기" 버튼 → picker → markPaid + clearTable.

### RevenueScreen (관리자 → 수익현황)

- 오늘/이번달 카드 — VAT 토글 ON 시 공급가액/부가세 분리 표시
- 부가세 분리 표시 토글 + CSV 다운로드 버튼 (오늘/이번 달/전체)
- 오늘 결제수단별 카드 row — 5종 (4 + 미분류) 즉시 보임
- 오늘 일계 보고서 — 메뉴 TOP 5 + 시간대 TOP 5 (매출 기준)
- **이번 달 보고서** (`summarizeMonthly`) — 영업일 / 일평균 / 메뉴 TOP 5 + 요일별 매출
- 매월 수익 (기존)
- 최근 30건 이력 — 결제수단 라벨 추가, VAT 토글 ON 시 공급가액/부가세 한 줄 추가
- Electron .exe 환경에서만 history row 에 "🖨️ 출력" 버튼 (Phase 2)

### 결제 후 영수증 자동 출력 (Phase 2.1)

`PaymentMethodPicker` 의 자동 출력 토글 — Electron 환경에서만 보임. 사장님 선호 `printer.autoPrint` 키로 AsyncStorage 영속. 결제 직전 receipt 데이터 캡처 (markPaid/clearTable 후 order 변경되므로) → 결제 직후 비동기 `printReceipt(receiptData)` 호출. 실패해도 결제 흐름 영향 X.

### CSV 익스포트 (utils/csvDownload)

웹: Blob → a 태그 클릭 → 브라우저 다운로드. UTF-8 BOM 으로 Excel 한글 안전.
네이티브: 안내 alert (PC 카운터에서 다운로드 권장 — 회계 사무소 송부 흐름).

### 운영 정책

- 부가세 정책: **부가세 포함** 가격 입력 가정 (한국 소비자 가격 표준). RevenueScreen 의 분리 표시는 신고 대비 참고용.
- 옛 history (paymentMethod 없음) 는 `미분류` 로 집계 — 운영 마이그레이션 0 (자동).
- 회계 사무소 송부: PC 카운터에서 "수익현황 → CSV → 이번 달" 한 번이면 끝.

## Electron .exe (PC 카운터 데스크톱)

매장 PC 카운터를 Chrome --kiosk 대신 정식 .exe 설치형 앱으로 운영. Phase 1 — 라이브 URL 을 BrowserWindow 로 감싸기 + 표준 보안 설정 + 단일 인스턴스 가드.

### 구조
- `electron/main.js` — 메인 프로세스. BrowserWindow 생성, 라이브 URL 로드, 외부 링크 → OS 기본 브라우저, 단일 인스턴스 가드.
- `electron/preload.js` — contextBridge 로 안전한 API 노출 (`window.mypos.isElectron` 등). Phase 2 영수증 프린터 / Phase 3 자동 업데이트 시 확장.
- `electron/builder.config.js` — electron-builder 설정. Windows portable + NSIS installer 두 타겟. extraMetadata 로 main 경로 override (Expo `index.js` 와 충돌 회피).
- `electron-dist/` — 빌드 산출물 (.exe). gitignored.

### 보안 설정 (매장 환경 기본)
- `nodeIntegration: false` + `contextIsolation: true` + `sandbox: true` — 표준 안전 조합
- 외부 링크 (`window.open` / `target=_blank` / 다른 origin navigate) — `shell.openExternal` 로 OS 기본 브라우저로 분기. 매장 PC 에서 실수로 외부 사이트 들어가도 격리.
- 단일 인스턴스 가드 — 사장님이 더블클릭 한 번 더 누르면 두 창 뜨는 사고 방지.

### 운영 모드
- `MYPOS_KIOSK=1` 또는 패키징된 빌드 — 풀스크린 + 메뉴바 제거 + 키오스크 모드.
- dev 빌드 (`npm run electron`) — 일반 창 + DevTools 자동 열림. 디버깅 편함.

### 명령어
```bash
npm run electron         # dev 모드 (창 + DevTools)
npm run electron:kiosk   # 키오스크 모드 강제 (cross-env 로 환경변수 설정)
npm run electron:build   # Windows portable .exe + NSIS installer 빌드 (electron-dist/)
```

### 빌드 산출물
- `electron-dist/MyPos-1.0.0-x64.exe` — portable. 더블클릭으로 실행. USB 로 옮겨 다른 매장 PC 에 즉시 사용.
- `electron-dist/MyPos Setup 1.0.0.exe` — NSIS installer. 사용자 폴더에 설치 + 시작메뉴/바탕화면 바로가기 자동.

**코드 서명**: 미적용. Windows SmartScreen "알 수 없는 게시자" 경고 → "추가 정보 → 실행" 으로 우회. 자체 매장 사용은 무방. 외부 배포 시 EV Code Signing 인증서 (~연 $300) 구매 후 빌드 설정에 추가.

### Phase 로드맵
- ✅ **Phase 1**: 라이브 URL wrapper + 키오스크 + 단일 인스턴스
- ✅ **Phase 2** (코드만, 실 프린터 결정 후 활성화): 영수증 프린터 (simulate / network / usb)
- ✅ **Phase 3**: 자동 업데이트 (electron-updater + GitHub Releases)
- **Phase 4**: 오프라인 캐시 강화 (dist/ 를 .exe 안에 번들 → 인터넷 끊겨도 동작).

### Phase 3 — 자동 업데이트

매장 PC 의 .exe 가 **GitHub Releases 의 최신 .exe 를 자동으로 받아 다음 시작 시 적용**.

코드:
- `electron/updater.js` — autoUpdater 래퍼. `autoDownload: true` + `autoInstallOnAppQuit: true`. 절대 `quitAndInstall()` 강제 호출 X (영업 중 재시작 사고 방지).
- `electron/main.js` — `setupAutoUpdater(getWindows)` 부팅 시 호출 + IPC 핸들러 (`mypos/update-check`, `mypos/update-status`).
- `electron/preload.js` — `window.mypos.checkUpdate` / `getUpdateStatus` / `onUpdateStatus(callback)`.
- `electron/builder.config.js` — `publish: { provider: 'github', owner: 'overson76', repo: 'MyPos_SDK54' }`.
- `utils/electronUpdate.web.js` (.web.js / .js 분리) — RN 측 헬퍼.
- `AdminScreen` 시스템 섹션 — "🔄 자동 업데이트" 카드. Electron 환경에서만 보임. 메인 프로세스의 broadcast 이벤트 실시간 구독 → 진행률 / 상태 즉시 반영.

상태 종류 (`status.kind`):
- `idle` — 초기
- `disabled` — dev 빌드 (자동 비활성)
- `checking` — GitHub 확인 중
- `available` — 새 버전 발견, 다운로드 시작
- `downloading` — 다운로드 진행 중 (`percent`)
- `downloaded` — 다운로드 완료, 다음 시작 시 자동 적용
- `upToDate` — 최신
- `error` — 오류 (네트워크 / 서버 등)

매장 운영 안전 정책:
- 영업 중에는 백그라운드 다운로드만. UI 차단 X.
- 사장님이 자연스럽게 .exe 닫을 때 (영업 종료) 다음 시작 시 새 버전.
- 강제 reload / quitAndInstall 절대 안 부름.

### Phase 3 — 운영 발행 절차

```bash
# 1. version 올림 (semver)
# package.json 의 "version": "1.0.1" 등으로 수정

# 2. GH_TOKEN 환경변수 설정 (Personal Access Token, repo write 권한)
export GH_TOKEN=ghp_...

# 3. 빌드 + 자동 publish — GitHub Releases 에 .exe + latest.yml 자동 업로드
npx electron-builder --config electron/builder.config.js --publish always

# 4. 매장 PC 의 .exe 가 다음 부팅 시 자동 감지 → 다운로드 → 다음 시작 시 적용
```

**주의**: repo 가 private 이면 매장 PC 도 GH_TOKEN 필요 → 별도 update 서버(Cloudflare R2 등) 고려. 현재 public repo 전제.

### Phase 2 — 영수증 프린터

코드 흐름:
- `utils/escposBuilder.js` — ESC/POS 명령 + 영수증 텍스트/바이트 빌더 (순수 함수, RN/Electron 공통). VAT 분리, 결제수단 라벨, 80mm 32칼럼 레이아웃.
- `electron/printer/print.js` — IPC 핸들러. 3 모드:
  - `simulate` (default): 콘솔 로그만. 매장이 프린터 결정 전 흐름 검증.
  - `network`: TCP 9100 raw bytes 송신. 별도 라이브러리 불필요.
  - `usb`: `node-thermal-printer` 동적 require. 매장 프린터 결정 후 `npm install node-thermal-printer` 추가.
- `electron/main.js` — `ipcMain.handle('mypos/print-receipt', ...)`.
- `electron/preload.js` — `window.mypos.printReceipt(receipt, options)`.
- `utils/printReceipt.web.js` — `isPrinterAvailable()` (window.mypos.isElectron 체크) + IPC 호출.
- `utils/printReceipt.js` — 네이티브 no-op.
- `RevenueScreen` history row — Electron 환경에서만 "🖨️ 출력" 버튼 표시.

환경변수 (런타임 설정 — 매장 프린터 모델별):
```
MYPOS_PRINTER_MODE=network|usb|simulate
MYPOS_PRINTER_HOST=192.168.1.100   # network
MYPOS_PRINTER_PORT=9100             # network
MYPOS_PRINTER_IFACE=printer:Bixolon SRP-330II   # usb
MYPOS_PRINTER_TYPE=epson|star|bixolon
```

매장 프린터 도입 시:
1. 프린터 IP / USB interface 확인
2. 환경변수 또는 IPC options 으로 `mode: 'network'` / `mode: 'usb'` 전환
3. Electron 빌드에 환경변수 박거나 매장 운영 도구에 설정 화면 추가 (Phase 2.1)

## OTA 자동 업데이트 (expo-updates)

폰(iOS/Android) 앱에 새 JS 번들을 EAS Update 채널을 통해 자동 배포. 설정만 박아둔 상태 — **다음 EAS 빌드부터 자동 활성화**.

- `app.json`:
  - `"runtimeVersion": { "policy": "appVersion" }` — 같은 `version` 빌드끼리만 OTA 호환. native 코드 변경 시 `version` 올리고 새 EAS 빌드 필수.
  - `"updates.url"` = `https://u.expo.dev/<projectId>` — EAS 가 채널 라우팅
  - `"checkAutomatically": "ON_LOAD"` + `"fallbackToCacheTimeout": 0` — 시작 시 캐시된 옛 업데이트 즉시 적용 + 새 거 백그라운드 다운로드
- `eas.json`:
  - `build.development.channel` = `"development"`
  - `build.preview.channel` = `"preview"`
  - `build.production.channel` = `"production"`
- `utils/otaUpdates.js` — 네이티브 구현 (`Updates.checkForUpdateAsync` + `fetchUpdateAsync`)
- `utils/otaUpdates.web.js` — 웹 no-op
- `App.js` mount useEffect 에서 `checkForUpdates()` 호출 — **reload 강제 안 함**. 영업 중 화면 갑자기 새로고침 사고 방지. 사장님이 자연스럽게 앱 종료/재시작하는 시점에 새 번들 적용.

### 매장 운영용 OTA 발행 절차

1. 코드 수정 + 커밋
2. `eas update --branch production --message "..."` — 1-2분에 끝
3. 폰들이 다음 앱 시작 시 자동 다운로드 → 그 다음 시작 시 적용

**금지**: native 코드 / native 의존성 / `app.json` plugins 변경 시 OTA 로 못 보냄. 반드시 새 EAS 빌드 + TestFlight/Play 업로드 + `version` 증가.

### 첫 활성화 가이드

OTA 인프라는 코드/설정만 박힘 — 실제 활성화는 **expo-updates 가 포함된 EAS 빌드** 가 폰에 깔린 후부터. 현재 폰의 빌드(c4f7ed0 시점)는 OTA 모름. 다음 EAS 빌드부터 자동 활성화.

## 매장 멤버 진단 (utils/storeDiag.js)

어제 사고 회고: 사장님 폰의 익명 uid 가 ownerId 와 어긋나서 `joinRequests` listener 가 0건 read → 가입 요청이 사장님 화면에 안 보임 → 새 매장 만들어 복구.

`computeMemberDiagnosis(members, storeInfo, myUid)` 가 8개 시나리오를 자동 분류 — 운영자가 Firebase 콘솔 안 보고도 화면에서 1초에 식별. 결과 4단계 (`ok` / `warn` / `error` / `pending`).

`StoreManagementSection` 의 "진단 / 운영 정보" 섹션이 자동 메시지 + 본인 uid / ownerId / storeId 끝 12자리를 monospace 로 보여줌. 멤버 목록의 본인 행에 "· 나" 태그.

순수 함수라 Jest 단위 테스트 14개 케이스 (`__tests__/storeDiag.test.js`).

## 큰 파일 / 분리 패턴

화면별 styles 는 옆 파일로 분리:
- `screens/OrderScreen.js` (1,491) + `OrderScreen.styles.js` (876)
- `screens/TableScreen.js` (956) + `TableScreen.styles.js` (471)
- `screens/KitchenScreen.js` (760) + `KitchenScreen.styles.js` (477)

수정시 두 파일을 같이 봐야 함. import 패턴: `import styles from './<Screen>.styles'`.

OrderContext 의 순수 helper 는 `utils/orderHelpers.js` 로 분리됨 — `normalizeSlots`, `mergeOrderParts`, `sweepHistoryPII`, `genSlotId`, `localDateString`, `normalizeAddressKey`, `capHistory`, `resolveTableForAlert`. Jest 단위 테스트가 `__tests__/orderHelpers.test.js` 에 있으므로 동작 변경시 테스트도 갱신.

추가 분할 후보:
- `utils/OrderContext.js` — 1,333줄. provider 본체. reducer 분리 / hook 단위 추출 여지.
- `screens/OrderScreen.js` — 1,491줄. 카테고리/메뉴 그리드 + 옵션 패널 + 확인 모달 분리 가능.
- `screens/SettingScreen.js` — 880+ 줄.

## 에러 추적 (Sentry)

### 코드 구조
- `@sentry/react-native` 설치. `app.json` `plugins` 에 `"@sentry/react-native"` 등록.
- `utils/sentry.js` — 네이티브 init + helper. DSN 은 `process.env.EXPO_PUBLIC_SENTRY_DSN` 에서 로드.
- `utils/sentry.web.js` — 웹 번들용 no-op 스텁 (metro 의 `@sentry/browser` 해석 이슈 회피).
- `metro.config.js` — `@sentry/react-native/metro` 의 `getSentryExpoConfig` 로 wrap. source map 자동 업로드용.
- `index.js` 에서 `App` import 전에 `initSentry()` 호출 → 초기 import 단계 에러도 캡처.
- `App.js` 최상위에 `<SentryErrorBoundary fallback={CrashFallback}>` — React 렌더 에러 차단 + 한국어 복구 UI.
- DSN 이 비어있으면 `initSentry()` 조용히 skip — 미설정 상태로도 앱 정상 부팅.

### 헬퍼
- `reportError(error, extra?)` — try/catch 의 catch 에서 의도한 에러 직접 보고.
- `addBreadcrumb(message, data?)` — 매장 흐름의 의미있는 액션을 기록. 크래시 시 직전 5~10개 자동 첨부됨.
- 이미 심어진 breadcrumb (`utils/OrderContext.js`, `utils/LockContext.js`):
  `order.confirm`, `order.markPaid`, `order.markReady`, `order.clearTable`, `table.moveOrder`, `table.toggleSplit`, `admin.unlockAttempt`, `admin.lock`.

### 환경변수
- `.env` (gitignored) 에 `EXPO_PUBLIC_SENTRY_DSN=https://...` — 로컬/개발용.
- `.env.example` (커밋됨) 에 빈 템플릿 — 새 환경 셋업 가이드.
- `EXPO_PUBLIC_*` prefix 변수는 빌드 시 클라이언트 번들에 inline 됨 (DSN 은 공개 키라 OK).
- DSN 외 source map 업로드용: `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` — EAS Secret 으로 등록.

### 진단 버튼 (개발 전용)
- 관리자 → 시스템 → "진단 (개발 빌드)" 섹션에 "🐞 테스트 전송" 버튼.
- `__DEV__` 가드 — 운영 빌드에서는 자동 숨김.

### EAS / 운영 빌드 셋업
1. EAS Secret 으로 `SENTRY_AUTH_TOKEN` 등록 (`eas secret:create --name SENTRY_AUTH_TOKEN --value <token>`).
   - Auth Token 은 Sentry → Settings → Auth Tokens 에서 생성. scope: `project:releases`, `org:read` 필요.
2. `SENTRY_ORG`, `SENTRY_PROJECT` 도 같은 방식으로 EAS Secret 등록 (또는 `eas.json` 의 `env` 직접 명시).
3. `eas build` 시 `eas.json` 의 build profile 이 위 변수들을 환경에 매핑 → Sentry plugin 이 자동으로 release 생성 + source map 업로드.
4. 결과: Sentry Issues 의 stack trace 가 `bundle.js:1:53219` 같은 minified 위치 대신 `screens/OrderScreen.js:847` 같은 원본 위치로 표시됨.

## 테스트

- Jest. `__tests__/` 디렉토리.
- 우선 순수 로직만: `orderDiff`, `validate`, `itemSplit`, `persistence`, `timeUtil`.
- React Native 컴포넌트 테스트는 `@testing-library/react-native` 가 필요하면 추후 도입.
- 실행: `npm test`.

## Git

- 메인 브랜치: `main`. 작업 브랜치: 자유 (`master` 등 사용 중).
- 디버그 산출물(`docs/screenshots/`, `android-*.png`, `expo-qr.png`) 은 `.gitignore`.
- `.idea/`, `.expo/` 도 ignored.
