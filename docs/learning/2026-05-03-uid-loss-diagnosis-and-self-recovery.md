# 익명 UID 손실 사고 진단 + 매장 자가 복구 흐름 설계

날짜: 2026-05-03 (사고 발생 + 처방 동일 날짜)
세션: TestFlight 새 빌드 + .exe autoUpdater 첫 부팅 후 매장 동시 끊김 → Sentry 진단 → 자가 복구 흐름

---

## 1. 사고 시간선

| 시각 | 사건 |
|---|---|
| 5/2 17:35:01 UTC (한국 5/2 17:35) | `electron-builder --publish always` → GitHub Releases 1.0.2 .exe 업로드. PC EXE autoUpdater 가 백그라운드 다운로드 |
| 5/3 ~01:00 ~ 03:38 (한국) | 카카오맵 / 배달거리 기능 + 폰 크래시 핫픽스 + version 1.0.2 → react-native-webview 포함 새 EAS 빌드. **runtimeVersion = appVersion 정책 → 1.0.1 OTA 호환 깨짐** |
| 5/3 오전 | 사장님 폰 TestFlight 1.0.2 (buildNumber 12) 업데이트 설치 |
| 5/3 ~13:28 KST | 매장 도착 → PC 두 대 첫 부팅 = 1.0.2 첫 실행 + 사장님 폰 첫 실행 |
| 5/3 13:28:56 ~ | Sentry: `firestore/permission-denied` 102 events / 4 users / iOS 100% / dist=12 폭발 |
| 5/3 ~14:00 | "PC + 폰 모두 매장 정보 없음" 신고 |

---

## 2. 증상

- 사장님 폰 (iPad Pro 10.5-inch + iPhone) — 매장 가입 화면으로 돌아감
- PC EXE 두 대 — 매장 정보 카드 사라짐
- 직원 폰들 — 동일
- 본인 PC (집) 에서는 정상 → "장소 탓" 으로 보였음

---

## 3. 원인 분석 (Sentry 로 30분 안에 확정)

### 진단 도구
- 메모리 `feedback_pc_sync_diagnosis_first.md` 따라 자기 복구 안내 전 무조건 진단 먼저
- `latest.yml` (electron-dist) → publish 시각 확정
- 라이브 URL 번들 해시 ↔ 로컬 dist 해시 비교 → "빌드 ≠ 배포" 검증
- Sentry 콘솔 → `firestore/permission-denied` 그룹의 Tags + Contexts 확인

### Sentry Tags 결정타
```
dist: 12                           ← buildNumber 일치 = 새 EAS 빌드
runtime_version: 1.0.2             ← TestFlight 새 빌드
is_embedded_launch: true           ← 번들 임베디드 = 새 빌드 첫 실행
device.family: iOS (100%)
device: iPad Pro 10.5-inch
4 users / 102 events / 6시간 전부터 폭발
```

### 결론
**TestFlight 1.0.2 새 native 빌드가 폰에 설치되면서 Firebase Anonymous UID 가 새로 발급됨.**
새 UID 는 `stores/{}/members/{uid}` 에 없음 → Firestore 보안규칙이 모든 매장 데이터 접근을 거절.
PC 도 같은 메커니즘 (1.0.2 .exe autoUpdater 첫 부팅 = Chromium 사용자 컨텍스트 / IndexedDB 새로 시작).

**장소 자체는 원인 X**. "매장에서 처음 켠 시점이 새 빌드 첫 부팅 타이밍" 이라 우연히 겹쳐 보였음.

---

## 4. Sentry 미스터리 — release 1.0.0 하드코딩

Tags 의 `release: 1.0.0` 이 dist=12 / runtime=1.0.2 와 어긋남.

원인: `utils/sentry.js:11` 에 `const RELEASE = '1.0.0';` 하드코딩.

처방: `Constants.expoConfig?.version` 동적화. 다음 EAS 빌드부터 진짜 버전 추적.

---

## 5. 자가 복구 흐름 설계

### 핵심 아이디어
익명 UID 가 사라져도 **매장 정보(storeId / 코드 / 매장이름 / role)** 는 별도 캐시(`mypos:v1:lastStore`)에 영구 보존. 사고 시 AuthScreen 의 노란 카드로 자동 prefill → 한 클릭 복구.

### 레이어
| 파일 | 책임 |
|---|---|
| `utils/lastStore.js` | rememberStore / getLastStore / forgetLastStore (AsyncStorage) |
| `utils/StoreContext.js` | markJoined + subscribeMembership 정상 진입 시 rememberStore 호출 |
| `utils/storeOps.js` | rejoinAsOwnerWithPin — 매장 PIN 인증 후 owner 멤버 자가 등록 |
| `screens/AuthScreen.js` | HomeView 노란 카드 + REJOIN_OWNER 모드 (PIN 입력) |

### 직원 vs 대표 분기
- staff: lastStore.code 로 매장 다시 찾고 즉시 `requestJoin` → 다른 owner 가 승인하면 입장
- owner: REJOIN_OWNER 모드 → 매장 PIN 입력 → `verifyRevenuePin` (클라이언트 측 hash 비교) → members/{uid}.role='owner' 직접 set

### Firestore rules 의 행운
`firestore.rules:80` — `memberUid == uid() && request.resource.data.role == 'owner'` 가 이미 허용.
즉 **누구든 본인 uid 로 매장 owner 멤버 등록 가능**. 우리는 매장 PIN 검증을 클라이언트에서 거쳐서 활용.

⚠ **이건 동시에 보안 구멍**. 매장 PIN 알면 누구나 owner 탈취 가능. 별도 점검 권장:
- 향후 stores 문서에 ownerId 외 추가 검증 필드 (예: 옛 owner uid 토큰)
- 또는 Cloud Function 으로 매장 PIN 검증 + ownerId 변경

### stores.ownerId 변경 못 하는 부작용
rules `stores update` 가 ownerId 변경 금지. `isOwner()` 함수는 members.role 기반이라 운영 권한은 정상.
**단 deleteStore() 는 stores.ownerId 와 비교하므로 새 owner 는 매장 삭제 불가**. 운영에 영향 적음.

### 매장 PIN 미설정 케이스
`store.revenuePinHash` 가 null 이면 자가 복구 불가능. AuthScreen 이 안내 메시지 표시 + Firebase Console 직접 수정 권유.
**예방**: 매장 만들면 PIN 설정 권장 (운영 안전망).

---

## 6. 배포 흐름 — OTA + deploy:web 동시

### 변경의 성격
- 모두 JS only 변경 (native 모듈 없음, app.json 안 건드림)
- runtimeVersion = appVersion = 1.0.2 동일

### 명령
```bash
git add <7개 파일>
git commit -m "..."
npx eas-cli update --branch production --message "..."   # 폰 OTA
npm run deploy:web                                        # PC 라이브 URL
```

### 결과
- EAS Update group: `6cd38c44-d7df-4fbd-99ae-0d4f60524b22`
- 라이브 URL 새 번들: `index-0ac3bc2b22108b74a814b8fcfe0e3928.js`
- **EAS OTA 와 라이브 URL 의 번들 해시 동일** = 폰 / PC 완전히 같은 코드 받음

### 검증
1. `curl <라이브URL>` → script src 추출 → 로컬 dist 해시와 일치 확인
2. Chrome 자동화로 라이브 URL 열어서 콘솔 에러 체크
3. localStorage 에 `mypos:v1:lastStore` 가짜 값 박고 reload → 노란 카드 표시 확인
4. 본인 폰에서 OTA 받기 + 지도 작동 확인

---

## 7. 다음 사고 대응 매뉴얼

### 신고 받으면 첫 30초
1. **F12 콘솔 + 번들 해시 비교** (메모리 `feedback_pc_sync_diagnosis_first.md`)
2. Sentry 콘솔 → 24h 필터 → `firestore/permission-denied` 또는 `auth/` 키워드
3. Tags 의 `dist`, `runtime_version`, `is_embedded_launch` 확인 → 새 빌드 직후면 익명 UID 손실 의심

### 사고 확정되면
- 사장님: 매장 가입 화면 노란 카드 → "대표로 다시 시작" → 매장 PIN 입력
- 직원: 노란 카드 → "가입 요청 다시 보내기" → 사장님 승인
- PC: 매장에서 켜면 라이브 URL 새 fetch → 같은 노란 카드 → owner 복구

### 매장 PIN 미설정이면
Firebase Console → Firestore → `stores/{storeId}` 문서 → `ownerId` 필드를 사장님 새 익명 UID 로 직접 수정.

새 익명 UID 확인 방법: 사장님 폰 콘솔 (Sentry breadcrumb) 또는 임시 진단 화면에서 `getCurrentUid()` 출력.

---

## 8. 미해결 / 향후 작업

### 우선순위 높음
- **iOS keychain access group 명시** — TestFlight 새 빌드마다 익명 UID 가 정말 새로 발급되는지 진짜 원인 검증. expo-build-properties 또는 ios entitlements 추가.
- **Firestore rules 의 owner 자가등록 허용 보안 점검** — 자가 복구의 기반인 동시에 보안 구멍.

### 우선순위 중간
- 매장 PIN 미설정 매장에 대한 owner 복구 흐름 (Cloud Function + 폰번호 인증 등)
- lastStore 캐시 만료 정책 (현재 영구)
- AdminScreen 에 "이 매장 정보 잊기" 버튼 — 사장님이 의도적으로 매장 떠날 때

### 운영 권장
- **신규 매장 만들면 즉시 매장 PIN 설정** — 사고 시 자가 복구의 유일한 인증 수단
- TestFlight 또는 .exe 새 버전 배포 직후 매장 운영자에게 안내 ("새 버전 깐 후 매장 가입 화면 뜨면 노란 카드 누르세요")

---

## 9. 메모리 갱신 권장

다음 세션에 자동으로 떠올리도록:
- `project_lastStore_self_recovery.md` (NEW) — 자가 복구 흐름 + AuthScreen 노란 카드 + rejoinAsOwnerWithPin 패턴
- `project_uid_loss_root_cause.md` (NEW) — TestFlight 새 빌드 + .exe autoUpdater 첫 부팅 = 익명 UID 손실 메커니즘 정리
- `project_pc_sync_fix.md` 갱신 — 자가 복구 카드로 처방 단순화 (캐시 명령어 안내 → "노란 카드 누르세요")

---

## 변경 파일 요약 (커밋 c523683)

| 파일 | 변경 |
|---|---|
| `utils/lastStore.js` (NEW) | 매장 정보 영구 캐시 모듈 |
| `utils/StoreContext.js` | rememberStore 호출 추가 (markJoined + subscribeMembership) |
| `utils/storeOps.js` | rejoinAsOwnerWithPin 함수 추가 |
| `screens/AuthScreen.js` | HomeView 노란 카드 + REJOIN_OWNER 모드 + PIN 입력 view |
| `components/DeliveryMapModal.native.js` | absolute overlay + WebView + Leaflet 풀구현 (fallback 만 있던 것 → 진짜 지도) |
| `screens/TableScreen.js` | `Platform.OS === 'web' ?` 분기 제거 (폰에서도 모달 호출됨) |
| `utils/sentry.js` | RELEASE 1.0.0 하드코딩 → Constants.expoConfig.version 동적 |
