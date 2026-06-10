import { useEffect, useMemo, useState } from 'react';
import { loadMany, makeDebouncedSaver } from './persistence';
import { capHistory, localDateString } from './orderHelpers';

// OrderProvider 의 영속화 책임을 캡슐화 — 마운트 1회 hydration + 5개 state 디바운스 저장.
// 반환된 hydrated 가 true 가 되기 전에는 디스크 쓰기 effect 가 noop 이라 깨끗한 초기 로드 보장.
// orders 만 reducer 기반이라 dispatch 를 받고, 나머지 4개는 useState 기반이라 setter 그대로.
export function useOrderPersistence({
  orders,
  dispatch,
  splits,
  setSplits,
  groups,
  setGroups,
  revenue,
  setRevenue,
  addressBook,
  setAddressBook,
}) {
  const [hydrated, setHydrated] = useState(false);
  const saver = useMemo(() => makeDebouncedSaver(300), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await loadMany([
        'orders',
        'splits',
        'groups',
        'revenue',
        'addressBook',
      ]);
      if (cancelled) return;
      if (data.orders && typeof data.orders === 'object') {
        dispatch({ type: 'orders/hydrate', payload: data.orders });
      }
      if (data.splits && typeof data.splits === 'object') setSplits(data.splits);
      if (data.groups && typeof data.groups === 'object') setGroups(data.groups);
      if (data.revenue && typeof data.revenue === 'object') {
        setRevenue({
          total: Number(data.revenue.total) || 0,
          history: Array.isArray(data.revenue.history)
            ? capHistory(data.revenue.history)
            : [],
        });
      }
      if (data.addressBook && typeof data.addressBook === 'object') {
        const today = localDateString();
        const loaded = data.addressBook;
        const sameDay = loaded.todayDate === today;
        // 2026-06-09: entries 는 AsyncStorage 에서 복원하지 않는다 — Firestore
        //   (+persistentLocalCache 오프라인 캐시) 가 entries 의 단일 진실원.
        //   [버그] 옛 코드는 부팅 시 AsyncStorage 의 (다른 기기에서 이미 삭제된) stale
        //   entries 를 메모리에 올렸다. 그런데 lastSyncedAddressEntriesRef 는 Firestore
        //   listener 만 갱신하므로, AsyncStorage hydrate 가 만든 entries 는 ref 와 어긋난
        //   "false diff" → useOrderFirestoreSync 의 write effect 가 그 옛 항목을 "신규
        //   로컬" 로 오해해 batch.set → Firestore 에 삭제된 entry 부활(사하자원). 단일
        //   기기에선 AsyncStorage 도 최신이라 안 보이고, 다기기에서만 재현(사장님 "서로 물려서").
        //   처방: entries 는 prev(초기 {} 또는 이미 도착한 listener 값) 그대로 유지하고
        //   meta 만 복원. functional update 라 entries 참조가 안 바뀌어 write effect 도 noop.
        setAddressBook((prev) => ({
          ...prev,
          todayDate: today,
          todayDeliveredKeys: sameDay
            ? Array.isArray(loaded.todayDeliveredKeys)
              ? loaded.todayDeliveredKeys
              : []
            : [],
          autoRemember:
            typeof loaded.autoRemember === 'boolean'
              ? loaded.autoRemember
              : true,
        }));
      }
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
    // setter 들은 useState 가 안정적이라 deps 생략.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (hydrated) saver('orders', orders);
  }, [orders, hydrated, saver]);
  useEffect(() => {
    if (hydrated) saver('splits', splits);
  }, [splits, hydrated, saver]);
  useEffect(() => {
    if (hydrated) saver('groups', groups);
  }, [groups, hydrated, saver]);
  useEffect(() => {
    if (hydrated) saver('revenue', revenue);
  }, [revenue, hydrated, saver]);
  useEffect(() => {
    if (hydrated) saver('addressBook', addressBook);
  }, [addressBook, hydrated, saver]);

  return hydrated;
}
