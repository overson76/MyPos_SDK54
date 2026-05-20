# 2026-05-21 — 전화 주문 흐름 통합 (OrderTypePicker) + 영수증 라벨 단일화

## 한 줄 요약

배달뿐 아니라 포장/예약도 전화로 오는 매장 현실 반영 — 메뉴 담은 후 사장님이 배달/포장/예약 직접 선택하는 `OrderTypePicker` 모달 도입 + CID 알림은 주문 확정 시점까지 유지 + 영수증 라벨에서 "배달지 " prefix 제거 후 별칭/전번/주소 한 줄 통일.

## 무엇이 바뀌었는가 — Q&A

| 사장님 요청 | 핵심 결정/구현 |
|---|---|
| CID 발신자 정보 15초 후 자동 사라짐 → 메뉴 누르면 사라지게 | `subscribeConfirmed` 로 confirm 신호 구독 → `dismissIncomingCall()` 호출. ✕ 버튼도 진짜 dismiss 로 연결 |
| 영수증 "배달지 <<" prefix 빼고 별칭만 — 없으면 전번/주소 순 | `resolveDeliveryLabel(r)` 헬퍼 — 별칭>전번(포맷팅)>주소 단일 라벨. "배달지/별칭/손님" 3줄 → 한 줄 |
| 15초 자동 해제도 없애기 (메뉴 담는 중 누구 주문인지 잃어버림) | `useIncomingCall.web.js` 의 자동 시간 해제 useEffect 완전 제거. 명시적 액션(주문 확정/✕/새 착신)만 dismiss |
| 예약/포장 테이블도 단골 적용 + 별칭이 테이블에 노출 | 카드 별칭 라벨을 비-regular 모든 type 확장 + 영수증 reservation/takeout 분기에도 단일 라벨 + submitPendingAsType 일반화 |
| CID 자동 단골 default 종류 변경 — 메뉴 후 "주문" 누르면 배달/포장/예약 3옵션 모달 | `OrderTypePicker` 신규 + 옛 1.0.48 자동 배달 effect *완전 제거* + 사장님 직접 선택 흐름으로 일원화 |

## 신규/변경 파일

| 파일 | 변경 |
|---|---|
| **신규** `components/OrderTypePicker.js` | 배달/포장/예약 3옵션 absolute overlay 모달 (PaymentMethodPicker 패턴) |
| `utils/orderHelpers.js` | `findEmptySlotForType(orders, type)` 일반화 (d/y/p prefix + 정적 카운트 + 동적 확장). `findEmptyDeliverySlot` 은 wrapper |
| `utils/OrderContext.js` | `submitPendingAsType(type, opts)` 일반화. value/fallback 에 노출 |
| `screens/OrderScreen.js` | PENDING + cart + "주문" → `setTypePickerOpen(true)`. picker.onSelect → submitPendingAsType + confirm + onBack |
| `screens/TableScreen.js` | 별칭 라벨 계산 (`deliveryPrimary`) 을 비-regular 모든 type 으로 확장. 예약/포장 카드에도 라인 렌더링 |
| `utils/escposBuilder.js` | (1) `resolveDeliveryLabel` 헬퍼 신규 — 별칭>전번>주소. (2) delivery 분기 3줄 → 1줄. (3) reservation/takeout 분기에도 라벨 한 줄 추가. (4) 주방슬립도 단일 라벨 (dead code 정책 일관성) |
| `utils/useIncomingCall.web.js` | 반환 시그니처 `{ call, dismiss }`. 15초 자동 setCall(null) useEffect 제거. CUTOFF_MS → STALE_AGE_MS (의도 명확) |
| `utils/useIncomingCall.js` | native no-op 도 동일 시그니처 |
| `App.js` | CID dismiss 연결 (subscribeConfirmed). ✕ 진짜 dismiss. **옛 1.0.48 자동 단골 배달 effect 완전 제거** + 미사용 `useRef`/`submitPendingAsDelivery` import 정리 |
| `__tests__/orderHelpers.test.js` | findEmptySlotForType 11 신규 케이스 |
| `__tests__/escposBuilder.test.js` | 단일 라벨 5 + 예약/포장 라벨 4 신규 (총 +15) |

## 알려진 문제 / 미해결 이슈

- **buildOrderSlipText 호출처 0개** — dead code. 사장님이 향후 슬립 자동 출력 활성화 시 reservation/takeout type 정보 받도록 시그니처 확장 필요 (현재는 isDelivery boolean).
- **예약/포장 슬롯의 주소록 lookup 미지원** — 주소록이 *주소 key* 기반이라 예약/포장은 order.deliveryAlias/Phone 만 표시. 향후 phone-based 주소록 lookup 추가하면 *주소 없는 단골* 자동 식별 가능.
- **OrderScreen 배달 헤더 UI** — `table?.type === 'delivery'` 분기는 변경 안 함 (AddressBookModal 등 배달 전용 UI). 예약/포장에서 phone/alias *입력 UI* 는 추후 보강. 현재는 CID PENDING transfer 흐름으로만 박힘.

## 다음 세션 진입 가이드

```bash
git checkout main
git pull --ff-only
# 또는 작업 별관 진입:
cd .claude/worktrees/crazy-pare-6abae5

# 실행
npm install
npm start          # Expo Dev
npm run web        # 웹 미리보기
npm test           # 단위 테스트 (현재 432 통과)

# 배포 (영업 외 시간만)
npm run deploy:web                                  # 매장 PC 라이브 URL 갱신
eas update --branch production --message "..."      # 폰 OTA
```

## 핵심 기술 결정 — 왜 이렇게 했나

### 1. `submitPendingAsDelivery` → `submitPendingAsType(type, opts)` 일반화

옛 패턴은 *배달 슬롯 자동 배당* 만. 포장/예약은 사장님이 직접 슬롯 선택 + 메뉴 입력 + 옮기는 *수동* 흐름. 사장님 메모리 "초보자 대응" + 전화 주문 빈도 (배달뿐 아니라 포장/예약도 다수) 고려 — 모든 전화 주문 종류를 *같은 자동 흐름* 으로 통합.

`findEmptySlotForType(orders, type)` 는 `TYPE_PREFIX` 매핑(d/y/p) + `TYPE_STATIC_COUNT` (5/2/2) + 동적 확장 — `findEmptyDeliverySlot` 의 로직 그대로 prefix 일반화. 호환 wrapper 유지.

### 2. `OrderTypePicker` 모달 패턴

PaymentMethodPicker 와 동일한 *absolute overlay* (iOS new arch `<Modal>` 호환 이슈 회피 — 메모리 `project_modal_native_crash.md` 영구 처방). 3 큰 버튼 + 색상 일치 (`tableTypeColors`) + 옵션별 hint (예: "d1~d5 자동 배당").

매장(regular) 테이블은 *처음부터 사장님이 직접 선택* 하는 정상 흐름이라 옵션에서 제외. PENDING + cart "주문" 은 *전화 주문* 패턴.

### 3. CID 자동 시간 해제 *제거*

옛 정책 (15초 후 setCall(null)) 이 새 정책 ("주문 확정 시 dismiss") 와 정면 충돌. 사장님이 메뉴 한참 담는 중 알림 사라지면 누구 주문인지 잃음. 명시적 액션(주문 확정/✕/새 착신으로 덮임) 외에는 알림 *계속 유지*.

`STALE_AGE_MS` (앱 부팅 시 옛 incomingCall 문서 차단) 만 별개로 유지 — *자동 사라짐* 과 무관.

### 4. 영수증/주방슬립 라벨 prefix 제거

옛: "배달지 부산 사하구..." + "별칭 김씨네 아파트" + "손님 010-1234-5678" 3줄. 새: "김씨네 아파트" 1줄 (별칭이 가장 우선이라). 라이더가 받을 영수증/주방슬립은 *손님 식별* 만 명확하면 충분. 주소는 사장님 별칭→주소 매핑으로 알고, 라이더는 별칭 호명. 예약/포장도 동일 — 시각 정보는 그대로 유지.

### 5. 옛 1.0.48 자동 단골 배달 effect *완전 제거*

CID 15초 후 자동 배달 슬롯 생성 — 손님이 *포장/예약* 원할 때 잘못된 배달 슬롯에 박는 위험. 사장님 직접 선택 흐름 (OrderTypePicker) 이 모든 종류 정확히 처리.

부수 효과 — `autoDeliveryProcessedRef.current` 호출부 모두 제거 필요 (dead ref crash 위험). App.js 의 onOrderPress 핸들러도 동시에 정리.

## 빌드/실행 명령

```bash
# 테스트
npm test

# 매장 PC 라이브 URL 배포 (영업 외 시간만, 일요일 휴무 + 평일 10:30~20:00)
npm run deploy:web

# 폰 OTA (production)
eas update --branch production --message "전화 주문 흐름 통합 + 영수증 라벨 단일화"

# Electron .exe 빌드 (필요 시)
npm run electron:build
```

## 운영 효과

1. **CID 알림이 메뉴 담는 동안 계속 떠있음** → 누구 주문인지 상시 확인. 더블체크 가능.
2. **포장/예약 손님도 단골 별칭으로 식별** → 영수증/카드/주방슬립 모두 별칭 우선.
3. **영수증의 "배달지 " 라벨 제거** → 깔끔한 단일 라벨, 사장님 정책 통일.
4. **자동 배달 실수 차단** — 포장/예약 손님이 잘못 배달 슬롯에 박히는 사고 영구 차단.
5. **확장성** — submitPendingAsType / findEmptySlotForType 일반화로 향후 새 주문 종류 추가 용이.

## 검증

- jest: 18 suites / **432 tests** 통과 (+15 신규)
- 실 환경 검증 — 본 세션에서 deploy:web + eas update 까지 진행 (영업 외 시간 새벽 1시).
