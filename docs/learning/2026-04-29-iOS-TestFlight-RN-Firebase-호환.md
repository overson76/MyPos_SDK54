# 2026-04-29 — iOS TestFlight 첫 배포 + RN-Firebase forceStaticLinking fix

> **세션 한 줄 요약**: 사장님 본인 폰(iPhone) 에 MyPos 설치 위해 EAS iOS 빌드 + TestFlight 흐름 첫 셋업. RN-Firebase v22 + Expo SDK 54 + New Architecture + use_frameworks 호환 이슈를 Expo 공식 PR #39742 의 `forceStaticLinking` 옵션으로 해결.

---

## 🕐 시간순 흐름

| 단계 | 한 줄 |
|---|---|
| 1 | TestFlight vs 앱스토어 차이 학습 — 매장 1개 전용 앱은 TestFlight 가 적합 |
| 2 | App Store Connect 신규 앱 등록 시도 — Bundle ID 가 드롭다운에 안 보임 |
| 3 | Apple Developer Portal 의 Identifiers 에 `com.cadpia.mypos` 등록 |
| 4 | App Store Connect 신규 앱 생성 (MyPos / 한국어 / SKU mypos-2026) 성공 |
| 5 | App-Specific Password 발급 (16자리) |
| 6 | 1차 EAS 빌드 시도 — `npx eas-cli build --platform ios --profile production --non-interactive` |
| 7 | Fail: "Distribution Certificate is not validated for non-interactive builds" → 첫 빌드는 인터랙티브 필수 |
| 8 | 인터랙티브 모드 시도 — Apple ID 비밀번호 + 2FA 코드 입력 → credentials EAS 서버에 자동 저장 |
| 9 | 2차 빌드 — Fail: `RNFBFirestore` 모듈 빌드 실패, `RCTBridgeModule` import 충돌 |
| 10 | newArchEnabled false 로 변경 → 3차 빌드 — Fail: `RNCSliderComponentDescriptor.h` not found |
| 11 | dilemma 발견 — newArch on 이면 RN-Firebase fail / off 면 slider fail |
| 12 | Expo PR #39742 의 `forceStaticLinking` 옵션 적용 + newArchEnabled true 복원 |
| 13 | 4차 빌드 — **성공** (.ipa 산출) |
| 14 | `npx eas-cli submit --platform ios --latest` — TestFlight 업로드 성공 |
| 15 | EAS 가 자동으로 임시 API Key 발급 + 내부 테스트 그룹 "Team (Expo)" 생성 + 본인 이메일 자동 추가 |

---

## 📚 새로 배운 개념

### 1) TestFlight (테스트플라이트) vs App Store

| 항목 | 앱스토어 | TestFlight |
|---|---|---|
| 누가 받음 | 전 세계 누구나 | 초대받은 베타 테스터 (최대 100명) |
| 심사 | 깐깐 (수일~주) | 가벼움 (1~2일, 첫 빌드만) |
| 유효 기간 | 영구 | 빌드당 90일 |
| 검색 노출 | O | X (비공개) |
| 사적 매장용 | ❌ Apple 가이드라인 4.2.10 위반 | ✅ 정확히 이런 용도 |

**매장 1개 전용 POS 는 TestFlight 가 정답**. 앱스토어 등록은 Apple 이 reject 가능.

### 2) Apple Developer 셋업의 분리된 4단계

```
1. Apple Developer Program  ─►  유료 가입 ($99/년). 본인이 owner
2. Apple Developer Portal   ─►  Identifiers (Bundle ID 등록)
                                Certificates (인증서)
                                Provisioning Profiles
3. App Store Connect        ─►  내 앱 (앱 메타데이터, TestFlight, 출시)
4. EAS Build / EAS Submit   ─►  Expo 의 빌드/제출 서비스
```

**Bundle ID 가 App Store Connect 의 신규 앱 등록 다이얼로그에서 안 보이면** = Developer Portal 의 Identifiers 에 등록 안 된 상태. 거기 먼저.

### 3) 두 종류의 비밀번호 — 절대 헷갈리지 말 것

| 비밀번호 | 용도 |
|---|---|
| **Apple ID 일반 비밀번호** | 브라우저 로그인용. EAS build 단계의 `Password:` prompt |
| **App-Specific Password (16자리, `xxxx-xxxx-xxxx-xxxx`)** | 외부 도구가 Apple 에 접근. EAS submit 단계 |

**EAS build 시 App-Specific Password 입력 = fail**. 정반대.

### 4) App Store Connect API Key (.p8) — 영구 자동화

- App Store Connect → 사용자 및 액세스 → 통합 → 팀 키
- **owner / admin 권한자만 발급 가능**. invited member 는 "액세스 요청" 필요
- 발급 시 .p8 파일 다운로드 (한 번만 가능)
- EAS 에 등록하면 build/submit 둘 다 100% 자동 (인터랙티브 X, 비밀번호 X)
- **이번 세션에선 사용자가 owner 권한 있지만 콘솔 UI 가 권한 요청 화면 보임 → 옵션 A 인터랙티브로 우회**

### 5) New Architecture (Fabric) + use_frameworks 호환

iOS 빌드의 두 가지 모드:
- **New Architecture (newArchEnabled: true)**: React Native 의 새 렌더러 (Fabric). SDK 54 default
- **Old Architecture**: 옛 bridge

각 라이브러리가 둘 중 하나 또는 둘 다 지원:
- `@react-native-firebase` v22+: New Architecture 호환 — 단 `use_frameworks: 'static'` 과 충돌
- `@react-native-community/slider` v5+: New Architecture 전용 (newArchEnabled: false 면 헤더 누락)

**dilemma**: 둘 다 만족시키려면 `forceStaticLinking` 같은 추가 옵션 필요.

---

## 🐛 발견한 함정 + 해결

### 함정 1 — RN-Firebase iOS + New Arch + use_frameworks 호환

**증상** (1차 빌드, newArchEnabled true):
```
- declaration of 'RCTBridgeModule' must be imported from module 'RNFBApp.RNFBAppModule' before it is required
- could not build Objective-C module 'RNFBFirestore'
```

**증상** (2차 빌드, newArchEnabled false):
```
- 'react/renderer/components/RNCSlider/RNCSliderComponentDescriptor.h' file not found
```

→ 둘 다 fail. dilemma.

**원인**: SDK 54 + RN-Firebase v22 + use_frameworks: 'static' 조합에서 일부 RN-Firebase Pods 가 dynamic 으로 잡히면서 module import 충돌. Expo issue #39607 에 보고됨.

**해결**: Expo 공식 PR #39742 의 `forceStaticLinking` 옵션. 사용 중인 RN-Firebase 모듈을 명시적으로 static 강제:

```json
"plugins": [
  "@react-native-firebase/app",
  "@react-native-firebase/auth",
  [
    "expo-build-properties",
    {
      "ios": {
        "useFrameworks": "static",
        "forceStaticLinking": ["RNFBApp", "RNFBAuth", "RNFBFirestore"]
      }
    }
  ]
]
```

**핵심**:
- `expo-build-properties` 55.x 부터 `forceStaticLinking` 지원
- `@react-native-firebase/app` plugin 이 `expo-build-properties` 보다 **먼저** 와야
- 사용 중인 RNFB 모듈 모두 명시 (`RNFBApp`, `RNFBAuth`, `RNFBFirestore`, 추가 시 `RNFBMessaging` 등)

### 함정 2 — `--non-interactive` 첫 iOS 빌드 fail

**증상**:
```
Distribution Certificate is not validated for non-interactive builds.
Failed to set up credentials.
```

**원인**: 첫 iOS 빌드는 EAS 가 Apple Developer Portal 에 인증서 자동 생성해야 → Apple 계정 인증 필요 → 인터랙티브 prompt.

**해결**: `--non-interactive` 빼고 한 번 인터랙티브로 실행. Apple ID 비밀번호 + 2FA. 이후 credentials EAS 서버 자동 저장 → 다음 빌드부터 자동.

### 함정 3 — App-Specific Password 로 build credentials 통과 시도

**증상**: build 단계의 `Password:` prompt 에 16자리 App-Specific Password 입력 → 인증 실패.

**원인**: build 단계는 Apple ID **일반 비밀번호** 만 OK. App-Specific Password 는 submit 단계용.

**교훈**: 두 비밀번호 명확히 구별. 서로 못 바꿈.

---

## 🛠 핵심 명령어

```bash
# 빌드 (첫 번 째는 인터랙티브)
npx eas-cli build --platform ios --profile production

# 빌드 (credentials 등록 후)
npx eas-cli build --platform ios --profile production --non-interactive

# Submit (TestFlight 업로드)
npx eas-cli submit --platform ios --latest

# 빌드 상태 확인
npx eas-cli build:view <buildId>
```

---

## 🔑 환경 정보

| 항목 | 값 |
|---|---|
| Apple ID | k4429@nate.com |
| Apple Team ID | AZY8B6QRW5 |
| Bundle ID | com.cadpia.mypos |
| App Store Connect ASC App ID | 6764499541 |
| EAS 빌드 ID (성공) | e36e053f-4165-432f-8844-aa98f25ad852 |
| .ipa URL | https://expo.dev/artifacts/eas/u5SySVQnJE77x7E5XyTVuN.ipa |
| TestFlight 페이지 | https://appstoreconnect.apple.com/apps/6764499541/testflight/ios |
| 내부 테스트 그룹 | Team (Expo) — EAS 자동 생성 |

---

## ⚠️ 다음에 반드시 할 것

| 항목 | 이유 |
|---|---|
| iPhone 에 TestFlight 앱 설치 + MyPos 받기 | 사장님 본인 폰 운영 시작 |
| 새 매장에 iPhone 가입 | 매장 멤버 추가 (현재 매장 코드 입력) |
| App Store Connect API Key 발급 (owner 권한 액세스 요청) | 향후 빌드/submit 100% 자동 |
| OTA 셋업 (expo-updates) | 폰 4대 자동 업데이트 |
| Electron .exe 셋업 | 카운터 PC 영수증 프린터 추가 시점 |

---

## 🧠 자기 점검 — 다음에 떠올릴 것

1. **iOS 첫 빌드는 항상 인터랙티브** — `--non-interactive` 로 시작하면 무조건 fail. Apple credentials 자동 생성에 인증 필요.

2. **두 종류 비밀번호 절대 헷갈리지 말 것** — build = 일반 비밀번호, submit = App-Specific Password.

3. **dilemma 가 보이면 외부 fix 검색** — 두 라이브러리가 서로 다른 환경 요구하면 외부 패치 (forceStaticLinking 같은) 가 있을 가능성. 추측 시도 X 검색 우선.

4. **Bundle ID 등록은 두 곳에서** — Developer Portal 의 Identifiers 가 먼저, App Store Connect 의 신규 앱이 그 다음.

5. **EAS 가 자동으로 많이 처리** — 임시 API Key 발급, 내부 테스트 그룹 생성, 본인 이메일 추가까지 자동. 사용자 수동 작업 최소화.

6. **빌드 fail 시 GitHub issue 검색** — Expo / RN-Firebase 의 known issue 는 거의 다 GitHub 에 fix 있음. Expo issue #39607 + PR #39742 가 정확히 이번 케이스.

---

## 🔜 다음 작업

- iPhone 에 MyPos 설치 + 매장 가입 + 동기화 검증 (사용자 작업)
- (다음 세션) Electron .exe 셋업 — Phase 1 기본 동작 + Phase 2 자동 업데이트 + Phase 3 영수증 프린터
- (다음 세션) OTA 셋업 (expo-updates) — 폰 4대 자동 업데이트 환경
