import { useEffect, useRef } from 'react';
import {
  appendHistory,
  buildHistoryEntry,
  computeItemsTotal,
  normalizeAddressKey,
  resolveTableForAlert,
} from './orderHelpers';

// 배달 테이블 자동 정리: 조리완료 후 일정 시간 지나면 테이블에서 제거 (후불 완료 처리와 동일).
//   - 주소 미입력: 5분 (기본). 사장님 익숙한 패턴.
//   - 주소 입력 + 카카오 driving duration 있음: **그 시간만큼 + 5분 버퍼** 대기 (1.0.52).
//     → 손님 도착 예상 시간까지 슬롯 유지. 도착 후 자동 사라짐.
//   - 최대 90분 cap (가까운 주문이라도 너무 짧게 사라지지 않게, 먼 주문도 너무 오래 유지 안 되게).
// 매출 기록 + 배달 주소록 카운트 + 당일 완료 마크까지 한꺼번에 처리.
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
        const total = computeItemsTotal(ex.items);
        setRevenue((prevRev) =>
          appendHistory(
            prevRev,
            buildHistoryEntry({
              tableId: tid,
              items: ex.items,
              options: ex.options,
              deliveryAddress: ex.deliveryAddress,
              deliveryTime: ex.deliveryTime,
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
