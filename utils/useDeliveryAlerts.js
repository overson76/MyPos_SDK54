import { useEffect, useRef } from 'react';
import {
  playDeliveryAlertSound,
  speakDeliveryAlert,
  speakReservationAlert,
  speakTakeoutAlert,
} from './notify';
import { parseDeliveryTime, deliveryDateFromParsed } from './timeUtil';
import { resolveTableForAlert } from './orderHelpers';

// 예약 시각 10분 전 / 5분 전 음성 + 사운드 알림.
// 1.0.44: 배달뿐 아니라 예약/포장도 같은 deliveryTime/deliveryTimeIsPM 필드를 재사용.
// table.type 에 따라 음성 메시지만 분기 — "배달 출발" / "예약 시각" / "포장 픽업".
// regular 테이블은 시간 입력 UI 가 없어 자연스럽게 진입 X.
// 두 단계로 나눠 두 번 발화하도록 deliveryAlerted10/5 플래그를 reducer 가 관리.
export function useDeliveryAlerts({ orders, dispatch }) {
  const ordersRef = useRef(orders);
  ordersRef.current = orders;

  useEffect(() => {
    const fireAlert = (tableId, order, stageMinutes) => {
      const table = resolveTableForAlert(tableId);
      if (!table) return;
      const type = table.type;
      if (type !== 'delivery' && type !== 'reservation' && type !== 'takeout') {
        return;
      }
      playDeliveryAlertSound();
      if (type === 'delivery') {
        speakDeliveryAlert({
          table,
          minutesLeft: stageMinutes,
          address: order.deliveryAddress,
        });
      } else if (type === 'reservation') {
        speakReservationAlert({ table, minutesLeft: stageMinutes });
      } else {
        speakTakeoutAlert({ table, minutesLeft: stageMinutes });
      }
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
