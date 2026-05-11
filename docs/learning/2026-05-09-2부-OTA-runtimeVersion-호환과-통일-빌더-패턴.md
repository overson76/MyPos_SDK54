# 2026-05-09 (2부) · OTA runtimeVersion 호환 + 통일 빌더 패턴

> 1부 학습 노트가 electron-updater 측 한계를 다뤘다면 — 2부는 OTA (expo-updates) 측의
> runtimeVersion 정책 + 모든 출력을 한 빌더로 통일하는 설계 패턴.

## 1. OTA runtimeVersion 정책 — JS 만 변경 시 절대 bump X

### 정책 (app.json)

```json
{
  "expo": {
    "version": "1.0.2",
    "runtimeVersion": {
      "policy": "appVersion"
    }
  }
}
```

`runtimeVersion.policy: appVersion` → expo-updates 가 native 빌드의 `version` 을 runtimeVersion 으로 사용. 같은 version 빌드끼리만 OTA 호환.

### 시나리오

| 변경 종류 | app.json version | 결과 |
|---|---|---|
| **JS 만** (App.js / screens / components / utils) | **그대로** | OTA push → 같은 runtimeVersion → 폰 받음 ✅ |
| **Native 변경** (Expo SDK 업그레이드, 새 native 모듈 추가 등) | **bump** (예: 1.0.2 → 1.0.3) | 새 EAS 빌드 필수 + TestFlight 배포 + 사장님 폰 새 빌드 설치 |
| **JS 만인데 실수로 bump** | 잘못 bump | **OTA runtimeVersion 불일치 → 폰 못 받음** ⚠️ |

### 실수 후 복구

오늘 1부에서 화면 하단 표시 정상화 한답시고 1.0.2 → 1.0.28 sync 했다가 폰 OTA 끊김. 복구:
1. app.json version 1.0.2 로 되돌리기 (git commit a2ee6b1)
2. `npx expo export --platform web` 으로 dist 재빌드 (runtimeVersion 1.0.2 로)
3. `npx eas-cli update --branch production --message "..."` push
4. 사장님 폰 종료/재실행 2번 → OTA 받음

### 화면 표시는 어떻게?

`Constants.expoConfig?.version` 이 app.json version 사용. 1.0.2 면 화면 하단 "MyPos v1.0.2 (12)" 표시. 1년 동안 같은 값. **그 옆 `(12)` 가 native build number (`ios.buildNumber` / `android.versionCode`)** — 매 EAS 빌드 시 bump. 그게 진짜 빌드 식별자.

사용자가 화면 표시 보고 "왜 안 변해?" 물어보면 — "JS 안 시각적 변경은 다 적용되는 거. 하단 v1.0.2 (12) 는 핸드폰의 native 빌드 버전. 변경되는 게 정상" 안내.

### package.json version 은 별개

- `package.json` version → electron-builder 의 .exe build version. NSIS Setup `MyPos-Setup-1.0.32-x64.exe` 파일명에 박힘.
- `app.json` version → RN runtime version.

매번 코드 변경 시:
- JS 만 변경 → `package.json` 만 bump (electron .exe build 식별자 + git tag) + `app.json` 그대로
- Native 변경 → 둘 다 bump

자동화 권장:
```bash
# JS 만 변경 (대부분)
npm version patch  # package.json 만

# Native 변경 (드물게)
npm version patch && sed -i "s/\"version\": \"[0-9.]*\"/\"version\": \"X.Y.Z\"/" app.json
```

## 2. 통일 빌더 패턴 — 모든 출력 한 빌더

### 배경

원래 매장 운영에서 영수증과 주문지 분리:
- 영수증 (`buildReceiptText`) — 손님용, 결제 정보 포함
- 주문지 (`buildOrderSlipText`) — 주방용, 가격 X, 정책(kinds) 기반 added/changed 분리

사장님 의도:
> "모든 곳에서 같은 출력물. 각 탭별로 분리하지 말고 다 출력"

→ 분리의 이유 (주방은 가격 무관) 가 사장님 매장 흐름엔 부합 X. 사장님은 모든 출력을 동일한 자세한 형태로 보고 싶음. 정책 분리 logic 무용.

### 통일 패턴 구조

```
       buildReceiptText (단일 빌더)
            ↑
      ┌─────┴─────┬─────┬─────┐
      │           │     │     │
  주문 확정    주방    결제   재출력
  (자동)     🖨️    자동   (RevenueScreen)
  ↑           ↑      ↑      ↑
AutoPrintBridge  KitchenScreen  OrderScreen/  RevenueScreen
                 .handlePrintSlip TableScreen   .handleReprint
```

모든 호출부:
1. items 에 optionLabels resolve (OPTIONS_CATALOG 매핑)
2. storeInfo 전체 (storeName, storePhone, storeAddress, businessNumber, receiptFooter)
3. tableLabel (resolveAnyTable 또는 table.label)
4. total (computeItemsTotal)
5. paymentMethod / paymentStatus (옵션 — 결제 전이면 null/'pending')
6. deliveryAddress (배달일 때만)

빌더는 입력 데이터로 일관된 A형 영수증 생성. **결제 전이면 "결제상태: 미결제"**, 결제 후면 "결제수단/완료" 자동 분기.

### 장점

1. **코드 단순** — 한 빌더만 유지. buildOrderSlipText / printPolicy 의 정책 분리 logic 죽음.
2. **사장님 의도 정확** — 모든 출력 = 일관된 형태
3. **향후 수정 1곳** — 영수증 디자인 변경 시 buildReceiptText 만

### 단점

1. **유연성 감소** — 향후 매장이 "주방용 슬립은 메뉴만, 영수증은 다 표시" 같은 차별화 원하면 다시 분리 필요. 단 buildOrderSlipText 코드 그대로 두면 부활 가능.

### 핵심 — 입력 데이터 정규화

빌더 통일의 비결은 **입력 데이터의 정규화**:
- items[].optionLabels — 호출부가 미리 resolve (빌더는 OPTIONS_CATALOG 모름)
- total — 호출부가 computeItemsTotal
- tableLabel — 호출부가 resolveAnyTable

빌더는 pure 함수로 두고, 호출부가 데이터 준비. 호출부 4곳 모두 같은 패턴.

## 3. Silent 실패 진단 패턴 — Sentry breadcrumb 6단계

자동 출력이 "안 됨" 일 때 어디서 멈췄는지 모르면 진단 어려움. 6단계 breadcrumb 으로 명확화:

```js
// AutoPrintBridge
addBreadcrumb('autoprint.received', { tableId, itemsCount, total });   // ① 호출 받음
if (!isPrinterAvailable()) { addBreadcrumb('autoprint.skip.no-printer'); return; }  // ② 환경
if (!autoOn) { addBreadcrumb('autoprint.skip.toggle-off'); return; }    // ③ 토글
addBreadcrumb('autoprint.policy', { kinds });                          // ④ 정책
addBreadcrumb('autoprint.building', { resolvedRowsCount });            // ⑤ 빌드
const result = await printReceipt(...);
addBreadcrumb('autoprint.printResult', { ok, error, reason });         // ⑥ 결과
```

사장님이 "자동 출력 안 됨" 보고 시:
- ② 에서 멈춤 → Electron 환경 아님 (폰/web)
- ③ 에서 멈춤 → 토글 OFF (관리자 → 설정 → 자동 출력 토글 ON)
- ④ 빈 kinds → 정책 비어있음 (단 1.0.30 부터 isFresh 자동 fallback)
- ⑤ resolvedRowsCount = 0 → items 비어있음
- ⑥ ok=false → 프린터 측 실패 (인쇄 큐 / native 모듈 / 환경변수 등)

각 단계에서 stop reason 명확 → 다음 fix 정확. **silent 실패가 silent 진단** 가능.

## 4. RN native 환경의 ref 패턴 — measureInWindow

`onLayout(e)` 의 `e.target` 은 environment 마다 다름:
- **RN native (iOS/Android)**: `number` (reactTag)
- **RN web (Cloudflare)**: DOM element

둘 다 `measureInWindow` 메서드 X (RN native 의 number 에도, RN web 의 DOM 에도).

해결 — `useRef` 로 React Native 의 View component 의 ref 직접 받기:

```jsx
const viewRef = useRef(null);

<View
  ref={viewRef}
  onLayout={() => {
    if (!viewRef.current) return;
    try {
      // optional chaining — RN web 의 경우 메서드 없으면 안전 skip
      viewRef.current.measureInWindow?.((x, y, w, h) => {
        layoutRef.current = { pageX: x, pageY: y, width: w, height: h };
      });
    } catch (err) {
      reportError(err, { ctx: 'layout.measure' });
    }
  }}
>
```

RN native 의 component instance 에는 measureInWindow 가 있고, RN web 에는 없음. `?.` 로 안전 호출.

## 참고

- 오늘 세션 노트: [2026-05-09-2부-1.0.29-to-1.0.32-폰OTA-영수증통일.md](../sessions/2026-05-09-2부-1.0.29-to-1.0.32-폰OTA-영수증통일.md)
- 1부 학습 노트: [2026-05-09-electron-updater-한계-그리고-단순화.md](2026-05-09-electron-updater-한계-그리고-단순화.md)
- expo-updates docs: https://docs.expo.dev/eas-update/runtime-versions/
