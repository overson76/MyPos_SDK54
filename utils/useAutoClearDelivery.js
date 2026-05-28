import { useEffect, useRef } from 'react';
import {
  appendHistory,
  buildHistoryEntry,
  computeItemsTotal,
  normalizeAddressKey,
  resolveTableForAlert,
} from './orderHelpers';
import { resolveDeliveryIdentity } from './addressBookLookup';

// 배달 테이블 자동 처리 — 사장님 룰 "자체 배달 = 조리완료 = 결제완료 동등".
//
// 1.0.55 (2026-05-22): 두 단계 분리.
//   ① 즉시 — readyAt 박힘 직후 자동 markPaid + history append (매출 즉시 반영).
//      paymentMethod 기본 'cash' (현금/계좌이체 매장 룰). 사장님이 미리 선택한
//      method 가 있으면 유지 (PaymentMethodPicker 우선).
//   ② 지연 — driving duration + 5분 (또는 5분 기본) 후 슬롯 제거.
//      이미 ① 에서 history append 됐으면 여기선 history skip, 슬롯만 정리.
//
// 사장님 신고 (영업 중): 결제 완료 안 받았어도 회수 / 매출 / 영수증 자동 출력
// 같은 결제 의존 동작이 다 작동해야. 자체 배달은 출발 = 결제 확정과 동등.
export function useAutoClearDelivery({
  orders,
  dispatch,
  setRevenue,
  bumpAddress,
  addressBook,
}) {
  const ordersRef = useRef(orders);
  ordersRef.current = orders;
  const addressBookRef = useRef(addressBook);
  addressBookRef.current = addressBook;

  // ① 즉시 markPaid + history append — 사장님 룰 "조리완료 = 결제완료".
  // orders 변할 때마다 트리거. paid 됐거나 ready 아닌 슬롯은 skip → 무한 루프 X.
  useEffect(() => {
    for (const [tableId, order] of Object.entries(orders || {})) {
      if (!order) continue;
      if (order.status !== 'ready') continue;
      if (!order.readyAt) continue;
      if (order.paymentStatus === 'paid') continue; // 이미 결제됨 (사장님 수동 또는 본 effect 옛 발동)
      const table = resolveTableForAlert(tableId);
      if (!table || table.type !== 'delivery') continue;
      if (!order.items || order.items.length === 0) continue;
      // 사장님 매장 룰: 배달 = 현금 또는 계좌이체. 디폴트 'cash'.
      // PaymentMethodPicker 가 미리 박은 method 있으면 그걸 유지.
      const paymentMethod = order.paymentMethod || 'cash';
      dispatch({ type: 'orders/markPaid', tableId, paymentMethod });
      const total = computeItemsTotal(order.items);
      const ident = resolveDeliveryIdentity(
        addressBookRef.current,
        order.deliveryAddress,
        { alias: order.deliveryAlias, phone: order.deliveryPhone }
      );
      setRevenue((prev) =>
        appendHistory(
          prev,
          buildHistoryEntry({
            tableId,
            items: order.items,
            options: order.options,
            deliveryAddress: order.deliveryAddress,
            deliveryAlias: ident.alias,
            deliveryPhone: ident.phone,
            deliveryPhones: ident.phones,
            deliveryTime: order.deliveryTime,
            deliveryTimeIsPM: order.deliveryTimeIsPM ?? true,
            paymentStatus: 'paid',
            paymentMethod,
            total,
            extraFields: { autoPaidOnReady: true },
          })
        )
      );
      if (order.deliveryAddress) bumpAddress(order.deliveryAddress);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders]);

  useEffect(() => {
    const FIVE_MIN = 5 * 60 * 1000;
    const BUFFER_MIN = 5 * 60 * 1000;       // 도착 후 사장님이 확인할 여유
    const MAX_DELAY = 90 * 60 * 1000;       // 90분 cap (이상치 차단)
    // 주문별 대기 시간 산출 — 주소 + 카카오 duration 있으면 그 시간 + 버퍼, 없으면 5분.
    const computeDelay = (order) => {
      const addr = order?.deliveryAddress;
      if (!addr) return FIVE_MIN;
      const ab = addressBookRef.current;
      const key = normalizeAddressKey(addr);
      const entry = key ? ab?.entries?.[key] : null;
      const durSec = entry?.drivingDurationSec;
      if (typeof durSec !== 'number' || durSec <= 0) return FIVE_MIN;
      const total = durSec * 1000 + BUFFER_MIN;
      return Math.min(total, MAX_DELAY);
    };
    const check = () => {
      const now = Date.now();
      const entries = Object.entries(ordersRef.current);
      const toClear = [];
      for (const [tableId, order] of entries) {
        if (!order) continue;
        if (order.status !== 'ready') continue;
        if (!order.readyAt) continue;
        const table = resolveTableForAlert(tableId);
        if (!table || table.type !== 'delivery') continue;
        const delay = computeDelay(order);
        if (now - order.readyAt < delay) continue;
        toClear.push(tableId);
      }
      if (toClear.length === 0) return;
      const ords = ordersRef.current;
      for (const tid of toClear) {
        const ex = ords[tid];
        if (!ex) continue;
        // 1.0.55: ① 즉시 effect 가 이미 markPaid + history append 한 슬롯은 skip.
        // paymentStatus='paid' 면 history 에 이미 entry 있음 — 중복 방지. 슬롯만 정리.
        if (ex.paymentStatus === 'paid') continue;
        const total = computeItemsTotal(ex.items);
        const ident = resolveDeliveryIdentity(addressBookRef.current, ex.deliveryAddress, {
          alias: ex.deliveryAlias,
          phone: ex.deliveryPhone,
        });
        setRevenue((prevRev) =>
          appendHistory(
            prevRev,
            buildHistoryEntry({
              tableId: tid,
              items: ex.items,
              options: ex.options,
              deliveryAddress: ex.deliveryAddress,
              deliveryAlias: ident.alias,
              deliveryPhone: ident.phone,
              deliveryPhones: ident.phones,
              deliveryTime: ex.deliveryTime,
              deliveryTimeIsPM: ex.deliveryTimeIsPM ?? true,
              paymentStatus: ex.paymentStatus,
              total,
              extraFields: { autoDelivered: true },
            })
          )
        );
        if (ex.deliveryAddress) bumpAddress(ex.deliveryAddress);
      }
      dispatch({ type: 'orders/autoClearDelivery', tableIds: toClear });
      // 배달 슬롯 빈자리 메꿈 — d3 가 자동 정리되면 d4 → d3 등으로 재키잉.
      dispatch({ type: 'orders/compactSlots', prefix: 'd' });
    };
    const interval = setInterval(check, 30000);
    check();
    return () => clearInterval(interval);
    // dispatch / setter 들은 안정적, ordersRef 로 최신 orders 접근.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
