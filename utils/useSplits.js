import { useCallback, useState } from 'react';
import { mergeOrderParts } from './orderHelpers';
import { addBreadcrumb } from './sentry';

// 테이블 분할 상태 — { [parentId]: true } 맵.
// toggleSplit 은 orders 와 결합되므로 setOrders 를 주입받아 두 setState 를 chain.
export function useSplits({ setOrders }) {
  const [splits, setSplits] = useState({});

  const isSplit = useCallback((tableId) => !!splits[tableId], [splits]);

  const toggleSplit = useCallback(
    (parentId) => {
      addBreadcrumb('table.toggleSplit', { parentId });
      setSplits((prevSplits) => {
        if (prevSplits[parentId]) {
          // unsplit: #1 + #2 → parentId 로 병합
          setOrders((prev) => {
            const p1 = prev[`${parentId}#1`];
            const p2 = prev[`${parentId}#2`];
            const merged = mergeOrderParts(p1, p2);
            const next = { ...prev };
            delete next[`${parentId}#1`];
            delete next[`${parentId}#2`];
            if (merged) next[parentId] = merged;
            else delete next[parentId];
            return next;
          });
          const { [parentId]: _, ...rest } = prevSplits;
          return rest;
        }
        // split: parentId → #1 (#2 는 빈 슬롯)
        setOrders((prev) => {
          if (!prev[parentId]) return prev;
          const next = { ...prev };
          next[`${parentId}#1`] = prev[parentId];
          delete next[parentId];
          return next;
        });
        return { ...prevSplits, [parentId]: true };
      });
    },
    [setOrders]
  );

  return { splits, setSplits, isSplit, toggleSplit };
}
