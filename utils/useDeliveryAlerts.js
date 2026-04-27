import { useEffect, useRef } from 'react';
import { playDeliveryAlertSound, speakDeliveryAlert } from './notify';
import { parseDeliveryTime, deliveryDateFromParsed } from './timeUtil';
import { resolveTableForAlert } from './orderHelpers';

// 배달 시간 10분 전 / 5분 전 음성 + 사운드 알림.
// 두 단계로 나눠 두 번 발화하도록 deliveryAlerted10/5 플래그를 reducer 가 관리.
export function useDeliveryAlerts({ orders, dispatch }) {
  const ordersRef = useRef(orders);
  ordersRef.current = orders;

  useEffect(() => {
    const fireAlert = (tableId, order, stageMinutes) => {
      const table = resolveTableForAlert(tableId);
      if (!table) return;
      playDeliveryAlertSound();
      speakDeliveryAlert({
        table,
        minutesLeft: stageMinutes,
        address: order.deliveryAddress,
      });
      const flagKey =
        stageMinutes === 10 ? 'deliveryAlerted10' : 'deliveryAlerted5';
      dispatch({ type: 'orders/markDeliveryAlerted', tableId, flagKey });
    };

    const check = () => {
      const now = new Date();
      Object.entries(ordersRef.current).forEach(([tableId, order]) => {
        if (!order.deliveryTime) return;
        const parsed = parseDeliveryTime(
          order.deliveryTime,
          order.deliveryTimeIsPM
        );
        const target = deliveryDateFromParsed(parsed);
        if (!target) return;
        const diffMin = (target - now) / 60000;
        if (diffMin > 0 && diffMin <= 5 && !order.deliveryAlerted5) {
          fireAlert(tableId, order, 5);
          return;
        }
        if (diffMin > 5 && diffMin <= 10 && !order.deliveryAlerted10) {
          fireAlert(tableId, order, 10);
        }
      });
    };
    const interval = setInterval(check, 30000);
    check();
    return () => clearInterval(interval);
    // dispatch 는 안정적, ordersRef 로 최신 orders 접근.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
