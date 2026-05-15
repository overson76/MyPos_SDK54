# 2026-05-15 2부 — 주문/CID/NSIS/UX/카트사라짐 진짜 fix (1.0.47-51)

## 한 줄 요약

오전 1부 (LG U+ Webhook 매장 PC 도달 완성) 후 사장님 실사용 요청 누적 10개 — 한 세션 안에서 1.0.47, 1.0.48, 1.0.49, 1.0.50 네 번 빌드. **미선택+카트+"주문" → 배달 1~5 자동 배당**, **CID "주문받기" → PENDING 주소/전화 자동 박힘**, **CID 단골 15초 무응답 → 자동 배달 슬롯 (메뉴 대기)**, **포장/예약 카드 시간 표기**, **NSIS 덮어쓰기 fix** (매번 삭제+재설치 졸업), **배달 카드 별칭 우선** (`👤 진실보석` ← `📍 사하구 사하로...`), **일반 창 + 자동 최대화** (창 내리기 자유), **주소록 빠른 선택 3가지 검색** (주소/별칭/전화 OR). 폰 OTA push 2회 (1.0.48, 1.0.50) — 폰/직원폰 다음 시작 시 새 흐름 자동.

## 무엇이 바뀌었는가 (Q&A)

| Q | A |
|---|---|
| 사장님이 미선택 상태로 메뉴 담고 "주문" 누르면? | 빈 배달 슬롯(d1~d5 순서) 자동 배당 + cart 옮김 + 확정. 모두 차있으면 d6, d7 동적 확장. |
| CID "주문받기" 누르면 발신번호/주소/별칭은? | PENDING_TABLE_ID 의 deliveryAddress/Phone/Alias 에 미리 박힘. 사장님이 메뉴 추가 후 "주문" 누를 때 submitPendingAsDelivery 가 그 정보 그대로 배달 슬롯으로 옮김. |
| 단골 전화 왔는데 사장님이 15초 안에 못 누르면? | 매장 PC 가 자동으로 빈 배달 슬롯 생성 (주소·전화·별칭만, cart 비어있음). 주방 안 올라감. 사장님이 나중에 메뉴 추가 + "주문" 누를 때 그때 주방 등록. |
| 단골 자동 배달의 충돌 방지? | 매장 PC (Electron) 만 처리 (`window.mypos?.isElectron` 가드) + ts 기반 dedupe + 사용자 누르면 ref 업데이트로 effect 차단. |
| 신규 손님(phone-only)도 자동 등록? | NO. `isRegular = alias 있거나 (address 있고 !isNewNumber)` 조건. 신규는 정보 없으니 사장님이 명시 처리. |
| 예약/포장 시간은 어디 표시? | 테이블 카드에 `📅 오후 6:30` (예약) / `📦 오후 7:00` (포장). 영수증은 1.0.44 분기 이미 적용. |
| NSIS 덮어쓰기 안 되던 원인? | 1.0.11~1.0.46 의 `oneClick: true` silent install + 1.0.45 락 + customInit 2초 종료시간 부족 = 인스톨러 silent fail. 사장님 매번 수동 삭제+재설치 패턴. **1.0.47 부터 `oneClick: false` + `Sleep 5000` + `runAfterFinish: true` 로 fix**. |
| 카트 사라짐 버그? | 사장님 정확한 재현 시나리오 확인 필요 (가설 3개: 사이즈 prompt 외부 클릭, migratePendingCart 의도된 동작 인식 오류, 그 외). 1.0.48 매장 PC 설치 후 테스트하면서 정확한 단계 알려주시기로. |
| 일요일 영업? | 휴무. PC ON/OFF 안내 / 운영시간 자동화 시 일요일 제외 (`reference_store_hours.md`). |

## 흐름 다이어그램

### 시나리오 A: 일반 미선택 → 배달 자동

```
[주문 탭 진입, 미선택 상태]
   ↓ 메뉴 클릭
[PENDING_TABLE_ID 에 cart 담김]
   ↓ "주문" 버튼
[submitPendingAsDelivery({ deliveryAddress, deliveryPhone, deliveryAlias })]
   ↓ findEmptyDeliverySlot → d1 (또는 빈 슬롯)
[migratePendingCart(d1) + setDeliveryAddress + setDeliveryContact]
   ↓
[playOrderSound + speakOrder]
   ↓
[setTimeout(confirmOrder(d1), 0)]  ← migrate dispatch 비동기 보장
   ↓
[테이블 탭 배달1 카드: 메뉴 + 주소 + 거리]
[주방(KitchenScreen) 등록 ✅]
```

### 시나리오 B: CID 즉시 "주문받기"

```
[전화 옴 — 모든 기기 팝업 15초]
   ↓ 사장님 [주문받기] 클릭
[autoDeliveryProcessedRef = call.ts]  ← 자동 effect 차단
[setDeliveryAddress(PENDING, address) + setDeliveryContact(PENDING, phone, alias)]
[handleTabPress('주문')]
   ↓ 사장님이 메뉴 추가
[PENDING cart 채워짐]
   ↓ "주문" 버튼
[submitPendingAsDelivery] → 시나리오 A 와 동일
```

### 시나리오 C: CID 단골 15초 무응답 (1.0.48 신규)

```
[단골 전화 옴 — 매장 PC 화면 + 모든 기기 팝업]
   ↓ 15초 카운트다운, 사장님 못 누름
[App.js 의 setTimeout(15_000) 발화]
   ↓ 매장 PC 만 (isElectron 가드)
   ↓ 단골 판정 통과 (alias 또는 address && !isNewNumber)
[submitPendingAsDelivery({ deliveryAddress, deliveryPhone, deliveryAlias })]
   ↓ findEmptyDeliverySlot → d1 (빈 슬롯)
[migratePendingCart(d1) — 단 PENDING cart 가 비어있어서 noop]
[setDeliveryAddress + setDeliveryContact]
   ↓
[테이블 탭 배달1 카드: 메뉴 없음, 주소·전화만 표시. "메뉴 대기" 상태]
[confirmOrder X → 주방 미등록]
   ↓ 사장님 통화 끝 + 메모지 보고 메뉴 추가
   ↓ "주문" 버튼
[confirmOrder(d1) → 주방 등록]
```

## 신규/변경 파일

| 종류 | 파일 | 비고 |
|---|---|---|
| 수정 | `utils/useIncomingCall.web.js` | CUTOFF_MS 10→15, 자동닫힘 8→15초 |
| 수정 | `components/IncomingCallBanner.js` | 카드/폰트 한 단계 크게 (number 17→22, address 13→17, padding 12→16, minWidth 300→380, icon 24→32) |
| 수정 | `utils/orderHelpers.js` | `findEmptyDeliverySlot(orders)` 신설 — d1~d5 순서로 빈 슬롯, 모두 차있으면 d6+ 동적 |
| 수정 | `utils/OrderContext.js` | `submitPendingAsDelivery(opts)` + `setDeliveryContact(tableId, {phone, alias})` 헬퍼. noop fallback 도 업데이트 |
| 수정 | `utils/orderReducer.js` | `orders/setDeliveryContact` 액션 — phone/alias 박기 + sanitize |
| 수정 | `screens/OrderScreen.js` | 미선택 + cart > 0 + "주문" → submitPendingAsDelivery → confirmOrder + speak + onBack |
| 수정 | `screens/TableScreen.js` | 예약/포장 카드에 `📅 오후 H:MM` / `📦 오후 H:MM` (formatShort12h) |
| 수정 | `App.js` | CID 주문받기 → PENDING 박음 + autoDeliveryProcessedRef. 1.0.48: setTimeout 15초 단골 자동 배달 (isElectron 가드 + ts dedupe). useRef import 추가 |
| 수정 | `electron/builder.config.js` | NSIS oneClick true→false + allowElevation + runAfterFinish:true (1.0.47) |
| 수정 | `electron/build/installer.nsh` | Sleep 2000→5000 (customInit) / 1000→3000 (customInstall) |
| 수정 | `package.json` | 1.0.46 → 1.0.47 → 1.0.48 |
| 신규 | `~/.claude/.../memory/reference_store_hours.md` | 영업 정책 — 일요일 휴무, 10:30~20:00 |
| 신규 | `docs/sessions/2026-05-15-2부-...md` | 본 세션 노트 |

## 알려진 문제 / 미해결 이슈

1. **카트 사라짐 버그 (2번)** — 사장님 정확한 재현 시나리오 미확보. 1.0.48 매장 PC 설치 후 사장님이 평소 패턴 재현하면서 어느 단계에서 사라지는지 알려주시기로.
2. **단골 자동 배달의 충돌 가능성** — 매장 PC 만 처리하지만, 매장 PC 가 잠시 네트워크 불안할 때 두 번 처리 가능성 매우 낮지만 비제로. Firestore 의 single-writer 패턴 보강 향후 필요.
3. **단골 자동 배달의 UI 안내 미완성** — 자동으로 생성된 배달 슬롯에 "(자동 생성 — 메뉴 미입력)" 같은 배지 표시 X. 1.0.49 에서 시각화 추가 권장.

## 다음 세션 진입 가이드

```powershell
# 매장 PC (영업 종료 20시 이후)

# 1) 기존 1.0.46 제거 (NSIS 덮어쓰기 fix 가 1.0.48 부터 활성)
#    제어판 → 앱 → MyPos → 제거

# 2) 새 .exe 다운로드 + 더블클릭
#    https://github.com/overson76/MyPos_SDK54/releases/latest
#    MyPos-Setup-1.0.48-x64.exe

# 3) NSIS UI 마법사 ("다음 → 설치") → 자동 실행 (runAfterFinish)

# 4) 매장 가입 PIN 또는 lastStore 복구 카드

# 5) 진단 카드 → 버전 1.0.48 확인 + 모든 줄 ✅

# 6) 시나리오 A/B/C 검증 (위 다이어그램)

# 7) 다음 1.0.49 부터는 Setup.exe 더블클릭 한 번에 덮어쓰기 — 삭제 단계 X
```

폰 OTA: 사장님/직원 폰 다음 앱 시작 시 캐시된 옛 거 즉시 적용 + 새 거 백그라운드 다운로드 → 그 다음 시작 시 1.0.48 적용. **영업 중 갑작스러운 새로고침 X**.

## 핵심 기술 결정

- **submitPendingAsDelivery 단일 함수 통합** — 미선택+cart, CID 즉시, CID 단골 자동 모두 같은 함수. 빈 cart 도 migratePendingCart 가 noop 처리.
- **autoDeliveryProcessedRef + ts dedupe** — 사용자가 "주문받기" 누른 경우 ref 업데이트로 setTimeout 콜백 차단. 같은 incomingCall ts 가 두 번 처리되지 않게.
- **window.mypos?.isElectron 가드** — 폰/태블릿 자동 배달 X. 매장 PC 단일 게이트웨이 정책 일관.
- **단골 판정 보수적** — alias 또는 (address && !isNewNumber). 신규 phone-only 손님은 자동 등록 X. 손님 정보 모른 채 배달 슬롯 만들면 혼란.
- **NSIS oneClick: false** — 1.0.11 의 silent fail 회피 fix 가 사실 사장님 매번 삭제+재설치 패턴의 원흉. UI 표시 + Sleep 5000 으로 정상 흐름 복원.

## 빌드/실행/배포

```powershell
# 빌드 + GitHub Releases publish
Set-Location C:\MyProjects\MyPos_SDK54
npx electron-builder --config electron/builder.config.js --publish always

# 폰 OTA (영업 영향 X)
npx eas update --branch production --message "..."

# Cloudflare 라이브 URL (영업 종료 후만)
npm run deploy:web
```

## 커밋

| 커밋 | 내용 |
|---|---|
| `ce05673` | feat(order+cid+nsis): 1.0.47-48 — 미선택 배달 자동/CID 단골 자동/포장·예약 시간/NSIS 덮어쓰기 fix |
| `c32daf1` | docs(sessions): 2026-05-15 2부 세션 노트 |
| `c083df5` | feat(ux): 1.0.49-50 — 배달 카드 별칭 우선 + 일반 창 자동 최대화 + 주소록 3가지 검색 |
| `8106091` | docs(sessions): 1.0.49-50 한 세션 네 빌드 통합 |
| `87a78c1` | fix(orders): 1.0.51 — 카트 사라짐 진짜 fix + 배달 카드 alias→phone→addr |

## 1.0.51 — 카트 사라짐 진짜 원인 (사장님 누적 보고 해결)

3 세션 누적 미해결이었던 "테이블 선택 없이 메뉴 담으면 카트가 계속 지워짐" 의 진짜 원인:

`useOrderFirestoreSync.js` 의 orders onSnapshot 콜백:
```js
const unsubOrders = storeRef.collection('orders').onSnapshot((snap) => {
  const next = {};
  snap.docs.forEach((d) => { next[d.id] = d.data(); });
  dispatch({ type: 'orders/hydrate', payload: next });  // ← 매번 통째 교체!
  ...
});
```

`orderReducer` 의 hydrate 케이스:
```js
case 'orders/hydrate': {
  return action.payload && typeof action.payload === 'object'
    ? action.payload   // ← Firestore payload 로 통째 교체. PENDING 없음 → 사라짐!
    : state;
}
```

**Firestore 에는 PENDING_TABLE_ID 문서가 없으므로** (write 시점에 명시 제외 안 되어 있었지만, write 자체가 디바운스라 짧은 순간 read 후 write 순서), onSnapshot 콜백이 매번 발화할 때 local 의 PENDING cart 가 통째 사라짐.

**1.0.51 처방 2개:**
1. `orders/hydrate` reducer 가 state 의 PENDING_TABLE_ID 를 보존 (local-only 정책).
2. `useOrderFirestoreSync` 의 write/delete 흐름에서 PENDING_TABLE_ID 명시 제외 (클라우드에 미선택 cart 가 남는 보안 이슈도 함께 해결).

## 매장 PC / 폰 / 태블릿 모든 기기 적용 흐름

| 기기 | 적용 방법 |
|---|---|
| 매장 PC (.exe) | `deploy:web` 후 사장님이 **MyPos 종료 → 재실행** 한 번. .exe 재설치 X. 라이브 URL 부터 로드라 즉시 새 코드. |
| 폰 / 태블릿 (Expo OTA) | `eas update --branch production` push 후 다음 앱 시작 시 캐시된 옛 거 즉시 + 새 거 백그라운드 → 그 다음 시작 시 적용. **영업 중 갑작스러운 새로고침 X**. |
| 라이브 URL 직접 접속 사용자 | `deploy:web` 즉시 — F5 한 번. |

## 배포 채널 통합 (1.0.51 끝나는 시점)

| 채널 | 1.0.51 상태 |
|---|---|
| GitHub Releases | ✅ v1.0.51 (Setup.exe + portable.exe) |
| 폰 OTA (EAS Update) | ✅ production push |
| Cloudflare 라이브 URL | ✅ deploy:web (Version 4a824f41) |
| main push | ✅ deploy:web 끝나면 |

## 다음 체크리스트

- [x] 1.0.48 빌드 + GitHub Releases publish (Setup.exe + portable.exe)
- [x] 폰 OTA push (production, Runtime 1.0.2, group 1b767bb2)
- [x] main push (3e4e9e7..ce05673)
- [ ] 매장 PC 1.0.48 설치 (20시 영업 종료 후)
- [ ] 시나리오 A/B/C 사장님 검증
- [ ] 카트 사라짐 (2번) 정확한 재현 시나리오 확보
- [ ] **1.0.49**: 자동 생성 배달 슬롯에 시각 배지 ("자동 생성 — 메뉴 미입력")
- [ ] **1.0.49**: 카트 사라짐 버그 fix (재현 시나리오 받은 후)
- [ ] 향후: 폰 / 직원 폰 자동 배달 (Firestore single-writer 패턴)
