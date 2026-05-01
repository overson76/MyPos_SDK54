import { useState } from 'react';

// 매출 도메인 — 누적 total + history 배열.
// state/setter 둘 다 노출 — 외부 도메인(주문 정리/자동 배달 정리)이 setRevenue 로 history 항목 추가.
export function useRevenue() {
  const [revenue, setRevenue] = useState({ total: 0, history: [] });
  return { revenue, setRevenue };
}
