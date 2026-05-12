import { useCallback, useEffect, useRef, useState } from 'react';
import { sanitizeDeliveryAddress } from './validate';
import { localDateString, normalizeAddressKey } from './orderHelpers';
import { geocodeAddress, isGeocodingAvailable } from './geocode';

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

  // ── 좌표 자동 변환 (lazy + fire-and-forget) ─────────────────────
  // entry 에 lat 없으면 백그라운드로 카카오 호출 → 결과 저장.
  // inFlight: 중복 호출 방지. failed: 일시 실패 마킹 — 메모리 only 라 앱 재시작 시 재시도.
  const inFlightRef = useRef(new Set());
  const failedRef = useRef(new Set());
  useEffect(() => {
    if (!isGeocodingAvailable()) return;
    for (const entry of Object.values(addressBook.entries)) {
      if (
        typeof entry.lat === 'number' ||
        inFlightRef.current.has(entry.key) ||
        failedRef.current.has(entry.key)
      ) {
        continue;
      }
      inFlightRef.current.add(entry.key);
      geocodeAddress(entry.label).then((result) => {
        inFlightRef.current.delete(entry.key);
        if (!result) {
          failedRef.current.add(entry.key);
          return;
        }
        setAddressBook((prev) => {
          const ex = prev.entries[entry.key];
          if (!ex || typeof ex.lat === 'number') return prev;
          return {
            ...prev,
            entries: {
              ...prev.entries,
              [entry.key]: { ...ex, lat: result.lat, lng: result.lng },
            },
          };
        });
      });
    }
  }, [addressBook.entries]);

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

  // 주문 확정 시점 — entry 존재 여부 무관, count 안 늘리고 todayDeliveredKeys 만 마크.
  // 같은 주소로 또 주문하지 않게 칩에서 즉시 회색 처리하는 UX 용.
  const markAddressDeliveredToday = useCallback((label) => {
    const safe = sanitizeDeliveryAddress(label);
    if (!safe) return;
    const key = normalizeAddressKey(safe);
    if (!key) return;
    setAddressBook((prev) => {
      const today = localDateString();
      const baseKeys =
        prev.todayDate === today ? prev.todayDeliveredKeys : [];
      if (baseKeys.includes(key)) return prev;
      return {
        ...prev,
        todayDate: today,
        todayDeliveredKeys: [...baseKeys, key],
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

  // 수동 주소 추가 — 배달 완료 없이도 미리 등록 가능.
  // label 필수. alias, phone 은 선택.
  const addAddress = useCallback((label, alias, phone) => {
    const safe = sanitizeDeliveryAddress(label);
    if (!safe) return false;
    const key = normalizeAddressKey(safe);
    if (!key) return false;
    const digits = (phone || '').replace(/\D/g, '');
    setAddressBook((prev) => {
      if (prev.entries[key]) return prev; // 이미 존재하면 무시
      const entry = {
        key,
        label: safe,
        count: 0,
        pinned: false,
        firstSeenAt: Date.now(),
        lastUsedAt: Date.now(),
      };
      if (alias?.trim()) entry.alias = alias.trim();
      if (digits) entry.phone = digits;
      return { ...prev, entries: { ...prev.entries, [key]: entry } };
    });
    return true;
  }, []);

  // 전화번호만 있는 미완성 entry — CID 신규 번호 / "나중에 주소 채움" 용.
  // 같은 phone digits 가 어디에 등록돼 있으면 noop. key 는 __phone:digits 패턴으로
  // normalizeAddressKey 충돌 방지. pendingAddress=true 플래그로 UI 가 강조 표시.
  const addPhoneOnly = useCallback((phone, alias) => {
    const digits = (phone || '').replace(/\D/g, '');
    if (!digits) return false;
    const key = `__phone:${digits}`;
    const formatted = formatPhoneDigits(digits);
    const placeholder = `(주소 미입력) ${formatted}`;
    setAddressBook((prev) => {
      const exists = Object.values(prev.entries).some(
        (e) => e.phone && e.phone.replace(/\D/g, '') === digits
      );
      if (exists) return prev;
      const entry = {
        key,
        label: placeholder,
        phone: digits,
        pendingAddress: true,
        count: 0,
        pinned: false,
        firstSeenAt: Date.now(),
        lastUsedAt: Date.now(),
      };
      if (alias?.trim()) entry.alias = alias.trim();
      return { ...prev, entries: { ...prev.entries, [key]: entry } };
    });
    return true;
  }, []);

  // 주소(label) 편집 — 같은 key 면 라벨만, 다른 key 면 entry 이주 + 좌표 무효화.
  // pendingAddress entry 가 실제 주소를 받으면 정식 entry 로 승격되는 핵심 경로.
  const editLabel = useCallback((oldKey, newLabel) => {
    const safe = sanitizeDeliveryAddress(newLabel);
    if (!safe) return false;
    const newKey = normalizeAddressKey(safe);
    if (!newKey) return false;
    setAddressBook((prev) => {
      const ex = prev.entries[oldKey];
      if (!ex) return prev;
      if (oldKey === newKey) {
        return {
          ...prev,
          entries: {
            ...prev.entries,
            [oldKey]: { ...ex, label: safe, pendingAddress: false },
          },
        };
      }
      const target = prev.entries[newKey];
      const merged = target
        ? {
            ...target,
            phone: target.phone || ex.phone,
            alias: target.alias || ex.alias,
            count: (target.count || 0) + (ex.count || 0),
            lastUsedAt: Math.max(target.lastUsedAt || 0, ex.lastUsedAt || 0),
          }
        : {
            ...ex,
            key: newKey,
            label: safe,
            lat: undefined,
            lng: undefined,
            pendingAddress: false,
          };
      const { [oldKey]: _removed, ...rest } = prev.entries;
      return {
        ...prev,
        entries: { ...rest, [newKey]: merged },
        todayDeliveredKeys: prev.todayDeliveredKeys.map((k) =>
          k === oldKey ? newKey : k
        ),
      };
    });
    return true;
  }, []);

  const setAutoRemember = useCallback((on) => {
    setAddressBook((prev) =>
      prev.autoRemember === !!on ? prev : { ...prev, autoRemember: !!on }
    );
  }, []);

  // 별칭 설정 — 빈 문자열이면 필드 제거
  const setAlias = useCallback((key, alias) => {
    setAddressBook((prev) => {
      const ex = prev.entries[key];
      if (!ex) return prev;
      const trimmed = (alias || '').trim();
      const updated = { ...ex };
      if (trimmed) updated.alias = trimmed;
      else delete updated.alias;
      return { ...prev, entries: { ...prev.entries, [key]: updated } };
    });
  }, []);

  // 전화번호 설정 — 숫자만 저장. 빈 문자열이면 필드 제거
  const setPhone = useCallback((key, phone) => {
    setAddressBook((prev) => {
      const ex = prev.entries[key];
      if (!ex) return prev;
      const digits = (phone || '').replace(/\D/g, '');
      const updated = { ...ex };
      if (digits) updated.phone = digits;
      else delete updated.phone;
      return { ...prev, entries: { ...prev.entries, [key]: updated } };
    });
  }, []);

  return {
    addressBook,
    setAddressBook,
    bumpAddress,
    markAddressDeliveredToday,
    pinAddress,
    deleteAddress,
    setAutoRemember,
    setAlias,
    setPhone,
    addAddress,
    addPhoneOnly,
    editLabel,
  };
}

// 저장된 digits → 표시용 (01012341234 → 010-1234-1234). placeholder label 에 사용.
function formatPhoneDigits(digits) {
  const d = (digits || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('010')) {
    return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  }
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
  return d;
}
