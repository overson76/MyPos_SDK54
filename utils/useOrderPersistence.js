import { useEffect, useMemo, useState } from 'react';
import { loadMany, makeDebouncedSaver } from './persistence';
import {
  capHistory,
  localDateString,
  sweepHistoryPII,
} from './orderHelpers';

// OrderProvider 의 영속화 책임을 캡슐화 — 마운트 1회 hydration + 5개 state 디바운스 저장.
// 반환된 hydrated 가 true 가 되기 전에는 디스크 쓰기 effect 가 noop 이라 깨끗한 초기 로드 보장.
export function useOrderPersistence({
  orders,
  setOrders,
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
      if (data.orders && typeof data.orders === 'object') setOrders(data.orders);
      if (data.splits && typeof data.splits === 'object') setSplits(data.splits);
      if (data.groups && typeof data.groups === 'object') setGroups(data.groups);
      if (data.revenue && typeof data.revenue === 'object') {
        setRevenue({
          total: Number(data.revenue.total) || 0,
          history: Array.isArray(data.revenue.history)
            ? sweepHistoryPII(capHistory(data.revenue.history))
            : [],
        });
      }
      if (data.addressBook && typeof data.addressBook === 'object') {
        const today = localDateString();
        const loaded = data.addressBook;
        const sameDay = loaded.todayDate === today;
        setAddressBook({
          entries:
            loaded.entries && typeof loaded.entries === 'object'
              ? loaded.entries
              : {},
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
        });
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
