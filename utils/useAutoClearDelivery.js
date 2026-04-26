import { useEffect, useRef } from 'react';
import {
  appendHistory,
  buildHistoryEntry,
  computeItemsTotal,
  resolveTableForAlert,
} from './orderHelpers';

// 배달 테이블 자동 정리: 조리완료 후 5분 지나면 테이블에서 제거 (후불 완료 처리와 동일).
// 매출 기록 + 배달 주소록 카운트 + 당일 완료 마크까지 한꺼번에 처리.
export function useAutoClearDelivery({
  orders,
  setOrders,
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
      setOrders((prev) => {
        const next = { ...prev };
        for (const tid of toClear) {
          const ex = next[tid];
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
          delete next[tid];
        }
        return next;
      });
    };
    const interval = setInterval(check, 30000);
    check();
    return () => clearInterval(interval);
    // setter 들은 안정적, ordersRef 로 최신 orders 접근.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
