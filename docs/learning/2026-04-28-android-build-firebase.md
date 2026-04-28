# 2026-04-28 — Android EAS 빌드 + Firebase 실전 연동

> **세션 한 줄 요약**: MyPos 앱을 처음으로 실제 안드로이드 폰에 설치하고, Firebase 매장 공유 기능을 켜는 과정에서 @react-native-firebase v22+ API 변경 버그 3개를 발견·수정했다.

---

## 🕐 시간순 흐름

| 단계 | 한 줄 설명 |
|---|---|
| 1 | 앱 실전 테스트 환경 결정 — 안드로이드만, 같은 프로젝트에서 진행 |
| 2 | `before-android-build` 안전 태그 박기 |
| 3 | EAS Build 첫 Android APK 빌드 (preview 프로파일) |
| 4 | Firebase 콘솔 확인 — Firestore 활성화, Anonymous Auth 활성화 |
| 5 | Firestore 보안 규칙이 잠금 모드 → 임시 `if true` 로 변경 |
| 6 | APK 설치 → 버그 1 발견: 매장 코드 생성 실패 |
| 7 | 버그 1 수정: `snap.exists` → `snapExists()` 헬퍼 |
| 8 | 재빌드 → 버그 2 발견: Nested arrays 에러 |
| 9 | 버그 2 수정: `serverTimestamp()` → `new Date()` |
| 10 | 재빌드 → 매장 코드 발급 성공, 마이그레이션 실패 (무시 가능) |
| 11 | Firebase Admin SDK 스크립트로 멤버 직접 승인 |
| 12 | 버그 3 발견: 관리자 → 시스템 탭 1~2초 후 크래시 |
| 13 | 버그 3 수정: `formatJoinedAt` / `modalStyles` module 레벨로 이동 |
| 14 | 4차 빌드 → 정상 동작 확인 |
| 15 | 세션 마무리: 워크트리/커밋/보안 정리 |

---

## 📚 새로 배운 개념

### 1) EAS Build (Expo Application Services, 엑스포 빌드 서비스)

Expo 가 제공하는 클라우드 빌드 서비스. 내 PC 대신 Expo 서버에서 APK/IPA 를 빌드해준다.

```bash
npx eas-cli build --platform android --profile preview --non-interactive
```

- `preview` 프로파일: 내부 배포용. App Store/Play Store 없이 직접 설치 가능.
- `--non-interactive`: CI/자동화 모드 — 질문 없이 기본값으로 진행.
- 빌드 완료 후 **직접 APK URL** 발급됨 — `eas build:view <id> --json` 으로 추출.

| 항목 | 설명 |
|---|---|
| 빌드 시간 | 클라우드에서 10~20분 |
| 무료 한도 | 30회/월 (Expo 무료 계정) |
| 빌드 이력 | https://expo.dev 에서 확인 |

### 2) APK 사이드로드 (sideload, 직접 설치)

Play Store 없이 APK 파일을 직접 안드로이드에 설치하는 방법.

1. 폰 설정 → 앱 → 파일 관리자 → **"이 출처 허용"** 토글
2. APK 파일 클릭 → 설치

"Browser not supported" 에러 발생 시: Expo 페이지 대신 **직접 APK URL** 사용.
```
https://expo.dev/artifacts/eas/<artifactId>.apk
```

### 3) Firebase Anonymous Authentication (익명 인증)

회원가입 없이 앱이 자동으로 uid 를 발급받는 방법. Firebase 콘솔 → Authentication → Sign-in method → **익명 활성화** 필요.

- 익명 uid 는 앱 데이터를 지우거나 재설치하면 새로 발급됨 (새 사용자)
- uid 가 있어야 Firestore 보안 규칙의 `request.auth != null` 통과

### 4) Firestore 보안 규칙 모드

| 모드 | 규칙 | 의미 |
|---|---|---|
| 잠금(Production) | `allow read, write: if false` | 모두 차단 — 운영용 |
| 테스트 | `allow read, write: if true` | 모두 허용 — 개발/검증용 |
| 사용자 정의 | 우리 `firestore.rules` | 매장 멤버만 읽기/쓰기 |

**규칙은 트랜잭션 안에서도 적용됨** — `allow write: if false` 면 트랜잭션 쓰기도 차단.

### 5) Firebase Admin SDK (관리자 SDK)

서버 또는 로컬 스크립트에서 Firestore/Auth 에 **관리자 권한**으로 직접 접근.

```js
const admin = require('firebase-admin');
const serviceAccount = require('./firebase-admin-key.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
await db.collection('stores').doc(storeId).collection('members').doc(uid).set({...});
```

**⚠️ 보안 주의**:
- 서비스 계정 키 (JSON) 는 절대 깃허브에 올리면 안 됨
- 사용 후 즉시 삭제
- `.gitignore` 에 반드시 등록

---

## 🐛 발견한 버그 3개 + 수정

### 버그 1 — `snap.exists` API 변경 (11곳 패치)

**증상**: "매장 코드 생성에 실패했습니다"

**원인**: `@react-native-firebase v22+` 에서 `DocumentSnapshot.exists` 가 `boolean 속성 → boolean 메소드` 로 변경됨.

```js
// 기존 (v22 이전)
if (!snap.exists) { ... }      // 항상 truthy (함수 객체) → break 안 됨

// 수정
if (!snapExists(snap)) { ... } // 호환 헬퍼
```

**해결**: `utils/firestoreCompat.js` 에 `snapExists()` 헬퍼 추가:
```js
export function snapExists(snap) {
  if (!snap) return false;
  return typeof snap.exists === 'function' ? snap.exists() : !!snap.exists;
}
```

### 버그 2 — `serverTimestamp()` 직렬화 오류

**증상**: "[firestore/unknown] Invalid data. Nested arrays are not supported"

**원인**: `@react-native-firebase v22+` 에서 namespace API (`firestore.FieldValue.serverTimestamp()`) 의 sentinel 객체 직렬화가 Firestore 에서 거부됨.

**해결**: `utils/firebase.js` 의 serverTimestamp 를 `new Date()` 로 우회.
```js
export function serverTimestamp() {
  return new Date(); // Firestore 가 자동으로 Timestamp 로 변환
}
```

### 버그 3 — `formatJoinedAt` / `modalStyles` 스코프 오류

**증상**: 관리자 → 시스템 탭 진입 1~2초 후 크래시

**원인**: `formatJoinedAt` 함수와 `const modalStyles` 가 `makeStyles()` 함수의 `return` **이후** 에 선언돼 unreachable 코드. 바깥에서 호출 시 `ReferenceError`.

**타이밍**: Firestore 에서 멤버 데이터가 도착한 순간 (1~2초 후) `members.map(m => formatJoinedAt(m.joinedAt))` 호출 → 크래시.

**해결**: 두 항목을 module 레벨로 이동. `modalStyles` 의 `fp()` → 고정값.

---

## 🛠 사용한 명령어

```bash
# EAS 빌드
npx eas-cli whoami                              # 로그인 상태 확인
npx eas-cli build --platform android --profile preview --non-interactive
npx eas-cli build:view <buildId> --json         # APK 직접 URL 추출

# Firebase Admin 스크립트
npm install --save-dev firebase-admin
node scripts/approve-member.js                  # Firestore 직접 조작
npm uninstall firebase-admin                    # 사용 후 제거
rm -f firebase-admin-key.json                   # 키 파일 삭제

# 안전 태그
git tag -a before-android-build -m "..."
git push origin before-android-build
```

---

## 🔑 환경 정보

| 항목 | 값 |
|---|---|
| Firebase 프로젝트 ID | `mypos-4cfcc` |
| Firestore DB | `(default)` |
| EAS 프로젝트 ID | `375f34f1-9693-4b5a-9ed4-eaa143edf2bb` |
| 4차 빌드 APK | `https://expo.dev/artifacts/eas/eZDqqGTGDummsTvwhmcxnV.apk` |
| 현재 Firestore 규칙 | ⚠️ 임시 `allow if true` — 운영 전 본 규칙으로 복원 필요 |

---

## ⚠️ 다음에 반드시 할 것

| 항목 | 이유 |
|---|---|
| Firestore 보안 규칙 복원 | 현재 `allow if true` — 누구나 데이터 접근 가능한 위험 상태 |
| 두 번째 폰 동기화 검증 | 매장 공유 핵심 기능 검증 미완료 |
| `serverTimestamp()` modular API 로 전환 | 현재 `new Date()` 는 클라이언트 시계 기반 — 오차 가능 |
| 마이그레이션 `Nested arrays` 버그 수정 | 기존 로컬 데이터 클라우드 이전 실패 |

---

## 🧠 자기 점검 — 다음에 떠올릴 것

1. **`snap.exists` vs `snap.exists()`** — 라이브러리 업그레이드 후 API 변경은 런타임에 조용히 터짐. 새 버전 changelog 확인 습관.
2. **Firestore 규칙은 트랜잭션 안에서도 적용** — `allow write: if false` 면 Admin SDK 아닌 클라이언트는 트랜잭션도 막힘.
3. **서비스 계정 키는 쓰자마자 삭제** — .gitignore 에 등록해도 실수 가능.
4. **`return` 이후 코드는 unreachable** — JS 에서 function declaration 은 hoisting 되지만 `const` / `let` 은 실행 안 됨. 같은 블록에 오래된 코드가 쌓이면 이런 함정 생김.
5. **EAS 빌드는 클라우드 큐 의존** — 무료 티어는 최대 17분+ 큐 대기 가능. 급하면 `npx wrangler deploy` 처럼 로컬 직접 배포 우회.
