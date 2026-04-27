import { useEffect, useRef } from 'react';
import {
  appendHistory,
  buildHistoryEntry,
  computeItemsTotal,
  resolveTableForAlert,
} from './orderHelpers';

// 배달 테이블 자동 정리: 조리완료 후 5분 지나면 테이블에서 제거 (후불 완료 처리와 동일).
// 매출 기록 + 배달 주소록 카운트 + 당일 완료 마크까지 한꺼번에 처리.
// orders 변경은 reducer 의 'orders/autoClearDelivery' 한 액션으로 일괄 삭제,
// revenue / addressBook 부수효과는 wrapper 가 dispatch 직전에 처리.
export function useAutoClearDelivery({
  orders,
  dispatch,
  setRevenue,
  bumpAddress,
}) {
  const ordersRef = useRef(orders);
  ordersRef.current = orders;

  useEffect(() => {
    const FIVE_MIN = 5 * 60 * 1000;
    const check = () => {
      const now = Date.now();
      const entries = Object.entries(ordersRef.current);
      const toClear = [];
      for (const [tableId, order] of entries) {
        if (!order) continue;
        // cheap 필드 가드 먼저 — resolveTableForAlert 룩업은 통과한 항목만
        if (order.status !== 'ready') continue;
        if (!order.readyAt) continue;
        if (now - order.readyAt < FIVE_MIN) continue;
        const table = resolveTableForAlert(tableId);
        if (!table || table.type !== 'delivery') continue;
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
