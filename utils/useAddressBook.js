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
  mergeSameAliasPhoneOnlyEntries,
} from './addressBookMigrations';
import { similarPairKey } from './addressBookCleanup';

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
    // 2026-06-05: "비슷한 상호" 후보 중 사장님이 "다른 가게" 로 확정한 쌍 키 목록.
    //   findSimilarAliasPairs 가 제외 → 다음부터 안 뜸. 매장 공용(Firestore sync).
    ignoredSimilarPairs: [],
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
  // 2026-05-28: migrationRanRef 제거 — 옛 빌드에서 ranRef true 박힌 상태로 hydrate
  // 되면 새 청소 effect 가 실행 자체 안 됨. 청소 함수는 idempotent (통합 완료면
  // 같은 reference 반환) 라 무한 루프 없음. setAddressBook 가드도 ref 비교로 noop.
  useEffect(() => {
    const entries = addressBook.entries;
    if (!entries || Object.keys(entries).length === 0) return;
    // 1단계: phone 매칭 기준 orphan phone-only 통합
    let merged = mergeOrphanPhoneOnlyEntries(entries);
    // 2단계: alias 매칭 기준 phone-only-like → 정식 entry 통합
    //   ("(주소 미입력)" label 패턴 + __phone: key prefix 둘 다 phone-only 식별)
    merged = mergeSameAliasPhoneOnlyEntries(merged);
    if (merged !== entries) {
      const removed = Object.keys(entries).length - Object.keys(merged).length;
      if (typeof console !== 'undefined') {
        console.warn(`[useAddressBook] 주소록 자동 통합 — ${removed}건 정리`, {
          before: Object.keys(entries).length,
          after: Object.keys(merged).length,
        });
      }
      setAddressBook((prev) =>
        prev.entries === entries ? { ...prev, entries: merged } : prev
      );
    }
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
      // 2026-05-28: 사장님 사고 "신한철물 311km 박힘" 영구 처방.
      //   center 옵션 전달 → geocodeAddress 가 keyword 검색을 *반경 제한* 으로 분기.
      //   처음부터 반경 밖 결과 reject — 전국 검색 절대 금지.
      const geocodeOpts = storeCoord
        ? { center: storeCoord, radius: MAX_DELIVERY_RADIUS_KM * 1000 }
        : {};
      geocodeAddress(entry.label, geocodeOpts).then((result) => {
        inFlightRef.current.delete(entry.key);
        if (!result) {
          failedRef.current.add(entry.key);
          return;
        }
        // 매장 좌표 기준 합리 반경 검증 (이중 가드). 매장 좌표 미설정이면 skip.
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
  // 2026-05-28 (2부): 사장님 신고 "주소 확실한데도 거리 오류 표시. 일일이 수정 못함".
  //   원인: 매장 좌표 미설정 (storeInfo.lat/lng 빈 값) → 옛 가드 `if (!storeCoord) return;`
  //   로 effect 가 즉시 종료 → 잘못된 drivingM 잔재가 영구 박혀있음.
  //
  //   처방: storeCoord 없어도 drivingM 절대 임계 (isDrivingMSane 의 10km 한도) 만으로
  //   reset. 좌표 자체는 매장 좌표 없으면 정상성 판단 불가 → 그대로 둠. drivingM 만
  //   비우면 AddressBookPanel 의 lazy fetch 가 다음 마운트 때 카카오 모빌리티 재호출.
  //   (단 카카오 KEY 도 미설정이면 재호출 자체 안 됨 — 사장님이 매장 좌표 + 카카오
  //   KEY 둘 다 설정해야 재계산 완성.)
  const drivingCleanupRanRef = useRef(false);
  useEffect(() => {
    if (drivingCleanupRanRef.current) return;
    const entries = addressBook.entries;
    if (!entries || Object.keys(entries).length === 0) return;
    let cleaned = null;
    for (const [k, ex] of Object.entries(entries)) {
      const hasCoord = typeof ex.lat === 'number' && typeof ex.lng === 'number';
      // storeCoord 없으면 coordInRange 판단 불가 → 좌표는 정상 가정 (변경 X).
      const coordInRange = hasCoord && storeCoord
        ? isCoordNearCenter({ lat: ex.lat, lng: ex.lng }, storeCoord, MAX_DELIVERY_RADIUS_KM)
        : true;
      const straightKm = hasCoord && coordInRange && storeCoord
        ? distanceKm(storeCoord, { lat: ex.lat, lng: ex.lng })
        : null;
      // storeCoord 없어도 isDrivingMSane 는 절대 임계 (10km) 검사 — 잔재 정리 가능.
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
  // 2026-05-29: 사장님 결정 — "자동 기억" 토글 제거 + 항상 카운트.
  //   옛 autoRemember off 분기(카운트 안 늘림) 제거. 주소 자체는 upsertEntryFromOrder
  //   가 주문 확정 시 항상 등록하므로, 토글은 "주문 횟수 카운트" 만 제어하던 잔재였음.
  //   이제 항상 카운트 → "×N회" + "주문횟수" 정렬이 늘 의미 있음.
  const bumpAddress = useCallback((label) => {
    const safe = sanitizeDeliveryAddress(label);
    if (!safe) return;
    const key = normalizeAddressKey(safe);
    if (!key) return;
    setAddressBook((prev) => {
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
  //
  // 2026-05-28 (2부): 사장님 신고 "모래톱 entry 2개". 사장님이 + 추가 폼의 주소 칸에
  //   별칭만 입력 → label=alias 박힌 pseudo-phone-only entry 생성. 같은 alias 의
  //   진짜 주소 entry 와 공존 사고.
  //
  //   가드: label === alias 호출이고, 같은 alias 의 *진짜 주소* entry (label !== alias)
  //   이미 존재하면, 신규 생성 X. 대신 phone digits 가 있으면 기존 entry 에 phones
  //   array 로 추가 + customerRequest 도 비어있으면 채움. 사장님 의도 ("같은 손님
  //   추가 정보 등록") 흡수.
  const addAddress = useCallback((label, alias, phone, customerRequest) => {
    const safe = sanitizeDeliveryAddress(label);
    if (!safe) return false;
    const key = normalizeAddressKey(safe);
    if (!key) return false;
    const digits = (phone || '').replace(/\D/g, '');
    const safeAlias = (alias || '').trim();
    const safeRequest = (customerRequest || '').trim();
    setAddressBook((prev) => {
      if (prev.entries[key]) return prev; // 이미 존재하면 무시
      // 신규 차단: label=alias 이고 같은 alias 의 진짜 주소 entry 가 있으면
      // 그 entry 에 phone/request 만 추가, pseudo entry 신규 생성 X.
      if (safeAlias && safe === safeAlias) {
        for (const exKey of Object.keys(prev.entries)) {
          const ex = prev.entries[exKey];
          if (!ex || (ex.alias || '').trim() !== safeAlias) continue;
          if ((ex.label || '').trim() === safeAlias) continue; // 그 entry 도 pseudo — 통합 대상 아님
          // 진짜 주소 entry 발견 → 정보만 흡수
          const next = { ...ex };
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
          if (safeRequest && !next.customerRequest) {
            next.customerRequest = safeRequest.slice(0, 100);
          }
          if (typeof console !== 'undefined') {
            console.warn(
              `[useAddressBook] addAddress 차단 — label=alias "${safeAlias}" 의 진짜 주소 entry "${ex.label}" 에 정보 흡수`
            );
          }
          return { ...prev, entries: { ...prev.entries, [exKey]: next } };
        }
      }
      const entry = {
        key,
        label: safe,
        count: 0,
        pinned: false,
        firstSeenAt: Date.now(),
        lastUsedAt: Date.now(),
      };
      if (safeAlias) entry.alias = safeAlias;
      if (digits) entry.phone = digits;
      if (safeRequest) entry.customerRequest = safeRequest;
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

  // 2026-06-05: "비슷한 상호" 후보를 "다른 가게" 로 확정 → 무시 목록에 추가.
  //   findSimilarAliasPairs 가 제외하므로 다음 정리부터 안 뜸.
  // 2026-06-09: 쌍 키 = 상호명(alias) 정규화 쌍. entry key 는 대표 선택(count 등)에 따라
  //   바뀌어 무시가 풀리던 버그(진실보석 단골 계속 뜸) → 사용자가 본 상호 이름으로 고정.
  const ignoreSimilarPair = useCallback((aliasA, aliasB) => {
    if (!aliasA || !aliasB) return;
    const pairKey = similarPairKey(aliasA, aliasB);
    setAddressBook((prev) => {
      const cur = Array.isArray(prev.ignoredSimilarPairs)
        ? prev.ignoredSimilarPairs
        : [];
      if (cur.includes(pairKey)) return prev;
      return { ...prev, ignoredSimilarPairs: [...cur, pairKey] };
    });
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
  //
  // 2026-05-28: 반환값 확장 — 호출부가 Toast 알림 텍스트 결정에 사용.
  //   { key, action: 'created'|'updated'|'noop', phoneAdded, aliasAdded,
  //     finalAlias, finalLabel, finalPhone } | null
  //   - action='created': 신규 entry 생성. 사장님 알림 "신규 저장".
  //   - action='updated': 기존 entry 에 phone/alias 추가. "추가 저장".
  //   - action='noop': 변경 없음 (이미 같은 정보 등록). 사장님 알림 X 또는 "이미 등록됨".
  const upsertEntryFromOrder = useCallback(({ address, alias, phone, customerRequest } = {}) => {
    const safeAddr = sanitizeDeliveryAddress(address);
    const safeAlias = String(alias || '').trim().slice(0, 30);
    const digits = String(phone || '').replace(/\D/g, '');
    if (!safeAddr) return null;
    const key = normalizeAddressKey(safeAddr);
    if (!key) return null;

    // 2026-06-12: 휴지통 가드 — 삭제 후 24시간 내 같은 키 자동 재등록 금지 (좀비 영구처방).
    // 주문 칸에 실려있던 옛 주소가 확정/결제 순간 주소록을 되살리던 경로를 전 기기에서 차단.
    // 사장님 수동 등록(addAddress)은 이 가드를 안 타므로 의도적 재등록은 그대로 가능.
    const tombs = addressBook?.deletedTombstones || {};
    const TOMB_BLOCK_MS = 24 * 60 * 60 * 1000;
    const tombAt = tombs[key] || (digits ? tombs[`__phone:${digits}`] : 0);
    if (tombAt && Date.now() - tombAt < TOMB_BLOCK_MS) return null;

    // closure 시점 결과 계산 — setAddressBook 콜백은 비동기라 즉시 결과 반환 어려움.
    // 호출 시점 entries snapshot 으로 action 결정. 호출 빈도 낮아 race 위험 무시.
    const snapEntries = addressBook?.entries || {};
    const snapExisting = snapEntries[key];
    let action = 'noop';
    let phoneAdded = false;
    let aliasAdded = false;
    if (!snapExisting) {
      action = 'created';
      phoneAdded = !!digits;
      aliasAdded = !!safeAlias;
    } else {
      if (safeAlias && !snapExisting.alias) {
        aliasAdded = true;
        action = 'updated';
      }
      if (digits) {
        const exDigits = Array.isArray(snapExisting.phones)
          ? snapExisting.phones.map((p) => String(p).replace(/\D/g, '')).filter(Boolean)
          : (snapExisting.phone ? [String(snapExisting.phone).replace(/\D/g, '')] : []);
        if (!exDigits.includes(digits)) {
          phoneAdded = true;
          action = 'updated';
        }
      }
    }

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
    const finalAlias = (snapExisting?.alias || safeAlias || '').trim();
    const finalLabel = snapExisting?.label || safeAddr;
    const finalPhone = digits || snapExisting?.phone || '';
    return { key, action, phoneAdded, aliasAdded, finalAlias, finalLabel, finalPhone };
  }, [addressBook]);

  // 사장님 "진실 → 진실보석 매칭" confirm 시 호출. 기존 entry 에 phone 추가
  // + alias 가 비어있으면 입력한 alias 로 채움 + CID phone-only entry 통합.
  //
  // 2026-05-28: 반환값 확장 — Toast 알림 텍스트 결정용.
  //   { key, phoneAdded, aliasAdded, finalAlias, finalLabel } | false (targetKey 없음)
  const mergePhoneIntoEntry = useCallback((targetKey, phone, alias) => {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!targetKey) return false;
    // closure 시점 결과 계산
    const snapEx = addressBook?.entries?.[targetKey];
    if (!snapEx) return false;
    const safeAlias = String(alias || '').trim().slice(0, 30);
    let phoneAdded = false;
    let aliasAdded = false;
    if (digits) {
      const exDigits = Array.isArray(snapEx.phones)
        ? snapEx.phones.map((p) => String(p).replace(/\D/g, '')).filter(Boolean)
        : (snapEx.phone ? [String(snapEx.phone).replace(/\D/g, '')] : []);
      if (!exDigits.includes(digits)) phoneAdded = true;
    }
    if (safeAlias && !snapEx.alias) aliasAdded = true;

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
      if (safeAlias && !updated.alias) updated.alias = safeAlias;

      const newEntries = { ...prev.entries, [targetKey]: updated };
      if (digits) {
        const cidKey = `__phone:${digits}`;
        if (newEntries[cidKey]) delete newEntries[cidKey];
      }
      return { ...prev, entries: newEntries };
    });
    return {
      key: targetKey,
      phoneAdded,
      aliasAdded,
      finalAlias: snapEx.alias || safeAlias || '',
      finalLabel: snapEx.label || '',
    };
  }, [addressBook]);

  return {
    addressBook,
    setAddressBook,
    bumpAddress,
    markAddressDeliveredToday,
    pinAddress,
    deleteAddress,
    setAutoRemember,
    ignoreSimilarPair,
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
