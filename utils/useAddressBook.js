import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sanitizeDeliveryAddress } from './validate';
import { localDateString, normalizeAddressKey } from './orderHelpers';
import {
  geocodeAddress,
  isGeocodingAvailable,
  isCoordNearCenter,
  isDrivingMSane,
  distanceKm,
  MAX_DELIVERY_RADIUS_KM,
} from './geocode';
import { useStore } from './StoreContext';
import {
  hasPhoneDigitsAnywhere,
  mergeOrphanPhoneOnlyEntries,
} from './addressBookMigrations';

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

  // 2026-05-25: 옛 데이터 1회 청소 — 같은 휴대폰의 정식 entry 와 phone-only entry
  // (__phone:digits) 가 중복 존재하면 phone-only 삭제. addPhoneOnly 의 옛 가드
  // 결함으로 누적된 케이스 자동 복구. hydrate 가 지연될 수 있으므로 entries 비어
  // 있으면 다음 변화 기다림. 한 번 통합 후 ranRef 로 마크 — 영업 중 신규 생성은
  // 강화된 가드가 차단하므로 추가 실행 불필요.
  const migrationRanRef = useRef(false);
  useEffect(() => {
    if (migrationRanRef.current) return;
    const entries = addressBook.entries;
    if (!entries || Object.keys(entries).length === 0) return;
    const merged = mergeOrphanPhoneOnlyEntries(entries);
    if (merged !== entries) {
      setAddressBook((prev) =>
        prev.entries === entries ? { ...prev, entries: merged } : prev
      );
    }
    migrationRanRef.current = true;
  }, [addressBook.entries]);

  // ── 좌표 자동 변환 (lazy + fire-and-forget) ─────────────────────
  // entry 에 lat 없으면 백그라운드로 카카오 호출 → 결과 저장.
  // inFlight: 중복 호출 방지. failed: 일시 실패 마킹 — 메모리 only 라 앱 재시작 시 재시도.
  //
  // 2026-05-28: 카카오 응답 좌표 검증 — 매장 좌표 기준 30 km 초과면 reject.
  // 사장님 신고 "엄마선지 300km" 사고: "엄마선지" 만 입력하면 카카오 keyword 검색이
  // 충청도 동명 매장 좌표 (lat 36.97/lng 126.92) 를 반환해 매장(부산)에서 347km 가
  // 정확히 계산돼 박힘. 좌표 단에서 막아야 Firestore 잠복 entry 가 안 생긴다.
  const { storeInfo } = useStore();
  const storeCoord = useMemo(() => {
    if (typeof storeInfo?.lat === 'number' && typeof storeInfo?.lng === 'number') {
      return { lat: storeInfo.lat, lng: storeInfo.lng };
    }
    return null;
  }, [storeInfo?.lat, storeInfo?.lng]);
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
        // 매장 좌표 기준 합리 반경 검증. 매장 좌표 미설정이면 skip (true).
        if (!isCoordNearCenter(result, storeCoord, MAX_DELIVERY_RADIUS_KM)) {
          failedRef.current.add(entry.key);
          if (typeof console !== 'undefined') {
            console.warn(
              `[useAddressBook] geocode 응답 ${MAX_DELIVERY_RADIUS_KM}km 반경 초과 — reject`,
              { key: entry.key, label: entry.label, result, storeCoord }
            );
          }
          return;
        }
        setAddressBook((prev) => {
          const ex = prev.entries[entry.key];
          if (!ex || typeof ex.lat === 'number') return prev;
          // 좌표 채울 때 옛 drivingM 잔재(이전 좌표 기준) 도 같이 무효화.
          // 보통 lat 없는 entry 에 drivingM 없지만 마이그레이션/수동 편집 잔재 대응.
          const next = { ...ex, lat: result.lat, lng: result.lng };
          delete next.drivingM;
          delete next.drivingDurationSec;
          delete next.drivingFromLat;
          delete next.drivingFromLng;
          return {
            ...prev,
            entries: { ...prev.entries, [entry.key]: next },
          };
        });
      });
    }
  }, [addressBook.entries, storeCoord]);

  // 매장 좌표 변경 시 in-flight/failed 캐시 리셋 — 새 좌표 기준으로 재시도.
  useEffect(() => {
    inFlightRef.current.clear();
    failedRef.current.clear();
  }, [storeCoord?.lat, storeCoord?.lng]);

  // 2026-05-28: 부팅 1회 — 잠복 비정상 좌표/거리 자동 청소.
  // 사장님 매장 사례:
  //   ① "엄마선지" entry 좌표가 충청도(36.97, 126.92) 로 잘못 매칭돼
  //      부산 매장↔충청도 = 347km 가 drivingM 으로 박힘.
  //   ② 같은 alias 의 *부산 정상 좌표* entry 에도 옛 잘못된 drivingM 잔재.
  // 부팅 시 한 번에:
  //   - 매장 30km 반경 벗어난 좌표 → lat/lng/drivingM 모두 reset.
  //     사용자가 entry 편집해서 정확한 도로명 입력하면 useAddressBook 의 lazy
  //     geocode 가 정상 좌표로 다시 잡음.
  //   - 좌표는 정상인데 drivingM 만 비정상 → drivingM 만 reset.
  //     AddressBookPanel 의 lazy fetch 가 다음 마운트 때 카카오 모빌리티 재호출.
  // 한 번 실행 마크 후 종료 — 영업 중 새로 박히는 잘못된 값은 위 effect 가드가 차단.
  const drivingCleanupRanRef = useRef(false);
  useEffect(() => {
    if (drivingCleanupRanRef.current) return;
    if (!storeCoord) return;
    const entries = addressBook.entries;
    if (!entries || Object.keys(entries).length === 0) return;
    let cleaned = null;
    for (const [k, ex] of Object.entries(entries)) {
      const hasCoord = typeof ex.lat === 'number' && typeof ex.lng === 'number';
      const coordInRange = hasCoord
        ? isCoordNearCenter({ lat: ex.lat, lng: ex.lng }, storeCoord, MAX_DELIVERY_RADIUS_KM)
        : true;
      const straightKm = hasCoord && coordInRange
        ? distanceKm(storeCoord, { lat: ex.lat, lng: ex.lng })
        : null;
      const drivingBad =
        typeof ex.drivingM === 'number' && !isDrivingMSane(ex.drivingM, straightKm);
      if (coordInRange && !drivingBad) continue;
      if (!cleaned) cleaned = { ...entries };
      const next = { ...ex };
      if (!coordInRange) {
        delete next.lat;
        delete next.lng;
      }
      delete next.drivingM;
      delete next.drivingDurationSec;
      delete next.drivingFromLat;
      delete next.drivingFromLng;
      cleaned[k] = next;
      if (typeof console !== 'undefined') {
        console.warn('[useAddressBook] 잠복 비정상 entry 청소', {
          key: k,
          coordInRange,
          drivingM: ex.drivingM,
          straightKm,
        });
      }
    }
    if (cleaned) {
      setAddressBook((prev) =>
        prev.entries === entries ? { ...prev, entries: cleaned } : prev
      );
    }
    drivingCleanupRanRef.current = true;
  }, [addressBook.entries, storeCoord]);

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
  // label 필수. alias, phone, customerRequest 는 선택.
  const addAddress = useCallback((label, alias, phone, customerRequest) => {
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
      if (customerRequest?.trim()) entry.customerRequest = customerRequest.trim();
      return { ...prev, entries: { ...prev.entries, [key]: entry } };
    });
    return true;
  }, []);

  // 전화번호만 있는 미완성 entry — CID 신규 번호 / "나중에 주소 채움" 용.
  // 같은 phone digits 가 어디에 등록돼 있으면 noop. key 는 __phone:digits 패턴으로
  // normalizeAddressKey 충돌 방지. pendingAddress=true 플래그로 UI 가 강조 표시.
  //
  // 2026-05-25: 옛 가드는 e.phone 단일 필드만 검사 → phones array 만 있고 phone
  // 단일이 비어있는 정식 entry 의 휴대폰을 CID 가 받으면 가드 통과 → phone-only
  // entry 가 별도 생성됨 → CID 매칭 시 그게 먼저 잡혀 별칭 없이 전번만 표시
  // (동진카에어컨 사례). hasPhoneDigitsAnywhere 가 phones array 도 같이 검사.
  const addPhoneOnly = useCallback((phone, alias) => {
    const digits = (phone || '').replace(/\D/g, '');
    if (!digits) return false;
    const key = `__phone:${digits}`;
    const formatted = formatPhoneDigits(digits);
    const placeholder = `(주소 미입력) ${formatted}`;
    setAddressBook((prev) => {
      if (hasPhoneDigitsAnywhere(prev.entries, digits)) return prev;
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

  // 전화번호 설정 — 숫자만 저장. 빈 문자열이면 필드 제거.
  // 2026-05-16: phones array 도입 후에도 단일 phone 도 같이 sync (옛 코드 호환).
  // 단일 set 은 phones 의 첫 번째 도 같이 갱신.
  const setPhone = useCallback((key, phone) => {
    setAddressBook((prev) => {
      const ex = prev.entries[key];
      if (!ex) return prev;
      const digits = (phone || '').replace(/\D/g, '');
      const updated = { ...ex };
      if (digits) {
        updated.phone = digits;
        // phones array 도 첫 번째로 갱신 (다른 번호 보존)
        const others = Array.isArray(ex.phones)
          ? ex.phones.filter((p) => (p || '').replace(/\D/g, '') !== digits)
          : [];
        updated.phones = [digits, ...others];
      } else {
        delete updated.phone;
        delete updated.phones;
      }
      return { ...prev, entries: { ...prev.entries, [key]: updated } };
    });
  }, []);

  // phones array 통째 설정 — 한 entry 에 휴대폰 + 일반전화 같이 저장.
  // 빈 array 또는 모두 빈 문자열 → phones / phone 둘 다 제거.
  // 첫 번째 phone 은 옛 phone 필드에도 sync (CID listing / 옛 코드 호환).
  const setPhones = useCallback((key, phones) => {
    setAddressBook((prev) => {
      const ex = prev.entries[key];
      if (!ex) return prev;
      const cleaned = (Array.isArray(phones) ? phones : [])
        .map((p) => String(p || '').replace(/\D/g, ''))
        .filter(Boolean);
      // 중복 제거 (digits 기준)
      const uniq = [];
      for (const d of cleaned) if (!uniq.includes(d)) uniq.push(d);
      const updated = { ...ex };
      if (uniq.length === 0) {
        delete updated.phone;
        delete updated.phones;
      } else {
        updated.phones = uniq;
        updated.phone = uniq[0]; // 호환 sync
      }
      return { ...prev, entries: { ...prev.entries, [key]: updated } };
    });
  }, []);

  // 한 phone 만 추가 — 기존 phones 에 append (중복 제외).
  const addPhone = useCallback((key, phone) => {
    setAddressBook((prev) => {
      const ex = prev.entries[key];
      if (!ex) return prev;
      const d = String(phone || '').replace(/\D/g, '');
      if (!d) return prev;
      const existing = Array.isArray(ex.phones)
        ? ex.phones.map((p) => String(p || '').replace(/\D/g, '')).filter(Boolean)
        : (ex.phone ? [String(ex.phone).replace(/\D/g, '')] : []);
      if (existing.includes(d)) return prev;
      const next = [...existing, d];
      return {
        ...prev,
        entries: {
          ...prev.entries,
          [key]: { ...ex, phone: next[0], phones: next },
        },
      };
    });
  }, []);

  // 한 phone 제거.
  const removePhone = useCallback((key, phone) => {
    setAddressBook((prev) => {
      const ex = prev.entries[key];
      if (!ex) return prev;
      const d = String(phone || '').replace(/\D/g, '');
      if (!d) return prev;
      const existing = Array.isArray(ex.phones)
        ? ex.phones.map((p) => String(p || '').replace(/\D/g, '')).filter(Boolean)
        : (ex.phone ? [String(ex.phone).replace(/\D/g, '')] : []);
      const next = existing.filter((p) => p !== d);
      const updated = { ...ex };
      if (next.length === 0) {
        delete updated.phone;
        delete updated.phones;
      } else {
        updated.phones = next;
        updated.phone = next[0];
      }
      return { ...prev, entries: { ...prev.entries, [key]: updated } };
    });
  }, []);

  // 단골요청 설정 — 자주 시키는 손님의 패턴 (예: "다진고추, 김치많이").
  // 주문 화면 / 주문현황 / 영수증에 자동 노출 — 주방·라이더가 미리 준비.
  // 빈 문자열이면 필드 제거.
  const setCustomerRequest = useCallback((key, request) => {
    setAddressBook((prev) => {
      const ex = prev.entries[key];
      if (!ex) return prev;
      const trimmed = (request || '').trim().slice(0, 100);
      const updated = { ...ex };
      if (trimmed) updated.customerRequest = trimmed;
      else delete updated.customerRequest;
      return { ...prev, entries: { ...prev.entries, [key]: updated } };
    });
  }, []);

  // 2026-05-25 사장님 요청: 주문 확정 시 사장님이 입력한 alias/phone 가 자동으로
  // 주소 entry 에 sync. 같은 phone 의 CID phone-only entry 가 있으면 통합 (삭제).
  // alias 가 이미 채워져 있으면 덮어쓰기 X — 사장님 명시 편집으로만 변경.
  const upsertEntryFromOrder = useCallback(({ address, alias, phone, customerRequest } = {}) => {
    const safeAddr = sanitizeDeliveryAddress(address);
    const safeAlias = String(alias || '').trim().slice(0, 30);
    const digits = String(phone || '').replace(/\D/g, '');
    if (!safeAddr) return null;
    const key = normalizeAddressKey(safeAddr);
    if (!key) return null;

    setAddressBook((prev) => {
      const entries = { ...prev.entries };
      const existing = entries[key];

      if (existing) {
        // 주소 entry 있음 — alias/phones 빈 경우 채움 (덮어쓰기 X)
        const next = { ...existing };
        if (safeAlias && !next.alias) next.alias = safeAlias;
        if (digits) {
          const phones = Array.isArray(next.phones)
            ? next.phones.map((p) => String(p).replace(/\D/g, '')).filter(Boolean)
            : (next.phone ? [String(next.phone).replace(/\D/g, '')] : []);
          if (!phones.includes(digits)) {
            phones.push(digits);
            next.phones = phones;
            if (!next.phone) next.phone = digits;
          }
        }
        if (customerRequest && !next.customerRequest) {
          next.customerRequest = String(customerRequest).trim().slice(0, 100);
        }
        entries[key] = next;
      } else {
        // 주소 entry 없음 — 새 entry
        const entry = {
          key,
          label: safeAddr,
          count: 0,
          pinned: false,
          firstSeenAt: Date.now(),
          lastUsedAt: Date.now(),
        };
        if (safeAlias) entry.alias = safeAlias;
        if (digits) {
          entry.phone = digits;
          entry.phones = [digits];
        }
        if (customerRequest) {
          entry.customerRequest = String(customerRequest).trim().slice(0, 100);
        }
        entries[key] = entry;
      }

      // CID phone-only entry (__phone:digits) 가 있으면 통합 삭제 — 위에서 alias/phone 채움
      if (digits) {
        const cidKey = `__phone:${digits}`;
        if (entries[cidKey]) {
          delete entries[cidKey];
        }
      }

      return { ...prev, entries };
    });
    return key;
  }, []);

  // 사장님 "진실 → 진실보석 매칭" confirm 시 호출. 기존 entry 에 phone 추가
  // + alias 가 비어있으면 입력한 alias 로 채움 + CID phone-only entry 통합.
  const mergePhoneIntoEntry = useCallback((targetKey, phone, alias) => {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!targetKey) return false;
    setAddressBook((prev) => {
      const ex = prev.entries[targetKey];
      if (!ex) return prev;
      const updated = { ...ex };
      if (digits) {
        const phones = Array.isArray(updated.phones)
          ? updated.phones.map((p) => String(p).replace(/\D/g, '')).filter(Boolean)
          : (updated.phone ? [String(updated.phone).replace(/\D/g, '')] : []);
        if (!phones.includes(digits)) {
          phones.push(digits);
          updated.phones = phones;
          if (!updated.phone) updated.phone = digits;
        }
      }
      const safeAlias = String(alias || '').trim().slice(0, 30);
      if (safeAlias && !updated.alias) updated.alias = safeAlias;

      const newEntries = { ...prev.entries, [targetKey]: updated };
      if (digits) {
        const cidKey = `__phone:${digits}`;
        if (newEntries[cidKey]) delete newEntries[cidKey];
      }
      return { ...prev, entries: newEntries };
    });
    return true;
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
    setPhones,
    addPhone,
    removePhone,
    setCustomerRequest,
    addAddress,
    addPhoneOnly,
    editLabel,
    upsertEntryFromOrder,
    mergePhoneIntoEntry,
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
