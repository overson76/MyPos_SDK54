# 2026-05-25 (2부) — 주소록 phones array 가드 + phone-only orphan 1회 청소

## 한 줄 요약

사장님 영업 중 신고 "동진카에어컨처럼 휴대폰 저장된 손님인데 CID 알림에 별칭이 안 뜨고 전번만 뜬다" — 옛 `addPhoneOnly` 가드가 `e.phone` 단일 필드만 검사해 `phones` array 만 갖는 정식 entry 의 휴대폰이 들어오면 별도 `__phone:digits` orphan 생성 → CID 매칭이 alias 없는 orphan 을 먼저 잡는 사고. `hasPhoneDigitsAnywhere` 로 가드 강화 (신규 차단) + `mergeOrphanPhoneOnlyEntries` 부팅 시 1회 자동 청소 (기존 누적 복구).

## 무엇이 바뀌었는가

| Q | A |
|---|---|
| "동진카에어컨 휴대폰 저장돼있는데 별칭 안 뜨고 전번만 뜸 — 왜?" | 같은 휴대폰의 정식 entry (alias 있음) + `__phone:digits` orphan (alias 없음) 가 동시 존재. CID 매칭이 orphan 먼저 잡음 |
| "왜 orphan 이 생겼나" | `addPhoneOnly` 의 옛 중복 가드가 `e.phone` 단일만 검사. 정식 entry 가 `phones: ["휴대폰"]` 만 있고 `phone` 단일 없으면 가드 통과 → CID 들어올 때마다 orphan 생성 |
| "신규 사고 어떻게 막나" | `hasPhoneDigitsAnywhere(entries, digits)` 로 가드 교체 — `phone` + `phones` array 둘 다 검사 |
| "기존 누적 orphan 은?" | `mergeOrphanPhoneOnlyEntries` — 부팅 시 hydrate 후 1회 자동 통합 (정식 entry 우선, orphan 삭제). 매치 안 되는 orphan 은 유지 (사장님이 나중에 주소 채울 의미 있는 데이터) |
| "마이그레이션 무한 루프 위험 없나" | `migrationRanRef` 가드 + `merged !== entries` reference 비교 + `prev.entries === entries` 가드 3중 — 한 번만 실행 |

## 신규/변경 파일

| 파일 | 변경 |
|---|---|
| [utils/addressBookMigrations.js](../../utils/addressBookMigrations.js) | **신규** — 순수 함수 3종 (`mergeOrphanPhoneOnlyEntries`, `hasPhoneDigitsAnywhere`, `collectPhoneDigits`) |
| [utils/useAddressBook.js](../../utils/useAddressBook.js) | 마이그레이션 effect 추가 (자정 리셋 effect 옆) + `addPhoneOnly` 가드를 `hasPhoneDigitsAnywhere` 로 교체 |
| [__tests__/addressBookMigrations.test.js](../../__tests__/addressBookMigrations.test.js) | **신규** — 17 케이스 (동진카에어컨 시나리오 직접 검증 포함) |

## 알려진 문제 / 미해결 이슈

- 없음. 마이그레이션은 *데이터 삭제 X* (orphan 만 삭제 — 본래 의미 없는 데이터). 정식 entry 는 절대 안 건드림.

## 다음 세션 진입 가이드

```bash
# 현재 main HEAD
git -C C:/MyProjects/MyPos_SDK54 log --oneline -5

# jest 회귀 검증
npx jest

# 실 검증 (영업 후)
# 1. 카운터 PC EXE 재시작 → 부팅 시 마이그레이션 자동 동작
# 2. 관리자 → 주소록 → "동진" 검색 → orphan 사라졌는지 확인
# 3. 동진카에어컨에서 전화 오면 CID 알림에 "동진카에어컨" 별칭 뜨는지
```

## 핵심 기술 결정

### 마이그레이션 타이밍 — useEffect + ranRef

옵션 1 (영속화 flag) 은 데이터 재설치 후 다시 도는 문제 + 매번 검사. 옵션 2 (매 마운트 1회) 는 신규 가드 박혔으니 영업 중 추가 청소 불필요 + 비용 거의 0. → **옵션 2 채택**.

```js
const migrationRanRef = useRef(false);
useEffect(() => {
  if (migrationRanRef.current) return;
  const entries = addressBook.entries;
  if (!entries || Object.keys(entries).length === 0) return; // hydrate 대기
  const merged = mergeOrphanPhoneOnlyEntries(entries);
  if (merged !== entries) {
    setAddressBook((prev) =>
      prev.entries === entries ? { ...prev, entries: merged } : prev
    );
  }
  migrationRanRef.current = true;
}, [addressBook.entries]);
```

### 순수 함수 분리 — addressBookMigrations.js

`mergeOrphanPhoneOnlyEntries` / `hasPhoneDigitsAnywhere` / `collectPhoneDigits` 모두 hook 외부 순수 함수 → jest 단위 테스트 17 케이스 가능. `orderHelpers.js` / `addressBookLookup.js` 패턴 따름.

### orphan 통합 정책 — 정식 우선

정식 entry 가 보통 더 풍부한 정보 (주소, 별칭, 단골요청 등) 보유. orphan 은 phone digits 만 있는 경우 대부분. → orphan 은 *통째 삭제*, 정식 entry 는 *안 건드림*. (만약 orphan 이 알리아스 들고 있는 희귀 케이스라도 정식 entry 가 이미 alias 가지면 덮어쓰기 X 가 자연스러운 정책.)

## 빌드/실행 명령

```bash
# jest (492/492 확인됨)
npm test

# PC 카운터 배포 (영업 외 시간)
npm run deploy:web

# 폰 OTA
npx eas-cli update --branch production --message "..."
```

## 배포 기록

- main HEAD: `3e0ab21`
- deploy:web Version ID: `b5dfd64a-01d1-4d9b-a57a-26ba5a728135`
- eas update group: `40238e72-e4dd-44db-bb24-75a6bcb33cf0` (runtime 1.0.2, ios+android)
- jest: 492 / 492 (475 → 492, 신규 17)
