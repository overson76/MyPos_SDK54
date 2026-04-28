# 2026-04-28 — PC 카운터 Firebase Web 통합 + 디버깅 함정 3개

> **세션 한 줄 요약**: `firebase.web.js` 의 no-op 스텁을 Firebase JS SDK 어댑터로 교체해서 카운터 PC(웹) 가 폰 4대(EAS APK) 와 같은 매장 데이터를 실시간 공유하게 만들었다. 가는 길에 RN-Web 의 함정 3개(Alert silent / babel inline AST 패턴 / 매장 가입 Gate 우회) 를 발견·수정.

---

## 🕐 시간순 흐름 (한 세션 안)

| 단계 | 한 줄 |
|---|---|
| 1 | 매장 환경 정의 (카운터 노트북 + 터치 모니터, 폰 4대) → 코어 동기화만 1~2일이면 가능 결론 |
| 2 | RN-Firebase 의 namespace API 사용 패턴 5개 파일 전수 분석 |
| 3 | namespace-like 어댑터 설계 — 호출자 코드 0줄 수정 목표 |
| 4 | `npm install firebase` + Firebase 콘솔에서 웹앱 등록 + firebaseConfig 6개 값 받기 |
| 5 | `utils/firebase.web.js` 어댑터 구현 (`wrapDb` / `wrapCollection` / `wrapDoc` / `wrapBatch` / `wrapTransaction`) |
| 6 | `App.js` 의 Web Gate 우회를 환경변수 토글로 교체 (`USE_GATE = !!process.env.EXPO_PUBLIC_FIREBASE_API_KEY`) |
| 7 | 로컬 dev 서버에서 매장 가입 화면 정상 표시 + Firebase init 확인 |
| 8 | `npx expo export --platform web` + `npx wrangler deploy` → 라이브 URL 갱신 |
| 9 | 카운터 PC 에서 매장 코드 입력 → **무반응** 발견 |
| 10 | **함정 1**: `Alert.alert` 가 RN Web 에서 silent — `alertCompat` 헬퍼로 우회 |
| 11 | 패치 후 alert 진짜 메시지: "파이어베이스가 아직 초기화 되지 않았습니다" |
| 12 | F12 콘솔 캡처 → "EXPO_PUBLIC_FIREBASE_* 환경변수가 비어있어 동기화 끕니다" |
| 13 | 빌드 산출물 grep → API 키 0개 매칭. **production export 가 환경변수 inline 안 함** 확정 |
| 14 | Sentry wrap 우회 시도 → 실패 (캐시 클리어, 명령 prefix 도 모두 실패) |
| 15 | **함정 2**: `firebase.web.js` 의 `const env = process.env; env.EXPO_PUBLIC_X` 우회 패턴 발견 |
| 16 | `process.env.EXPO_PUBLIC_X` 직접 참조로 교체 → grep 매칭 성공 |
| 17 | 재배포 → 카운터 PC 가입 흐름 정상 → **5대 동기화 성공** |
| 18 | Firestore 보안 규칙 임시 `if true` → 운영 규칙 복원 (state 컬렉션 누락 + storeCodes write 허용 보강) |

---

## 📚 새로 배운 개념

### 1) RN-Firebase namespace API ↔ Firebase JS SDK modular API

| 개념 | RN-Firebase (네이티브) | JS SDK v9+ (웹) |
|---|---|---|
| 컬렉션 접근 | `db.collection('x').doc('y').get()` | `getDoc(doc(collection(db, 'x'), 'y'))` |
| 리스너 | `ref.onSnapshot(cb, err)` | `onSnapshot(ref, cb, err)` |
| 배치 | `db.batch()` → `.set/.delete/.commit()` | `writeBatch(db)` (메소드 같음) |
| 트랜잭션 | `db.runTransaction(async tx => ...)` | `runTransaction(db, async tx => ...)` |
| 인증 | `auth().signInAnonymously()` | `signInAnonymously(auth)` |

**어댑터 패턴**: namespace 모양을 흉내내는 wrapper 객체를 firebase.web.js 안에서만 만들고, 외부로 내보내는 함수 시그니처(`getFirestore()`, `getAuth()`, `getCurrentUid()`) 는 RN 버전과 동일. 호출자(StoreContext / storeOps / MenuContext / useOrderFirestoreSync) 5개 파일 코드 변경 0줄.

### 2) Firebase 익명 인증 (Anonymous Auth) 의 기기별 분리

익명 uid 는 **(기기 + 브라우저 + 쿠키)** 단위로 발급. 같은 사용자라도 폰 / 카운터 PC / 개발 PC 가 각각 다른 uid. 매장 멤버십도 uid 별이라 카운터 PC 셋업 시 **별도 가입 절차 한 번 필요** — 다른 기기 가입은 자동 승계 X.

### 3) Firestore 보안 규칙의 컬렉션 매칭

`stores/{storeId}/state/{stateId}` 같은 sub-collection 도 명시 매칭 필요. 빠뜨리면 default 거부. 어떤 컬렉션을 쓰는지 코드 전수 조사 후 규칙 작성:

```
stores/{sid}/menu          ✓
stores/{sid}/orders        ✓
stores/{sid}/history       ✓
stores/{sid}/addresses     ✓
stores/{sid}/members       ✓
stores/{sid}/joinRequests  ✓
stores/{sid}/state         ✓ ← 누락 시 splits/groups/revenue 동기화 깨짐
storeCodes/{code}          ✓ (create 허용 — 매장 생성 트랜잭션용)
```

---

## 🐛 발견한 함정 3개 + 수정

### 함정 1 — RN `Alert.alert` 가 react-native-web 에서 silent no-op

**증상**: 카운터 PC 에서 코드 입력 후 "다음" 버튼 무반응. 빨간 에러 X, 로딩 X, 화면 변화 X.

**원인**: `Alert.alert('제목', '메시지')` 가 RN Web 환경에선 native 모달을 못 띄우고 조용히 사라짐. catch 블록에서 호출되는 alert 가 silent → 사용자 화면엔 "버튼 씹힘" 으로 보임.

**해결**: [utils/alertCompat.js](../../utils/alertCompat.js) 헬퍼 — `Platform.OS === 'web'` 분기로 `window.alert` 사용.

```js
export function alert(title, message) {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}
```

[screens/AuthScreen.js](../../screens/AuthScreen.js) 의 `Alert.alert` 호출 3곳을 `showAlert` 로 교체.

### 함정 2 — babel-preset-expo 의 EXPO_PUBLIC inline transformer 가 직접 참조만 인식

**증상**:
- dev 서버 (`npx expo start --web`): `process.env.EXPO_PUBLIC_FIREBASE_API_KEY` 정상 inline
- production 빌드 (`npx expo export --platform web`): **inline 안 됨** → 런타임 undefined

**원인**: `babel-preset-expo` 의 `EXPO_PUBLIC_*` inline transformer 가 **AST 패턴 매칭으로 `process.env.EXPO_PUBLIC_X` 직접 참조만 식별**. 변수에 담아 우회한 패턴은 못 알아챔:

```js
// ❌ babel transformer 가 못 알아봄 — production 에선 undefined
function readConfig() {
  const env = process.env || {};
  return { apiKey: env.EXPO_PUBLIC_FIREBASE_API_KEY };
}

// ✅ 직접 참조 — production 에서도 string literal 로 inline
function readConfig() {
  return { apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY };
}
```

**진단 방법**: `grep -c "AIzaSy..." dist/_expo/static/js/web/*.js` 로 빌드 산출물에서 키 값 직접 검색. 0이면 inline 실패.

**왜 dev 에선 동작했나**: dev 모드는 Node 런타임에서 process.env 를 직접 객체로 접근 → 변수 우회 패턴이어도 OK. production 은 빌드 타임에 string 으로 박아야 하므로 transformer 의존.

**교훈**: 환경변수 읽기는 **항상 직접 참조 패턴** 사용. `const env = process.env` 같은 우회 절대 금지.

### 함정 3 — App.js 의 Web Gate 우회 (구 정책 잔재)

**증상**: 매장 가입 화면이 native 에선 뜨는데 web 에선 안 뜸 (이전엔 디자인 검증용으로 일부러 우회).

**원인**: `App.js:118` 의 `Platform.OS === 'web' ? <JoinedAppTree /> : <Gate />` — 구 설계 가정 (Phone Auth, web 에선 Firebase 안 씀) 잔재.

**해결**: 환경변수 기반 토글로 변경. Firebase 키가 .env 에 있으면 = 실 매장 운영 모드 → Gate 활성. 없으면 = 디자인 검증 모드 → 우회.

```js
const WEB_FIREBASE_ENABLED = !!process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
const USE_GATE = Platform.OS !== 'web' || WEB_FIREBASE_ENABLED;
```

두 모드 다 살림. 네이티브는 google-services 자동 init 이라 항상 Gate.

---

## 🛠 사용한 명령어 / 검증 패턴

```bash
# 빌드 + 배포 (학습노트 cloud-setup.md 와 동일)
rm -rf dist node_modules/.cache
npx expo export --platform web
npx wrangler deploy

# inline 검증 (가장 중요)
grep -c "AIzaSy실제값" dist/_expo/static/js/web/*.js
# 결과 1+ = inline 성공, 0 = 함정 2 발생

# 빌드 산출물 해시 확인 (캐시 vs 새 빌드 구별)
ls dist/_expo/static/js/web/
# 같은 해시면 캐시 사용 의심 → 클리어
```

---

## 🔑 환경 정보

| 항목 | 값 |
|---|---|
| Firebase 프로젝트 ID | `mypos-4cfcc` |
| Firebase 웹앱 등록일 | 2026-04-28 |
| 라이브 URL | `https://mypos-sdk54.overson76.workers.dev` |
| 첫 동기화 성공 Version ID | `407278b1-9b0a-4b19-90ca-31fb067a1bca` |
| Firebase JS SDK 버전 | `12.12.0` |
| 매장 코드 (예시) | `RDJX-JA2Z` (8자리, 하이픈 표시) |

---

## ⚠️ 다음에 반드시 할 것

| 항목 | 이유 |
|---|---|
| Firestore 보안 규칙 게시 | 임시 `if true` → 본 운영 규칙 (이번에 보강한 state + storeCodes 포함). Firebase 콘솔 → Firestore → 규칙 → 붙여넣기 + 게시 |
| 키오스크 모드 부팅 자동화 셋업 | `2026-04-28-카운터-PC-키오스크-부팅-자동화.md` 의 chrome --kiosk 명령 시작프로그램 등록 |
| `enableIndexedDbPersistence` deprecation | 미래 버전에서 제거 예정. `FirestoreSettings.cache` 로 갈아주기 |
| 다른 화면의 Alert.alert 점검 | AuthScreen 외 Alert 호출하는 화면도 web 에서 silent 가능. grep 으로 전수 점검 |

---

## 🧠 자기 점검 — 다음에 떠올릴 것

1. **dev 서버 정상 = production 정상 ❌** — Metro 의 dev 모드와 production 빌드의 transform 동작 다름. 환경변수 inline / dead code elimination 등은 production 에서만 드러남. **빌드 산출물 grep 검증 습관**.

2. **패턴 매칭 transformer 의 한계** — babel/swc 가 단순 패턴만 인식하고 우회된 형태(변수에 담기, 구조분해, 동적 키 접근) 는 못 알아봄. 환경변수 / 매크로 / 컴파일 시점 상수는 **항상 가장 단순한 직접 참조** 사용.

3. **silent failure 가 진짜 디버깅 적** — Alert.alert 처럼 "에러는 있는데 사용자 화면에 안 뜨는" 케이스가 가장 어려움. 무반응 = 핸들러가 silent failure 했을 가능성 0순위 의심.

4. **그렙 한 줄로 빌드 검증** — `grep -c "리터럴값" dist/.../*.js` 가 inline 됐는지 확인하는 가장 빠른 방법. 추측보다 검증.

5. **익명 uid 는 기기별** — "한 매장에 가입했으니 다른 기기도 자동" ❌. 카운터 PC 추가, 직원 폰 교체, 데이터 클리어 모두 재가입 필요. 이걸 운영 매뉴얼에도 적기.

6. **메모리만으로 답하지 말 것** — 세션 초반 메모리(`project_cloud_sync.md`) 만 보고 "6~8주 로드맵" 잘못 제시. 실제 git log + 코드 확인했더니 폰 동기화는 이미 완료. 답하기 전에 현재 상태 확인 먼저.

---

## 🔜 후속 작업 후보

- 매장 1주 시범 운영 → 운영 중 발견 사항 정리
- PWA 매니페스트 + service worker (오프라인 캐시 강화)
- 키오스크 모드 셋업 (chrome --kiosk + 시작프로그램)
- 큰 모니터에서 레이아웃 미세 조정 (실측 후)
- FCM 푸시 알림 (사장님 폰 — 새 주문 알림)
- 결제수단 분리 / 부가세 / CSV 익스포트 (회계 대비)
