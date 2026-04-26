import { useCallback, useState } from 'react';
import { mergeOrderParts } from './orderHelpers';

// 단체(그룹) 상태 — { [leaderId]: [tableId1, tableId2, ...] }. 첫 멤버가 리더(주문 저장소).
// createGroup 은 orders 와 결합되므로 setOrders 를 주입받아 두 setState 를 chain.
export function useGroups({ setOrders }) {
  const [groups, setGroups] = useState({});

  const getGroupFor = useCallback(
    (tableId) => {
      for (const [leaderId, members] of Object.entries(groups)) {
        if (members.includes(tableId)) {
          return { leaderId, memberIds: members };
        }
      }
      return null;
    },
    [groups]
  );

  const dissolveGroup = useCallback((leaderId) => {
    setGroups((prev) => {
      if (!prev[leaderId]) return prev;
      const { [leaderId]: _removed, ...rest } = prev;
      return rest;
    });
  }, []);

  // 멤버 여러 개 중 첫 테이블을 리더로, 해당 리더 tableId 에 모든 주문 통합
  const createGroup = useCallback(
    (memberIds) => {
      if (!memberIds || memberIds.length < 2) return;
      const sorted = [...memberIds];
      const leaderId = sorted[0];
      setGroups((prev) => ({ ...prev, [leaderId]: sorted }));
      setOrders((prev) => {
        let leaderOrder = prev[leaderId] || null;
        for (let i = 1; i < sorted.length; i++) {
          const m = prev[sorted[i]];
          if (!m) continue;
          leaderOrder = mergeOrderParts(leaderOrder, m) || leaderOrder;
        }
        const next = { ...prev };
        for (let i = 1; i < sorted.length; i++) {
          delete next[sorted[i]];
        }
        if (leaderOrder) next[leaderId] = leaderOrder;
        return next;
      });
    },
    [setOrders]
  );

  return { groups, setGroups, getGroupFor, dissolveGroup, createGroup };
}
