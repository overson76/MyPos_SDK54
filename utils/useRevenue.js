import { useEffect, useState } from 'react';
import { capHistory, sweepHistoryPII } from './orderHelpers';

// 매출 도메인 — 누적 total + history 배열 + 1시간 주기 PII sweep.
// state/setter 둘 다 노출 — 외부 도메인(주문 정리/자동 배달 정리)이 setRevenue 로 history 항목 추가.
// PII sweep 은 hydrate 가드 없이 시작 — 빈 history 면 noop, 영속화 가드는 useOrderPersistence 가 담당.
export function useRevenue() {
  const [revenue, setRevenue] = useState({ total: 0, history: [] });

  useEffect(() => {
    const sweep = () => {
      setRevenue((prev) => {
        const swept = sweepHistoryPII(prev.history);
        if (swept === prev.history) return prev;
        return { ...prev, history: swept };
      });
    };
    sweep();
    const id = setInterval(sweep, 60 * 60 * 1000); // 1h
    return () => clearInterval(id);
  }, []);

  return { revenue, setRevenue };
}

// 매출 history 한 건 추가 헬퍼 — clearTable / useAutoClearDelivery 가 같은 모양으로 push.
// extraFields 로 autoDelivered 같은 옵션 필드 병합.
export function buildHistoryEntry({
  tableId,
  items,
  options,
  deliveryAddress,
  deliveryTime,
  paymentStatus,
  total,
  extraFields,
}) {
  return {
    id: `${tableId}-${Date.now()}`,
    tableId,
    items: (items || []).map((i) => ({ ...i })),
    options: [...(options || [])],
    deliveryAddress: deliveryAddress || '',
    deliveryTime: deliveryTime || '',
    paymentStatus,
    total,
    clearedAt: Date.now(),
    ...(extraFields || {}),
  };
}

export function appendHistory(prev, entry) {
  return {
    total: prev.total + entry.total,
    history: capHistory([...prev.history, entry]),
  };
}
