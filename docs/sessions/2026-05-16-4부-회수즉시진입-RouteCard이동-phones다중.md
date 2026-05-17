# 2026-05-16 (4부) — 회수 즉시 진입 fix + RouteCard 이동 + 백업복원 + phones 다중

## 한 줄 요약

영업 효율 / 데이터 안전성 / 손님 다중 phone 지원 4가지 작업: (1) 조리완료 회수 차수 안 잡히던 useMemo dep 누락 fix, (2) DeliveryRouteCard 를 주방 → 테이블 헤더 [배달지도] 옆 모달로 이동, (3) 주소록 JSON 백업/복원 (Export/Import), (4) 한 손님 휴대폰+일반전화 다중 phone 저장(phones array). 5 commit, jest 415/415 유지.

## 무엇이 바뀌었는가

| # | 사장님 요청 / 사고 | 핵심 답 | 커밋 |
|---|---|---|---|
| 1 | 조리완료 눌러도 회수 차수에 안 들어옴 | useMemo dep array 에 `orders` 누락 — `[orders, revenue, rounds, getReadyDeliveries]` 로 수정 | `31119c2` |
| 2 | 배달 경로 최적화 위치 — 주방화면 → 테이블 화면 | TableScreen 헤더 [배달지도] 옆 [🛵 배달경로] 버튼 + 모달. AddressBookModal 안전 패턴 (Pressable backdrop+sheet) | `1c8f791` |
| 3 | 주소록 백업/복구 필요 | [📤 백업] (JSON 다운로드) + [📥 복원] (파일 선택 → 병합/교체). utils/jsonBackup.web.js + .js stub | `bed3d50` |
| 4 | 같은 별칭/주소 손님 휴대폰+일반전화 2개 저장 가능해야 | entry.phones array 도입. 옛 phone 단일 호환 유지. CID/AI/표시 모두 phones 다중 매칭 | `dd6fd6c` |
| - | 원거리/근거리 정렬 점검 | jest 34/34 정상 — 'far' 내림차순 + 'near' 오름차순 + null unknown 분리 | — |

## 신규 파일

- `utils/jsonBackup.web.js` — `downloadJson` + `pickJsonFile` (Blob + `<input type=file>`)
- `utils/jsonBackup.js` — 폰 native stub (PC 카운터 사용 안내)

## 변경 파일 핵심

- `utils/addressBookLookup.js`
  - 신규: `getAllPhones / getPrimaryPhone / getAllPhoneDigits`
  - 확장: `formatDeliveryLabel({ alias, phones, phone, label }, ...)` — phones array 인자 지원
- `utils/useAddressBook.js` — 신규 `setPhones / addPhone / removePhone` + `setPhone` 도 phones[0] sync
- `utils/OrderContext.js` — provider value + fallback 노출
- `utils/recommendations.js` — `buildRegularKeySet` 의 phone 매칭이 `getAllPhoneDigits` 사용
- `utils/useCidHandler.web.js` — `phoneDigitsOf(e)` 가 phones + phone 모두 검색
- `screens/KitchenScreen.js` — DeliveryRouteCard 마운트 제거 (테이블 탭으로 이동)
- `screens/TableScreen.js` + `.styles.js` — `[🛵 배달경로]` 버튼 + 모달 + route* 스타일
- `screens/DeliveryReturnScreen.js` — useMemo dep 에 `orders` 추가 (조리완료 즉시 진입 fix)
- `components/AddressBookPanel.js` — `[📤 백업]` `[📥 복원]` 버튼 + 편집행 "전화 ①/②" 두 입력란 + 행 표시 두 번호 동시
- `components/AddressBookModal.js` — 검색이 phones 모두 검색
- `components/AddressChips.js` — dedup merge 시 phones union

## 데이터 모델 (호환)

```js
// 신규 entry (휴대폰 + 일반전화)
{ key, label, alias, phones: ['01012345678', '0512001234'], phone: '01012345678' }
//                          ↑ array (다중, set 진실)        ↑ phones[0] sync (옛 호환)

// 옛 entry (마이그레이션 없이 그대로 작동)
{ key, label, alias, phone: '01012345678' }
// read 헬퍼가 둘 다 흡수, write 시 자동으로 phones 도 함께 저장
```

## UI 흐름

### 같은 손님 다중 phone 등록
```
관리자 → 주소록 → "진실보석" 행 → ✏ 편집
   별칭     [진실보석]
   전화 ①  [010-1234-5678] (휴대폰)
   전화 ②  [051-200-1234 ] (일반전화)
   [저장]
```

### 행 표시
```
👤 진실보석
   부산 사하구 하신번영로 25
   ×5 ☎ 010-1234-5678 / 051-200-1234
```

### 백업/복원
```
관리자 → 주소록 헤더:
[+ 새 주소] [📤 백업] [📥 복원] [📦 75개 시드]
                ↓                  ↓
          JSON 다운로드        파일 선택
                           → 병합 또는 교체
```

### 배달 경로 최적화 (이동)
```
테이블 탭 헤더:
[자리이동] [합석] [단체] [🗺️ 배달지도] [🛵 배달경로]  ← 활성 배달 2건+ 시
                                            ↓
                                       모달 → DeliveryRouteCard
```

## 다음 세션 진입 가이드

```bash
git checkout main && git pull
git log --oneline -6
# dd6fd6c phones array 다중 phone
# bed3d50 백업/복원
# 1c8f791 배달경로 모달 이동
# 31119c2 회수 useMemo dep fix
# 85a2099 학습 노트
# 2a9c97c 3부 세션 노트

npm test                  # 415/415
npm run deploy:web        # 라이브 URL (영업 외 시간)
npx eas update --branch production --message "..."
```

## 핵심 기술 결정

1. **phones array + 옛 phone 호환** — 마이그레이션 없이 옛 entry 그대로 read. write 시 phones + phone[0] 같이 sync. 데이터 손실 위험 0.
2. **useMemo dep 누락은 React 가 자동 catch X** — eslint-plugin-react-hooks 같은 rules 권장. 다음 dep 변경 시 항상 검토.
3. **JSON 백업 Blob 다운로드** — 폰 native 는 안내만 (사용자가 PC 카운터에서 진행). 사용자 메모리 일관.
4. **DeliveryRouteCard 컴포넌트 재사용** — KitchenScreen → TableScreen 이동이 컴포넌트 prop 만 바꿔서 OK. 모달 wrapper 만 새로.
5. **백업이 phones array 변경보다 먼저 배포** — 사장님이 데이터 안전 우선 결정.

## 후속 작업 후보 (남은 것)

- **PC 영업 시간 자동화** — 옵션 A (절전 + 작업 스케줄러). 사장님 승인 후 진행.
- **AddressBookPanel 행 표시 — phones 3개 이상 케이스 검토** (현재 "/" 로 모두 한 줄. 좁으면 줄바꿈 옵션 검토)

## 빌드 / 실행 명령

```bash
npm test                                # 415/415
npm run web                             # dev preview 8082
npm run deploy:web                      # 라이브 URL
npx eas update --branch production      # 폰 OTA
```
