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
  serverOrdersSeenRef,
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
      // 2026-07-08: 🔴 완료 테이블 부활 근본처방 — 로컬 주문 복원 게이트.
      //   Firestore 첫 주문 snapshot 이 이미 도착했으면(서버가 말했으면) AsyncStorage 의
      //   옛 주문 사본은 버린다. 안 그러면 이 복원이 서버로 갱신된 깨끗한 state 를 통째로
      //   덮어쓰고(hydrate 는 lastSynced 없는 전체 교체) push 게이트를 통과해 서버로 되밀려
      //   → 다른 기기에서 비운 테이블이 전 기기에서 부활했다 (주소록 entries 6/9 처방과 동형).
      //   await loadMany 이후 여기까진 yield 없는 동기 구간 → snapshot 콜백과 원자적:
      //     ref=true  → 서버 이미 도착, 로컬 폐기 (부활 차단)
      //     ref=false → 아직 서버 전 → 로컬로 즉시 표시(오프라인 부팅 무손실), 곧 올 첫
      //                 snapshot 이 전체 교체하므로 stale 이 남지 않음.
      const serverAlreadySpoke = !!(serverOrdersSeenRef && serverOrdersSeenRef.current);
      if (!serverAlreadySpoke && data.orders && typeof data.orders === 'object') {
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
          // 2026-06-10: "다른 가게" 무시목록은 Firestore 가 아니라 AsyncStorage 로 영속
          //   (union Firestore sync 무한루프 사고 후 격리). 앱 재시작 시 여기서 복원 —
          //   entries 와 달리 무시목록은 다기기 false-diff 부활 위험이 없어 로컬 복원 안전.
          ignoredSimilarPairs: Array.isArray(loaded.ignoredSimilarPairs)
            ? loaded.ignoredSimilarPairs
            : prev.ignoredSimilarPairs,
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
  // 2026-07-03: 🔴 카운터 PC 40초 멈춤 근본 처방. 매출이력(history)이 1000건까지
  //   차서 revenue 객체가 579KB. 옛 코드는 *매 결제마다* 이 덩어리 전체를 localStorage
  //   에 통째 직렬화·쓰기(동기 블로킹) → 저사양 PC 40초 얼어붙음.
  //   history 는 Firestore(+오프라인 캐시)가 단일 진실 — 부팅 시 listener 가 채우므로
  //   localStorage 엔 total 만 저장. deps 도 revenue.total 로 좁혀 history 변경(매 결제)
  //   으로는 저장 effect 자체가 안 돈다. 매출 데이터 손실 0(Firestore 원본 그대로).
  //   부팅 게이트(snapshotSeenRef)가 첫 pull 전 push 를 막아 history 소실 위험 없음.
  useEffect(() => {
    if (hydrated) saver('revenue', { total: revenue.total });
  }, [revenue.total, hydrated, saver]);
  useEffect(() => {
    if (hydrated) saver('addressBook', addressBook);
  }, [addressBook, hydrated, saver]);

  return hydrated;
}
