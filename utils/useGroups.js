import { useCallback, useState } from 'react';
import { mergeOrderParts } from './orderHelpers';

// 단체(그룹) 상태 — { [leaderId]: [tableId1, tableId2, ...] }. 첫 멤버가 리더(주문 저장소).
// createGroup 은 orders 와 결합되므로 orders + dispatch 를 주입받아 mergedLeader 를
// wrapper 에서 미리 계산해 reducer 에 넘김.
//
// 2026-05-21: groupModes 추가 — 단체별 'shared' (통합 결제/메뉴) | 'split' (분리)
//   shared: leader 슬롯에 메뉴 박힘 → 양쪽 슬롯에 동일 표시 + 합산 결제
//   split:  각자 자기 슬롯에 메뉴 박힘 → 자기 슬롯만 표시 + 개별 결제
//   default 'shared' — 옛 데이터/명시 안 한 단체는 통합 모드.
export function useGroups({ orders, dispatch }) {
  const [groups, setGroups] = useState({});
  const [groupModes, setGroupModes] = useState({});

  const getGroupMode = useCallback(
    (leaderId) => groupModes[leaderId] || 'shared',
    [groupModes]
  );

  const setGroupMode = useCallback((leaderId, mode) => {
    if (!leaderId || !mode) return;
    setGroupModes((prev) => ({ ...prev, [leaderId]: mode }));
  }, []);

  const getGroupFor = useCallback(
    (tableId) => {
      for (const [leaderId, members] of Object.entries(groups)) {
        if (members.includes(tableId)) {
          return {
            leaderId,
            memberIds: members,
            mode: groupModes[leaderId] || 'shared',
          };
        }
      }
      return null;
    },
    [groups, groupModes]
  );

  const dissolveGroup = useCallback((leaderId) => {
    setGroups((prev) => {
      if (!prev[leaderId]) return prev;
      const { [leaderId]: _removed, ...rest } = prev;
      return rest;
    });
    setGroupModes((prev) => {
      if (!prev[leaderId]) return prev;
      const { [leaderId]: _r, ...rest } = prev;
      return rest;
    });
  }, []);

  // 멤버 여러 개 중 첫 테이블을 리더로, 해당 리더 tableId 에 모든 주문 통합
  // 2026-05-21: mode 인자 추가 — 'shared' (default) | 'split'
  const createGroup = useCallback(
    (memberIds, mode = 'shared') => {
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
      // split 모드면 mergedLeader 안 만듦 (각자 자기 슬롯 그대로 유지).
      let leaderOrder = null;
      if (mode === 'shared') {
        leaderOrder = stamp(orders[leaderId], leaderId);
        for (let i = 1; i < sorted.length; i++) {
          const m = stamp(orders[sorted[i]], sorted[i]);
          if (!m) continue;
          leaderOrder = mergeOrderParts(leaderOrder, m) || leaderOrder;
        }
      }
      setGroups((prev) => ({ ...prev, [leaderId]: sorted }));
      setGroupModes((prev) => ({ ...prev, [leaderId]: mode }));
      if (mode === 'shared') {
        // 통합 모드: 멤버 slot 삭제 + leader 에 합산
        dispatch({
          type: 'orders/createGroupMerge',
          leaderId,
          memberIds: sorted,
          mergedLeader: leaderOrder,
        });
      }
      // split 모드: 그룹 시각만 묶음. 멤버 slot 그대로 유지 (각자 자기 메뉴).
    },
    [orders, dispatch]
  );

  return {
    groups,
    setGroups,
    groupModes,
    setGroupModes,
    getGroupMode,
    setGroupMode,
    getGroupFor,
    dissolveGroup,
    createGroup,
  };
}
