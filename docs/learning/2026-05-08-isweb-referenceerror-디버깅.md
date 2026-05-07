# isWeb ReferenceError — Sentry 미동작 폰의 잠복 버그 디버깅

> 2026-05-08 · MyPos_SDK54
> 커밋: `09c6d61` (CrashFallback 진단), `ec27b99` (isWeb fix), `0605740` (되돌리기 UI 제거)

## TL;DR

- **이틀 잠복한 버그**: `screens/OrderScreen.js` line 817 의 `!isWeb` 가 IIFE 콜백 내부에만 정의된 `isWeb` 를 외부 스코프에서 참조 → JSX 평가 시점 ReferenceError → 폰만 크래시.
- **진단 막힘**: `.env` 의 `EXPO_PUBLIC_SENTRY_DSN` 가 빈 값이라 폰 빌드 Sentry init 가 skip → fallback 떠도 stack trace 캡처 불가.
- **돌파구**: `App.js` 의 `CrashFallback` 컴포넌트의 `__DEV__` 가드를 풀어 production 폰에서도 `error.message + error.stack` 화면 표시. 다음 폰 fallback 시 한 방에 진단.
- **수정**: OrderScreen 함수 상단에 `const isWeb = Platform.OS === 'web';` 한 번 정의 + IIFE 의 중복 정의 제거.

## 잠복 메커니즘

### 코드 패턴

```js
// screens/OrderScreen.js (수정 전)

// line 817 — 함수 본체 JSX 안
{!isWeb && nativeMoveFromIdx !== null ? (
  <View style={styles.nativeMoveBanner}>...</View>
) : null}

// line 833~835 — favGrid 의 IIFE 안
<View style={styles.favGrid}>
  {(() => {
    const isWeb = Platform.OS === 'web';   // ← 여기에만 정의
    ...
  })()}
</View>
```

JSX `{!isWeb && ...}` 는 **OrderScreen 함수 본체 스코프**에서 isWeb 을 lookup 함. 그러나 isWeb 은 `(() => { ... })` IIFE **콜백 내부에만** 정의됨. 함수 본체 스코프에 isWeb 없음 → ReferenceError.

### 왜 어제까지 폰만 깨졌나

| 빌드 시점 | 코드 | native 폰 동작 |
|---|---|---|
| **현 폰의 native 빌드** (1.0.2 EAS 빌드) | `26a620a` 이전 — line 817 자체 없음 | 정상 |
| 어제~오늘 OTA 발행본 | `26a620a` 이후 — line 817 의 `!isWeb` 포함 | OrderScreen 마운트 즉시 ReferenceError |

native 빌드는 OrderScreen 의 옛 코드를 hard-bake 한 상태라 line 817 이 존재하지 않아 정상. 새 OTA 받으면 그 코드가 들어와 깨짐. 이게 "1.0.15 redeploy 정상 + 새 OTA 만 fallback" 의 분리 원인.

### 왜 ReferenceError 가 마운트 즉시 터졌나

JSX `{!isWeb && ...}` 의 `!isWeb` 부분은 **React 가 children 트리 평가 시 즉시 evaluate**. React 컴포넌트 함수가 리턴하는 그 순간 ReferenceError. 그러므로 OrderScreen 마운트만 해도 깨짐 (조건부 진입 X).

Hermes engine 은 JS strict mode 기본 + ReferenceError 던지기 엄격. V8 (web) 도 같은 동작이지만, web 에선 Platform.OS === 'web' 라서 `!isWeb` 가 falsy 여도 평가 자체에서 일단 isWeb 미정의 → ReferenceError. **그러나 실제론 web 도 같은 에러가 나야 정상**. 위 코드를 보면 web 에서도 line 817 의 isWeb 미정의는 같은 문제. 그런데 사장님 PC web 은 "괜찮은 것처럼 보였다" — 아마 PC 가 OrderScreen 진입을 평소엔 한 번뿐이라 캐시된 화면이 보였을 수도. 또는 web 빌드가 minify 과정에서 dead code 로 처리. (확정 검증 안 함.)

## 진단 도구 — CrashFallback 의 production 표시

### Before

```js
function CrashFallback({ error, resetError }) {
  return (
    <View style={styles.crashRoot}>
      <Text>앱에 문제가 발생했습니다</Text>
      <Text>오류가 자동으로 보고되었습니다. 아래 버튼으로 다시 시도하세요.</Text>
      {__DEV__ && error?.message ? (
        <Text style={styles.crashError} numberOfLines={4}>
          {String(error.message)}
        </Text>
      ) : null}
      ...
    </View>
  );
}
```

`__DEV__` 가드 때문에 production 폰(EAS preview / production 빌드) 에서는 화면에 에러 메시지 안 뜸. **Sentry 가 정상 동작하는 환경 가정**의 디자인.

### After

```js
function CrashFallback({ error, resetError }) {
  const stackPreview = error?.stack
    ? String(error.stack).split('\n').slice(0, 6).join('\n')
    : '';
  return (
    <View style={styles.crashRoot}>
      <Text>앱에 문제가 발생했습니다</Text>
      <Text>오류가 자동으로 보고되었습니다. 아래 버튼으로 다시 시도하세요.</Text>
      {error?.message ? (
        <Text style={styles.crashError} numberOfLines={4}>
          {String(error.message)}
        </Text>
      ) : null}
      {stackPreview ? (
        <Text style={styles.crashStack} numberOfLines={6}>
          {stackPreview}
        </Text>
      ) : null}
      ...
    </View>
  );
}
```

- `__DEV__` 가드 제거 — production 에서도 표시.
- `error.stack` 첫 6 줄을 monospace 로 표시.
- 스타일: `crashStack` 추가 (회색 배경, 작은 글씨, monospace).

### 효과

다음 fallback 떴을 때 사장님이 캡처해 보낸 화면 한 장에:

```
ReferenceError: Property 'isWeb' doesn't exist
  at OrderScreen (address at .../5ec93a4b89f12a5d83d8f9f4672bfaed.bundle:1:122357)
  at renderWithHooks ...
```

→ 즉시 원인 식별. 한 사이클 OTA 로 끝.

## 운영 정책 시사점

### 1. `EXPO_PUBLIC_SENTRY_DSN` 부재 = production 진단 통로 부재

현재 `.env` 의 `EXPO_PUBLIC_SENTRY_DSN=` 가 빈 값. `utils/sentry.js` 의 `initSentry()` 가 DSN 없으면 silent skip. 폰 fallback 떠도 capture 안 됨.

**영구 처방 옵션**:
- (A) 실 Sentry 프로젝트 만들고 DSN 발급 → `.env` 에 채움 → EAS Secret 등록 → 다음 EAS 빌드부터 capture 활성.
- (B) `CrashFallback` 의 production error 표시 (이번 적용) — DSN 없어도 화면이 진단 통로. ✅ 즉시 적용.

(B) 가 (A) 의 차선책이지만 **DSN 무관 동작**이라 안정성 우수. (A) 는 향후 추가.

### 2. JSX 변수 미정의 = 컴포넌트 마운트 즉시 크래시

JSX `{expr}` 는 컴포넌트 렌더 시점 즉시 평가. expr 안의 ReferenceError 는 lazy X. 즉:

- "나중에 그 화면 들어가면 깨질 거야" 가 아님.
- "이 컴포넌트가 트리에 마운트되는 그 순간 깨짐."

**탐지 안전망**: ESLint `no-undef` 룰 활성화. CI 또는 pre-commit 에서 잡으면 OTA 발행 전 차단 가능. 현재 프로젝트 ESLint 룰 확인 필요.

### 3. OTA + native 빌드의 코드 분리 — `runtimeVersion: appVersion` 의 함정

`app.json` 의 `runtimeVersion: { policy: "appVersion" }` 정책상, 같은 `version` (1.0.2) 안에서는 모든 OTA 가 같은 native 빌드 위에 적용. 그러나 **native 빌드는 cabb1ed 이후 OTA 인프라가 박힌 어떤 시점**의 코드를 hard-bake. OTA 가 그 native 빌드의 옛 코드 위에 새 JS 만 덮어씌우는 구조.

이번 케이스: native 빌드 = 26a620a 이전 (line 817 자체 없음). OTA = 26a620a 이후. 새 OTA 받으면 native 가 알지 못하는 코드 패턴이 들어옴. 정상 케이스지만, **변수 스코핑 오류 같은 옛 코드엔 없던 결함이 새로 들어올 때** 잠복 가능.

**예방 패턴**:
- OTA 발행 전 별도 EAS preview build 로 1회 검증 (시간 비용 큼)
- 또는 dev build 로 폰 직접 연결해 검증

영업 안정 매장이라면 OTA 발행 = 한 번에 한 변경만 + 사장님 폰 즉시 검증 cycle. 어제 사고 이후 본격 도입.

## 실행 흐름 — 어제~오늘 시간선

| 시점 | 사건 | 결과 |
|---|---|---|
| 5/6 (`26a620a`) | 폰 메뉴 이동 모드 추가 — line 817 의 `!isWeb` 도입 (잠복) | native 빌드는 옛 코드 → 폰 정상 |
| 5/7 (`5ff7f2c`) | 1.0.15 정식 배포 — 되돌리기 운영 도구 | OTA 들어가면 깨졌어야 했는데, 사장님이 영업 중이라 폰의 OTA 적용이 미루어졌거나 OrderScreen 진입 안 함 |
| 5/8 (`0cd27a4`) | 되돌리기 UI 제거 OTA — 처음 폰 fallback | 변경 코드 의심 (오해) |
| 5/8 1차 롤백 | 1.0.15 redeploy republish | 폰 회복 — native 빌드 옛 코드라 line 817 없어서 정상으로 보임 |
| 5/8 (`fdda703a`) | 같은 변경 재발행 | 또 fallback (확정 단서로 오해) |
| 5/8 2차 롤백 + main revert | 1.0.15 redeploy republish + main 0cd27a4 → 7e5aa8b | 사장님 영업 정상화 |
| 5/8 (`42f9803`) | 이분법 step1 — KitchenScreen 만 OTA | 또 fallback (RevenueScreen 무관 확인) |
| 5/8 3차 롤백 | 1.0.15 redeploy republish | "KitchenScreen 변경이 원인" 잘못된 결론 |
| 5/8 (`09c6d61`) | 진단 도구 — CrashFallback 에 production stack trace 표시 | 폰 정상 (변경 자체 무해) → 사용자 캡처에 ReferenceError 노출 |
| 5/8 (`ec27b99`) | OrderScreen 의 isWeb 함수 상단 정의 | 폰 정상 회복 ✅ |
| 5/8 (`0605740`) | 어제 의도한 되돌리기 UI 제거 다시 적용 | 폰 + PC 정상 ✅ |

## 비유

- 무대 위 배우(`OrderScreen`) 가 대본 한 줄("`!isWeb`") 외쳤는데, 그 단어 정의는 무대 뒤(IIFE 콜백) 에만 적혀있음. 무대 위에선 그 단어를 모름 → 즉시 멈춤.
- 옛 대본본(native 빌드)에는 그 줄이 아예 없어서 멈출 일 없었음. 새 대본본(OTA) 만 그 줄 추가됐고, 같은 무대(같은 native 빌드 위) 에 새 대본 올려놓으니 즉시 사고.
- 응급실(Sentry) 이 영업 안 함 ($DSN 부재) 이라 사고 보고가 안 들어옴 → 원인 추리만 하다 시간 손실. 응급실 옆에 작은 메모지(`CrashFallback` 의 화면 표시) 한 장 붙이는 게 빠른 해법.

## 다음 액션 (선택)

- [ ] `.env` 의 `EXPO_PUBLIC_SENTRY_DSN` 채워 Sentry 정상화 — 다음 EAS 빌드부터 capture 활성
- [ ] `eslint-plugin-react` 의 `react/jsx-no-undef` 룰 또는 `no-undef` 룰 활성화 — JSX 안 ReferenceError 사전 차단
- [ ] 큰 변경 OTA 전 EAS preview build 로 폰 1회 검증 워크플로 정착
