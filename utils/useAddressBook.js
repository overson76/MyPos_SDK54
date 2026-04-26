import { useCallback, useEffect, useState } from 'react';
import { sanitizeDeliveryAddress } from './validate';
import { localDateString, normalizeAddressKey } from './orderHelpers';

// 배달 주소록 도메인 — 항목 CRUD + 자동 기억 토글 + 당일 완료 마크 + 자정 자동 리셋.
// state/setter 둘 다 노출 — 외부 도메인(주문 확정/정리)이 setAddressBook 으로 인라인 갱신함.
// 자정 reset 은 hydrate 가드 없이 mount 즉시 시작 — todayDate 비교만 하므로
// hydrate 전 빈 entries 상태에서 호출되어도 noop. 영속화 가드는 useOrderPersistence 가 담당.
export function useAddressBook() {
  const [addressBook, setAddressBook] = useState({
    entries: {},
    todayDate: localDateString(),
    todayDeliveredKeys: [],
    autoRemember: true,
  });

  useEffect(() => {
    const tick = () => {
      const today = localDateString();
      setAddressBook((prev) => {
        if (prev.todayDate === today) return prev;
        return { ...prev, todayDate: today, todayDeliveredKeys: [] };
      });
    };
    tick();
    const id = setInterval(tick, 60 * 1000); // 1분
    return () => clearInterval(id);
  }, []);

  // 주문이 cleared 될 때(또는 사용자가 주소를 확정 입력했을 때) 카운트 증가.
  // autoRemember=false 면 noop. 빈 문자열은 무시.
  const bumpAddress = useCallback((label) => {
    const safe = sanitizeDeliveryAddress(label);
    if (!safe) return;
    const key = normalizeAddressKey(safe);
    if (!key) return;
    setAddressBook((prev) => {
      if (!prev.autoRemember) {
        // 자동 기억 off — 카운트는 안 늘리지만 todayDelivered 표시는 함
        // (이미 등록된 항목이라면 회색 처리에 사용)
        if (!prev.entries[key]) return prev;
        if (prev.todayDeliveredKeys.includes(key)) return prev;
        return {
          ...prev,
          todayDeliveredKeys: [...prev.todayDeliveredKeys, key],
        };
      }
      const now = Date.now();
      const today = localDateString(now);
      const existing = prev.entries[key];
      const nextEntry = existing
        ? {
            ...existing,
            count: (existing.count || 0) + 1,
            lastUsedAt: now,
            label: existing.label || safe, // 라벨은 최초 입력본 유지
          }
        : {
            key,
            label: safe,
            count: 1,
            pinned: false,
            firstSeenAt: now,
            lastUsedAt: now,
          };
      const todayDate =
        prev.todayDate === today ? prev.todayDate : today;
      const baseTodayKeys =
        prev.todayDate === today ? prev.todayDeliveredKeys : [];
      const todayDeliveredKeys = baseTodayKeys.includes(key)
        ? baseTodayKeys
        : [...baseTodayKeys, key];
      return {
        ...prev,
        entries: { ...prev.entries, [key]: nextEntry },
        todayDate,
        todayDeliveredKeys,
      };
    });
  }, []);

  const pinAddress = useCallback((key, pinned) => {
    setAddressBook((prev) => {
      const ex = prev.entries[key];
      if (!ex) return prev;
      return {
        ...prev,
        entries: { ...prev.entries, [key]: { ...ex, pinned: !!pinned } },
      };
    });
  }, []);

  const deleteAddress = useCallback((key) => {
    setAddressBook((prev) => {
      if (!prev.entries[key]) return prev;
      const { [key]: _removed, ...rest } = prev.entries;
      return {
        ...prev,
        entries: rest,
        todayDeliveredKeys: prev.todayDeliveredKeys.filter((k) => k !== key),
      };
    });
  }, []);

  const setAutoRemember = useCallback((on) => {
    setAddressBook((prev) =>
      prev.autoRemember === !!on ? prev : { ...prev, autoRemember: !!on }
    );
  }, []);

  return {
    addressBook,
    setAddressBook,
    bumpAddress,
    pinAddress,
    deleteAddress,
    setAutoRemember,
  };
}
