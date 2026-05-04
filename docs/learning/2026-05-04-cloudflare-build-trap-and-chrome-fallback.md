# Cloudflare 자동 빌드 함정 + PC Chrome 우회 — 매장 영업 복구 사고

날짜: 2026-05-04
세션: 어제 자가 복구 코드 push → Cloudflare 자동 빌드 깨진 번들 배포 → 매장 PC 영업 못 함 → 진단 → Chrome 우회 → 영업 시작

---

## 사고 흐름 (시간 순)

1. **2026-05-03 (어제 밤)**: 자가 복구 흐름 (lastStore + 노란 카드 + 대표 가입 PIN) 구축. commit `c523683` + `37cb00d` push. 라이브 URL 에 **로컬 deploy:web** 으로 정상 번들 배포 확인.
2. **2026-05-04 오전 (매장 도착)**: PC 두 대 + 폰들 모두 매장 가입 안 됨. **노란 카드 / 대표 가입 옵션 한 번도 못 봄**. 영업 못 함.
3. **사용자가 아이폰 claude.ai 앱에서 별도 세션 시작** → PC F12 콘솔 캡처 보냄
4. **아이폰 세션이 진짜 원인 잡음**: Firebase v12 호환 깨짐 (`enableIndexedDbPersistence` 제거). 코드 수정 + push (커밋 `76071a4`, `e1a839b`, `cc2020f`).
5. **GitHub main push → Cloudflare 자동 빌드 트리거**. 그러나 Cloudflare 환경변수에 `EXPO_PUBLIC_FIREBASE_*` 미등록 → **빈 키로 빌드 → 라이브 URL 에 깨진 번들 배포**.
6. **사용자가 Cloudflare 토큰 발급 시도** (deploy 자동화하려고). 토큰 작업 도중 세션 종료. 영업 여전히 못 함.
7. **이번 세션 (오전)**: 사용자 다시 합류. F12 콘솔 검증 → "EXPO_PUBLIC_FIREBASE_* 환경변수가 비어있어" 메시지 발견.
8. **로컬 `npm run deploy:web` 한 번 실행** (토큰 불필요, wrangler login 완료 상태). 정상 번들 라이브 URL 갱신.
9. **사용자 제안**: "PC 에서 웹버전 열까?" → 정답. EXE 캐시는 옛 깨진 번들 잡고 있음. 일반 Chrome 으로 라이브 URL 열면 깨끗한 캐시로 새 번들 받음.
10. **주방 PC Chrome → 라이브 URL → 매장 가입 화면 정상 → 매장 코드 + 대표(PIN) → 영업 시작**

---

## 진짜 효과 있었던 것 (사고 → 성공의 결정타)

### 1. Firebase v12 호환 수정 (아이폰 세션, 커밋 76071a4 / cc2020f)

`enableIndexedDbPersistence` 가 Firebase v11+ 에서 제거됨. 우리 `utils/firebase.web.js` 가 그걸 호출 → init 자체 실패 → AuthScreen 안 뜸.

수정:
```js
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';

const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});
```

또 wrapDocRef.update / wrapCollection.get / wrapQuerySnapshot 누락도 같이 수정.

### 2. 로컬 `npm run deploy:web` (이번 세션)

Cloudflare 자동 빌드는 환경변수 비어있어서 깨진 번들 배포. 로컬 `.env` 의 Firebase 키 inline 된 정상 번들로 라이브 URL 갱신. **30초**.

### 3. PC 일반 Chrome 으로 라이브 URL 열기 (사용자 제안)

EXE Chromium 캐시는 옛 깨진 번들 잡고 있음. F12 안 먹으면 캐시 비우는 것도 어려움. **일반 Chrome 은 별도 인스턴스 = 깨끗한 캐시** = 새 번들 즉시 받음.

5초 처방으로 영업 가능.

### 4. 어제 만든 "대표로 가입(PIN)" 옵션 (커밋 37cb00d)

Chrome 으로 새로 가입할 때 lastStore 캐시 없으니 노란 카드 안 뜸. 매장 코드 입력 후 미리보기 화면에서 **"대표로 가입(PIN)" 옵션** 이 있어야 사용자 폰 owner 승인 안 기다리고 즉시 입장 가능.

가족 사업이라 모두 owner 결정 → 이 옵션이 결정적. 없었으면 직원으로 가입 → 사장님 폰에서 승인 단계 한 번 더 필요.

### 5. 매장 PIN 사전 설정

owner 자가 가입의 유일한 인증 수단. 사용자가 어제 미리 설정해뒀던 게 결정적. 미설정이었으면 deadlock.

---

## 메타 — 무엇을 배웠나

### 진단 우선순위
**F12 콘솔 첫 메시지가 모든 답을 가지고 있다**. 자기 복구 카드 안내 / 캐시 비우기 / 매장 코드 재입력 같은 처방을 시도하기 전에 **반드시 콘솔 메시지 먼저 확인**.

- "EXPO_PUBLIC_FIREBASE_* 환경변수가 비어있어" → Cloudflare 자동 빌드 함정 (deploy:web)
- "enableIndexedDbPersistence is not a function" → Firebase v12 호환 (코드 패치)
- 다른 에러 → 케이스별 분석

### 빌드 ≠ 배포
- 로컬 `expo export` ≠ 라이브 URL 에 새 번들 올라감
- Cloudflare 자동 빌드 ≠ 정상 빌드 (환경변수 함정)
- **항상 라이브 URL 의 실제 번들 + 콘솔 메시지로 검증**

### 영업 우선
PC 캐시 깊이 파고들기보다 **일반 Chrome 으로 라이브 URL 직접 열기** 가 가장 빠른 영업 복구. EXE 깨진 캐시는 영업 끝나고 천천히 정리.

---

## 영구 처방 (미적용)

1. **Cloudflare Pages 환경변수에 EXPO_PUBLIC_FIREBASE_* 등록** — 자동 빌드도 정상 번들 만들도록
2. **또는 Cloudflare 자동 빌드 비활성화** — 항상 로컬 `npm run deploy:web` 만 사용 (현재 운영 흐름과 일치, 더 안전)
3. **scripts/deploy-web.sh 의 grep 검증을 실패 시 분명히 표시** — 이미 함정 2 grep 검사하지만 Cloudflare 자동 빌드는 이걸 우회함

---

## 다음 사고 대응 매뉴얼 (한 줄)

**"PC 매장 안 됨" → Chrome 으로 라이브 URL 열어서 영업 시작 + F12 콘솔 첫 메시지 확인 → 본인은 deploy:web 한 번**

---

## 변경 파일 (이번 세션)

| 파일 | 변경 |
|---|---|
| `utils/firebase.web.js` | (어제 아이폰 세션) Firebase v12 호환 + wrapping 누락 |
| `utils/StoreContext.js` | (어제 아이폰 세션) 매장 코드 레이스 + latestStoreDataRef 캐시 |
| `screens/AdminScreen.js` | (어제 아이폰 세션) 대표도 PIN 설정 시 PC 재연동 버튼 |
| 라이브 URL 새 번들 | `index-29a7e1dcf3c526820cb3c4a151b953d5.js` (오늘 deploy:web 결과) |

## 메모리 신규 (다음 세션 자동 떠오름)

- `project_cloudflare_auto_build_trap.md`
- `project_pc_chrome_fallback.md`
- `project_firebase_v12_compat.md`
- `feedback_pc_sync_diagnosis_first.md` 갱신
