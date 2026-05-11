import { useCallback, useState } from 'react';
import { mergeOrderParts } from './orderHelpers';

// 단체(그룹) 상태 — { [leaderId]: [tableId1, tableId2, ...] }. 첫 멤버가 리더(주문 저장소).
// createGroup 은 orders 와 결합되므로 orders + dispatch 를 주입받아 mergedLeader 를
// wrapper 에서 미리 계산해 reducer 에 넘김.
export function useGroups({ orders, dispatch }) {
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
      // 1.0.35: 단체 결성 직전 — 각 멤버 테이블의 슬롯에 sourceTableId 를 stamp.
      // 합쳐진 후에도 normalizeSlots 의 매칭이 sourceTable 별로 갈리도록.
      // 옛 슬롯 (sourceTableId 미박힘) 은 자기 테이블 ID 로 채우고, 이미 박힌 건 보존.
      // 1인/테이블별 결제 분리, 단체 해제 후 원위치 복원의 토대.
      const stamp = (order, tid) => {
        if (!order) return order;
        const fn = (arr) =>
          (arr || []).map((i) => ({
            ...i,
            sourceTableId: i.sourceTableId || tid,
          }));
        return {
          ...order,
          items: fn(order.items),
          cartItems: fn(order.cartItems),
          confirmedItems: fn(order.confirmedItems),
        };
      };
      // mergedLeader 계산 — reducer 는 cross-domain 모르므로 wrapper 가 결과만 전달.
      let leaderOrder = stamp(orders[leaderId], leaderId);
      for (let i = 1; i < sorted.length; i++) {
        const m = stamp(orders[sorted[i]], sorted[i]);
        if (!m) continue;
        leaderOrder = mergeOrderParts(leaderOrder, m) || leaderOrder;
      }
      setGroups((prev) => ({ ...prev, [leaderId]: sorted }));
      dispatch({
        type: 'orders/createGroupMerge',
        leaderId,
        memberIds: sorted,
        mergedLeader: leaderOrder,
      });
    },
    [orders, dispatch]
  );

  return { groups, setGroups, getGroupFor, dissolveGroup, createGroup };
}
