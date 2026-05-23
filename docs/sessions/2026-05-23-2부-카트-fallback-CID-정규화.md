# 2026-05-23 (2부) — 카트 fallback 부작용 fix + CID 전화번호 정규화

## 한 줄 요약

어제 cbb9c65(reducer 가드)가 증상은 막았지만 OrderScreen 의 fallback 이 살아있어 새 부작용 ("주문 후 -키 0까지 안 빠짐, 1로 남음") 을 만들던 문제를 카트 단일 진실 소스로 통일해 근본 차단 + CID 매칭의 +82 형식 미스 가능성 사전 차단.

## 무엇이 바뀌었는가

| Q | A |
|---|---|
| 사장님 신고 | "주문 후 테이블 누르고 주문 들어가면 카트 비어있고, -키 누르면 안 빠지고, 0까지 누르면 1로 남는다", "저장된 번호인데 왜 안 떠 이거 몇번말하는데" |
| 카트 버그 진짜 원인 | [screens/OrderScreen.js:437](../../screens/OrderScreen.js) 의 `cart = (cartItems.length>0) ? cartItems : items` 가 -키로 cartItems 가 [] 되면 items 의 원본 qty 를 다시 표시 → 사장님 입장 "변경 무효" |
| 카트 처방 | cartItems 단일 진실 소스 + 진입 시 `useEffect` 가 `hydrateCartFromItems` 1회 호출 (ref 가드로 tableId 별 1회만 — 사장님이 -로 비운 직후 자동 복원되지 않게) |
| CID 의심 원인 | entry 가 `+82-10-...` / `821012345678` 형식 저장 시 LG U+ sender (`010...`) 와 digits 길이 불일치 → Array.includes 실패 → 매칭 누락 |
| CID 처방 | `normalizePhoneDigits` 추가 — 한국 국가코드 82 prefix 흡수해 0 으로 변환. sender + entry 양쪽 모두 같은 함수 통과. Firestore `incomingCall` 문서에 `debugDigits` / `debugEntryCount` 진단 필드 박음 |
| 회귀 안전망 | jest 475/475 통과 (orderReducer 77/77 — hydrateCartFromItems 케이스 5건 신규 포함, 사장님 시나리오 그대로) |

## 신규/변경 파일

| 파일 | 변경 |
|---|---|
| [utils/orderReducer.js](../../utils/orderReducer.js) | 새 액션 `orders/hydrateCartFromItems` — cartItems=[]&&items.length>0 일 때만 items 카피 |
| [utils/OrderContext.js](../../utils/OrderContext.js) | `hydrateCartFromItems` wrapper + ORDERS_FALLBACK 노출 |
| [screens/OrderScreen.js](../../screens/OrderScreen.js) | useOrders 에서 `hydrateCartFromItems` 추출 + useEffect (ref 가드) + line-437 fallback 제거 |
| [__tests__/orderReducer.test.js](../../__tests__/orderReducer.test.js) | 회귀 테스트 5건 — `cartItems=[] && items` / 이미 채워진 케이스 / items 없음 / 없는 tableId / **사장님 시나리오 (진입 hydrate → -키 2회 → cart 비고 items 그대로)** |
| [utils/useCidHandler.web.js](../../utils/useCidHandler.web.js) | `normalizePhoneDigits` 함수 + `phoneDigitsOf` 통과 + Firestore 진단 필드 |

## 알려진 문제 / 미해결 이슈

- **CID 매칭 실패 원인이 +82 형식이 아닐 수도** — 다른 가능 원인 3가지 (B/C/D) 는 *현장 데이터* 봐야 식별. 다음 미스 발생 시 Firebase Console 에서 `stores/{sid}/state/incomingCall.debugDigits` 직접 확인 → 그 값과 주소록 entry.phone/phones 비교 → 어디서 어긋났나 즉시 식별.
- **deploy 미실행** — 사장님 "테스트는 내가 해볼게" 명령으로 git 저장만. 사장님이 PC 카운터 라이브 URL 또는 폰에서 검증 후 결정 (`npm run deploy:web` / `eas update --branch production`).
- **별관 워크트리 5개 누적** — keen-gagarin-9054c5 외에 crazy-pare-6abae5, fervent-bartik-5cb484, gallant-kowalevski-d8c457, magical-antonelli-01f134, zen-lalande-80c0e6. 세션 마무리 시 정리 필요.

## 다음 세션 진입 가이드

```bash
# 현재 main 헤더
git -C C:/MyProjects/MyPos_SDK54 log --oneline -3
# d244c44 fix(cid): 전화번호 정규화 — entry 가 +82 형식 저장 시 매칭 누락 차단
# 29b5f17 fix(order): 카트 fallback 부작용 — "변경 누르면 리셋 / -키 0까지 안 빠짐" 근본 처방
# ebef669 Merge branch 'main' of https://github.com/overson76/MyPos_SDK54

# jest 회귀 검증
npx jest
# Tests: 475 passed, 475 total

# 사장님 검증 후 정식 배포 결정 시:
npm run deploy:web                       # PC 카운터 즉시 적용
eas update --branch production --message "카트/CID fix"  # 폰 OTA (순차 — 동시 금지)
```

## 핵심 기술 결정

### 1. **cartItems 단일 진실 소스** vs **fallback 유지**

cbb9c65 의 reducer 가드는 *cart=[] 인 채로 confirm 호출 시 items 통째 교체* 만 막았음. 하지만 화면 표시 (line-437) 가 *cartItems=[] 면 items 보여줌* 이라 -키로 0 까지 비우면 *items 의 원본 qty 가 다시* 보임 → 사장님 입장 "변경 무효". 처방을 *표시 fallback 제거 + 진입 hydrate effect* 로 통일해 cartItems 가 단일 진실 소스. 이렇게 하면 사장님이 -로 비우면 *진짜로* 화면 텅 (의도된 결과 — "변경" 버튼은 cart=[] 시 disabled 라 사고 X).

### 2. **ref 가드** 로 사용자 -키 무효화 방지

useEffect deps `[tableId, cartLen, itemsLen, hydrateCartFromItems]` — 사장님이 -로 비우면 cartLen=0 → effect 재트리거 → ref 가드 (`lastHydratedTableRef.current === tableId`) 가 차단 → hydrate 안 함 → cart=[] 유지. 다른 테이블로 갔다 다시 돌아오면 ref 리셋 후 1회 다시 hydrate.

### 3. **CID 정규화는 +82 만** — tail 매칭 X

+82 흡수가 가장 명확한 fix. tail 매칭 (끝 8자리 일치) 은 *오탐 위험* (다른 손님과 끝 4자리 같으면 곤란) — 다음 미스 발생 후 `debugDigits` 진단 데이터 봐서 어떤 매칭 정책이 더 필요한지 판단.

### 4. **분리 커밋 2개** — 다른 도메인

카트 fix 와 CID fix 는 다른 시스템. 회귀 또는 rollback 시 독립적으로 처리하려면 분리 커밋 필수.

## 빌드/실행 명령

```bash
# 로컬 검증
npm test                   # jest 475/475
npm start                  # Expo Dev (폰 검증)
npx expo start --web       # 웹 검증

# 정식 배포 (사장님 명령 후)
npm run deploy:web         # PC 카운터
eas update --branch production --message "카트/CID fix"  # 폰 OTA
```

## 커밋

- 29b5f17 `fix(order): 카트 fallback 부작용 — "변경 누르면 리셋 / -키 0까지 안 빠짐" 근본 처방`
- d244c44 `fix(cid): 전화번호 정규화 — entry 가 +82 형식 저장 시 매칭 누락 차단`
