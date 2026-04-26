import { useEffect, useRef } from 'react';
import { sanitizeDeliveryAddress } from './validate';
import {
  localDateString,
  normalizeAddressKey,
  resolveTableForAlert,
} from './orderHelpers';
import { appendHistory, buildHistoryEntry } from './useRevenue';

// 배달 테이블 자동 정리: 조리완료 후 5분 지나면 테이블에서 제거 (후불 완료 처리와 동일).
// 매출 기록 + 배달 주소록 카운트 + 당일 완료 마크까지 한꺼번에 처리.
export function useAutoClearDelivery({
  orders,
  setOrders,
  setRevenue,
  setAddressBook,
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
        const table = resolveTableForAlert(tableId);
        if (!table || table.type !== 'delivery') continue;
        if (order.status !== 'ready') continue;
        if (!order.readyAt) continue;
        if (now - order.readyAt >= FIVE_MIN) {
          toClear.push(tableId);
        }
      }
      if (toClear.length === 0) return;
      setOrders((prev) => {
        const next = { ...prev };
        for (const tid of toClear) {
          const ex = next[tid];
          if (!ex) continue;
          const total = (ex.items || []).reduce(
            (s, i) =>
              s +
              i.price * i.qty +
              (i.sizeUpcharge || 0) * (i.largeQty || 0),
            0
          );
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
          if (ex.deliveryAddress) {
            const safe = sanitizeDeliveryAddress(ex.deliveryAddress);
            const key = normalizeAddressKey(safe);
            if (key) {
              setAddressBook((prevBook) => {
                if (!prevBook.autoRemember) {
                  if (!prevBook.entries[key]) return prevBook;
                  if (prevBook.todayDeliveredKeys.includes(key)) return prevBook;
                  return {
                    ...prevBook,
                    todayDeliveredKeys: [
                      ...prevBook.todayDeliveredKeys,
                      key,
                    ],
                  };
                }
                const ts = Date.now();
                const today = localDateString(ts);
                const existing = prevBook.entries[key];
                const nextEntry = existing
                  ? {
                      ...existing,
                      count: (existing.count || 0) + 1,
                      lastUsedAt: ts,
                    }
                  : {
                      key,
                      label: safe,
                      count: 1,
                      pinned: false,
                      firstSeenAt: ts,
                      lastUsedAt: ts,
                    };
                const todayDate =
                  prevBook.todayDate === today ? prevBook.todayDate : today;
                const baseTodayKeys =
                  prevBook.todayDate === today
                    ? prevBook.todayDeliveredKeys
                    : [];
                const todayDeliveredKeys = baseTodayKeys.includes(key)
                  ? baseTodayKeys
                  : [...baseTodayKeys, key];
                return {
                  ...prevBook,
                  entries: { ...prevBook.entries, [key]: nextEntry },
                  todayDate,
                  todayDeliveredKeys,
                };
              });
            }
          }
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
