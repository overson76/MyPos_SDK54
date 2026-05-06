# Undo / 되돌리기 — history append-only + reverted 플래그 패턴

날짜: 2026-05-07  
주제: 매출 history 처럼 **append-only 가 강제된 데이터** 에서 "되돌리기" 를 어떻게 안전하게 구현하는가.

---

## 출발점 — 두 가지 후보

매장 사장님 요청: "결제완료 / 조리완료를 실수로 눌렀을 때 되돌리기. 단 히스토리는 남아 있어야."

설계 옵션:

| 옵션 | 동작 | 장점 | 단점 |
|---|---|---|---|
| **A. delete + recreate** | history entry 삭제 + 테이블 다시 만듦 | 합계 자동 정정 | 이력 흔적 사라짐. 회계 사무소 송부 시 "원래 있었지만 취소됨" 알 길 없음 |
| **B. reverted 플래그** | entry 보존 + `reverted: true` 마킹 + 합계에서 제외 | 흔적 보존 + 합계 정정 둘 다 | 모든 집계 함수가 reverted 검사해야 — 한 곳 빠뜨리면 잘못된 합계 |

선택: **B**. 회계 / 매출 신고는 "어떤 거래가 어떤 시점에 취소됐는가" 를 추적할 수 있어야 안전. delete 는 사고 후 분석을 막음.

---

## 핵심 패턴

### 1. entry 자체는 절대 수정 안 함 (immutable append)

```js
// utils/orderHelpers.js
export function markHistoryReverted(prev, entryId) {
  const idx = (prev.history || []).findIndex((e) => e.id === entryId);
  if (idx < 0) return prev;
  const target = prev.history[idx];
  if (target.reverted) return prev;             // 이미 되돌렸으면 idempotent
  const nextHistory = prev.history.slice();
  nextHistory[idx] = { ...target, reverted: true, revertedAt: Date.now() };
  return {
    total: Math.max(0, prev.total - (Number(target.total) || 0)),
    history: nextHistory,
  };
}
```

핵심:
- `reverted: true` + `revertedAt` 만 박음. items / total / paymentMethod / clearedAt 모두 그대로.
- `revenue.total` 에서 `entry.total` 차감 (음수 방지 위해 `Math.max(0, ...)`).
- 이미 reverted 면 그대로 반환 — **중복 차감 방지 idempotent**.

### 2. 모든 집계 함수가 한 줄 가드

```js
// utils/payment.js
function isCounted(entry) { return !!entry && !entry.reverted; }

export function summarizeByPaymentMethod(history) {
  // ...
  for (const entry of history || []) {
    if (!isCounted(entry)) continue;            // ← 가드 한 줄
    // 정상 집계
  }
}
```

`summarizeDaily` / `summarizeMonthly` / `summarizeByPaymentMethod` / `historyToCsv` 4곳 다 같은 가드. **한 함수 빠뜨리면 매출 합계 ↔ CSV ↔ 카드 표시 전부 어긋남** — 단위 테스트로 4곳 모두 검증해야 신뢰 가능.

### 3. CSV 는 행 보존 + 합계 0 + "되돌림" 컬럼

```js
const isReverted = !!entry.reverted;
const total = isReverted ? 0 : (entry.total || 0);
const { supply, vat } = splitVatIncluded(total);
rows.push([
  when, tableId, itemsText, paymentLabel, paymentStatus, deliveryAddr,
  String(total), String(supply), String(vat),
  isReverted ? `Y(${formatDt(entry.revertedAt)})` : '',
]);
```

회계 사무소 송부 시 "비빔밥 2만원 — 되돌림 Y(14:00)" 같은 행이 보임. delete 했으면 회계 사무소가 "왜 합계가 안 맞지?" 라고 못 물음.

### 4. 부활 (테이블 복원) — 충돌 가드

```js
// utils/OrderContext.js
const revertHistoryEntry = (entryId) => {
  const entry = findHistoryEntry(revenue?.history, entryId);
  if (!entry) return { ok: false, reason: 'notFound' };
  if (entry.reverted) return { ok: false, reason: 'alreadyReverted' };
  if (orders[entry.tableId]) return { ok: false, reason: 'occupied' };  // ← 새 주문 있으면 거부
  dispatch({ type: 'orders/restoreFromHistory', tableId: entry.tableId, entry });
  setRevenue((prev) => markHistoryReverted(prev, entryId));
  return { ok: true };
};
```

핵심: **이미 같은 tableId 에 새 주문이 있으면 거부**. 결제 후 다른 손님이 그 테이블을 받았는데 옛 주문이 덮어쓰면 데이터 손실.

reducer 도 한 번 더 가드 (이중 안전):
```js
case 'orders/restoreFromHistory': {
  if (state[tableId]) return state;            // wrapper 가 검사하지만 reducer 도 안전
  // 복원
}
```

### 5. 조리완료 — append 흔적 없는 단순 토글

조리완료 (`markReady`) 는 history 에 안 들어감 (테이블 살아있는 채 status 만 변경). 그래서 `reverted` 플래그 X — 그냥 status 를 다시 'preparing' 으로 토글하면 끝.

```js
case 'orders/undoMarkReady': {
  const nextItems = state[tableId].items.map((i) => {
    const { cookStateNormal, cookStateLarge, ...rest } = i;
    return { ...rest, cookState: 'cooking', cooked: false };
  });
  return { ...state, [tableId]: { ...state[tableId], status: 'preparing', items: nextItems, readyAt: null } };
}
```

UI 측에서 KitchenScreen 의 `o.status !== 'ready'` 필터에 다시 통과되면서 자동으로 주문현황 메인 그리드에 복귀 — **새 dispatch 없이 동일 selector 가 재계산**해서 자연스럽게 부활.

---

## 데스크톱 개발 비유

C# / .NET 으로 매핑하면:

| 이 패턴 | C# 비유 |
|---|---|
| history = append-only 배열 | `IReadOnlyList<TransactionLog>` 같은 immutable 회계 원장 |
| reverted 플래그 | DB 의 `IsCancelled` 컬럼 (UPDATE 안 하고 새 row 추가하는 회계 패턴) |
| 모든 집계의 `isCounted` 가드 | LINQ `.Where(x => !x.IsCancelled)` 를 모든 집계 쿼리에 똑같이 |
| 부활 시 occupied 가드 | 동시성 충돌 방지 — `if (target.IsLocked) throw new InvalidOperationException` |

핵심 차이: 데스크톱은 DB transaction 으로 atomic 보장. RN + AsyncStorage / Firestore 는 transaction 없으니 reducer 안에서 가드 + wrapper 에서도 가드 = 이중 안전망.

---

## 함정 / 빠뜨리기 쉬운 곳

1. **모든 집계 함수에 가드 — 한 곳 빠뜨리면 어긋남**  
   summarize 4종 + CSV + 화면 카드 (`todayOrders.reduce((s, h) => s + h.total, 0)`) 모두 검사. 화면 측 합계는 별도라 잊기 쉬움.

2. **`Math.max(0, prev.total - entry.total)` — 음수 방지**  
   옛 데이터에서 total 이 정확하지 않으면 전체 합계가 음수 될 수 있음. 0 으로 클램프.

3. **idempotent 보장 — 이미 reverted 면 noop**  
   사장님이 빠르게 두 번 누르거나 동기화로 같은 액션 두 번 dispatch 될 때 중복 차감 안 되게.

4. **occupied 검사 — 자연 가드 vs 명시 가드 둘 다**  
   reducer 의 `if (state[tableId]) return state` 는 "있으면 안 덮어씀" 인데, wrapper 에서 `{ ok: false, reason: 'occupied' }` 로 명시 반환 안 하면 사장님은 왜 안 됐는지 모름. 두 곳 다 처리.

5. **history entry 의 items 가 마이그레이션 호환 안 될 수 있음**  
   옛 entry 는 cookState / sizeUpcharge / largeQty 같은 필드 없을 수 있음. restoreFromHistory 는 spread + 기본값 복원으로 대응. 단 future-proof — 새 필드 추가 시 항상 옵셔널 + 기본값 가드.

---

## 다음에 비슷한 기능 만들 때

- 매출 외에 다른 append-only 데이터 (예: 주방 출력 로그, 결제 단말기 응답 로그) 에서 "취소" 가 필요하면 같은 패턴: `cancelled` 플래그 + 모든 집계의 `isCounted` 가드 + 화면 라벨 + CSV 컬럼.
- "삭제" 라는 단어가 머리에 떠오르면 한 번 더 의심: 이게 정말 사라져도 되나? 회계 / 감사 / 운영 분석 측면에서 흔적 보존이 맞는 경우가 대부분.

---

## 관련 코드

- `utils/orderReducer.js` — `orders/undoMarkReady`, `orders/restoreFromHistory`
- `utils/orderHelpers.js` — `markHistoryReverted`, `findHistoryEntry`
- `utils/OrderContext.js` — `undoMarkReady(tableId)`, `revertHistoryEntry(entryId)`
- `utils/payment.js` — `isCounted` + 4종 집계 가드
- `screens/RevenueScreen.js` — 되돌리기 버튼, "되돌림" 라벨, 합계 카드 reverted 제외
- `screens/KitchenScreen.js` — "최근 조리완료" 섹션 (30분 / 10건 캡)
- `__tests__/orderReducer.test.js`, `__tests__/orderHelpers.test.js`, `__tests__/payment.test.js` — 18 단위 테스트
