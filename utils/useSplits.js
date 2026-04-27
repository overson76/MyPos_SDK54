import { useCallback, useState } from 'react';
import { mergeOrderParts } from './orderHelpers';
import { addBreadcrumb } from './sentry';

// 테이블 분할 상태 — { [parentId]: true } 맵.
// toggleSplit 은 orders 와 결합되므로 orders + dispatch 를 주입받아
// reducer 액션 하나와 setSplits 한 번을 chain.
export function useSplits({ orders, dispatch }) {
  const [splits, setSplits] = useState({});

  const isSplit = useCallback((tableId) => !!splits[tableId], [splits]);

  const toggleSplit = useCallback(
    (parentId) => {
      addBreadcrumb('table.toggleSplit', { parentId });
      if (splits[parentId]) {
        // unsplit: #1 + #2 → parentId 로 병합. mergedLeader 는 wrapper 가 미리 계산.
        const p1 = orders[`${parentId}#1`];
        const p2 = orders[`${parentId}#2`];
        const merged = mergeOrderParts(p1, p2);
        dispatch({ type: 'orders/unsplitTable', parentId, merged });
        setSplits((prev) => {
          const { [parentId]: _, ...rest } = prev;
          return rest;
        });
      } else {
        // split: parentId → #1 (#2 는 빈 슬롯)
        if (orders[parentId]) {
          dispatch({ type: 'orders/splitTable', parentId });
        }
        setSplits((prev) => ({ ...prev, [parentId]: true }));
      }
    },
    [orders, splits, dispatch]
  );

  return { splits, setSplits, isSplit, toggleSplit };
}
