// OrderContext 의 모든 매장 공유 데이터를 Firestore 와 양방향 동기화.
//
// 동기화 대상:
//   - orders   ↔ stores/{sid}/orders/{tableId} 컬렉션 (테이블별 1 문서)
//   - splits   ↔ stores/{sid}/state/splits 단일 문서
//   - groups   ↔ stores/{sid}/state/groups 단일 문서
//   - revenue.total   ↔ stores/{sid}/state/revenueTotal
//   - revenue.history ↔ stores/{sid}/history/{id} 컬렉션
//   - addressBook.entries ↔ stores/{sid}/addresses/{key} 컬렉션
//   - addressBook 메타    ↔ stores/{sid}/state/addressBookMeta
//
// 패턴:
//   - source-of-truth = Firestore listener
//   - 사용자 mutation 으로 state 변경 → diff 기반 batch write (디바운스)
//   - listener 가 자기 write 를 받아 setState 해도 lastSyncedRef === state 라
//     write effect 가 noop → 무한 루프 방지
//   - AsyncStorage(useOrderPersistence) 와 듀얼 운영. 안정화 후 제거 가능.

import { useEffect, useRef, useState } from 'react';
import { useStore } from './StoreContext';
import { getFirestore } from './firebase';
import { reportError } from './sentry';
import { snapExists } from './firestoreCompat';
import { setSharedAudioStore } from './sharedAudio';
import { PENDING_TABLE_ID } from './orderReducer';
import { reportWriteFailure, reportWriteSuccess } from './cloudHealth';

const ORDERS_DEBOUNCE_MS = 300;
const HISTORY_DEBOUNCE_MS = 500;
const ADDRESS_DEBOUNCE_MS = 500;
// 2026-06-11: write 실패(한도 초과/네트워크) 시 lastSynced 를 전진시키지 않고 30초 후
// 재시도한다. 이전엔 실패해도 "보낸 셈" 처리해서 차단이 풀려도 영영 안 올라갔다.
const WRITE_RETRY_MS = 30000;

// Firestore document ID 안전 인코딩 (migrateLocalToCloud 와 동일 정책).
function safeDocId(key) {
  if (!key) return '_';
  return String(key).replace(/\//g, '__').slice(0, 1400);
}

export function useOrderFirestoreSync({
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
  const { storeInfo } = useStore();
  const storeId = storeInfo?.storeId || null;

  // 첫 mount 시점 reference 로 초기화 — 첫 effect 가 self-noop.
  const lastSyncedOrdersRef = useRef(orders);
  const lastSyncedSplitsRef = useRef(splits);
  const lastSyncedGroupsRef = useRef(groups);
  const lastSyncedRevenueTotalRef = useRef(revenue.total);
  const lastSyncedHistoryRef = useRef(revenue.history);
  const lastSyncedAddressEntriesRef = useRef(addressBook.entries);
  // 2026-06-10: ignoredSimilarPairs("다른 가게" 무시)는 Firestore 동기화에서 제외한다 —
  //   기기 로컬 state + AsyncStorage 영속만. 이전에 union 으로 Firestore 양방향 sync 했다가
  //   push 비교(참조)가 매번 어긋나 무한 write → 쓰기 한도 폭발 사고. 무시목록은 기기별로 두고
  //   (각 기기에서 한 번씩 "다른 가게") Firestore 에 안 쓰면 무한루프가 원천 불가능.
  const lastSyncedAddressMetaRef = useRef({
    todayDate: addressBook.todayDate,
    todayDeliveredKeys: addressBook.todayDeliveredKeys,
    autoRemember: addressBook.autoRemember,
  });

  const ordersDebounceRef = useRef(null);
  const historyDebounceRef = useRef(null);
  const addressEntriesDebounceRef = useRef(null);

  // ── write 실패 재시도 ────────────────────────────────────────
  // 실패 시 retryTick 을 올려 모든 write effect 를 다시 돌린다. lastSynced 가 전진하지
  // 않았으므로 밀린 diff 가 통째로 재전송된다. 성공/echo 로 ref 가 따라잡으면 noop —
  // setState 가 없는 한 effect 는 가만히 있으므로 무한 재시도 폭주는 구조상 불가.
  const [retryTick, setRetryTick] = useState(0);
  const retryTimerRef = useRef(null);
  const scheduleRetry = () => {
    if (retryTimerRef.current) return;
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      setRetryTick((t) => t + 1);
    }, WRITE_RETRY_MS);
  };
  useEffect(
    () => () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    },
    []
  );

  // 매장 공유 음성/사운드 dispatcher 활성. storeId 가 바뀌면 listener 재등록.
  useEffect(() => {
    setSharedAudioStore(storeId);
    return () => setSharedAudioStore(null);
  }, [storeId]);

  // ── Listeners ───────────────────────────────────────────────
  useEffect(() => {
    if (!storeId) return;
    const db = getFirestore();
    if (!db) return;
    const storeRef = db.collection('stores').doc(storeId);

    const unsubOrders = storeRef.collection('orders').onSnapshot(
      (snap) => {
        const next = {};
        snap.docs.forEach((d) => {
          next[d.id] = d.data();
        });
        dispatch({ type: 'orders/hydrate', payload: next });
        lastSyncedOrdersRef.current = next;
      },
      (err) => reportError(err, { ctx: 'orders.listener' })
    );

    const unsubSplits = storeRef
      .collection('state')
      .doc('splits')
      .onSnapshot(
        (snap) => {
          if (!snapExists(snap)) return;
          const data = snap.data();
          if (data?.value !== undefined) {
            setSplits(data.value);
            lastSyncedSplitsRef.current = data.value;
          }
        },
        (err) => reportError(err, { ctx: 'splits.listener' })
      );

    const unsubGroups = storeRef
      .collection('state')
      .doc('groups')
      .onSnapshot(
        (snap) => {
          if (!snapExists(snap)) return;
          const data = snap.data();
          if (data?.value !== undefined) {
            setGroups(data.value);
            lastSyncedGroupsRef.current = data.value;
          }
        },
        (err) => reportError(err, { ctx: 'groups.listener' })
      );

    const unsubRevTotal = storeRef
      .collection('state')
      .doc('revenueTotal')
      .onSnapshot(
        (snap) => {
          if (!snapExists(snap)) return;
          const data = snap.data();
          if (typeof data?.total === 'number') {
            setRevenue((prev) =>
              prev.total === data.total ? prev : { ...prev, total: data.total }
            );
            lastSyncedRevenueTotalRef.current = data.total;
          }
        },
        (err) => reportError(err, { ctx: 'revenue.total.listener' })
      );

    const unsubHistory = storeRef.collection('history').onSnapshot(
      (snap) => {
        const list = snap.docs
          .map((d) => d.data())
          .filter((h) => h && h.id != null);
        setRevenue((prev) => ({ ...prev, history: list }));
        lastSyncedHistoryRef.current = list;
      },
      (err) => reportError(err, { ctx: 'history.listener' })
    );

    const unsubAddrEntries = storeRef.collection('addresses').onSnapshot(
      (snap) => {
        const entries = {};
        snap.docs.forEach((d) => {
          const data = d.data() || {};
          const key = data._key || d.id;
          // _key 는 Firestore 저장용 메타 — entries 에서는 제외.
          const { _key: _ignore, ...rest } = data;
          entries[key] = rest;
        });
        setAddressBook((prev) => ({ ...prev, entries }));
        lastSyncedAddressEntriesRef.current = entries;
      },
      (err) => reportError(err, { ctx: 'addresses.listener' })
    );

    const unsubAddrMeta = storeRef
      .collection('state')
      .doc('addressBookMeta')
      .onSnapshot(
        (snap) => {
          if (!snapExists(snap)) return;
          const meta = snap.data() || {};
          setAddressBook((prev) => ({
            ...prev,
            todayDate: meta.todayDate || prev.todayDate,
            todayDeliveredKeys: Array.isArray(meta.todayDeliveredKeys)
              ? meta.todayDeliveredKeys
              : [],
            autoRemember:
              typeof meta.autoRemember === 'boolean'
                ? meta.autoRemember
                : prev.autoRemember,
            // ignoredSimilarPairs 는 의도적으로 덮지 않는다 — 로컬 무시목록 보존
            //   (모달 닫았다 열어도 유지). Firestore sync 제외(union 무한루프 사고 후 격리).
          }));
          lastSyncedAddressMetaRef.current = {
            todayDate: meta.todayDate,
            todayDeliveredKeys: meta.todayDeliveredKeys,
            autoRemember: meta.autoRemember,
          };
        },
        (err) => reportError(err, { ctx: 'addressBookMeta.listener' })
      );

    return () => {
      unsubOrders();
      unsubSplits();
      unsubGroups();
      unsubRevTotal();
      unsubHistory();
      unsubAddrEntries();
      unsubAddrMeta();
    };
  }, [storeId, dispatch, setSplits, setGroups, setRevenue, setAddressBook]);

  // ── orders write (diff + 디바운스) ──────────────────────────
  useEffect(() => {
    if (!storeId) return;
    if (orders === lastSyncedOrdersRef.current) return;

    if (ordersDebounceRef.current) clearTimeout(ordersDebounceRef.current);
    ordersDebounceRef.current = setTimeout(() => {
      const db = getFirestore();
      if (!db) return;
      const storeRef = db.collection('stores').doc(storeId);
      const synced = lastSyncedOrdersRef.current || {};
      const batch = db.batch();
      let opCount = 0;

      for (const tid of Object.keys(orders)) {
        // 1.0.51: PENDING_TABLE_ID 는 local-only. 클라우드에 미선택 cart 남기지 않음.
        if (tid === PENDING_TABLE_ID) continue;
        if (orders[tid] !== synced[tid]) {
          batch.set(storeRef.collection('orders').doc(tid), orders[tid]);
          opCount++;
        }
      }
      for (const tid of Object.keys(synced)) {
        if (tid === PENDING_TABLE_ID) continue;
        if (!(tid in orders)) {
          batch.delete(storeRef.collection('orders').doc(tid));
          opCount++;
        }
      }

      if (opCount > 0) {
        batch
          .commit()
          .then(() => {
            lastSyncedOrdersRef.current = orders;
            reportWriteSuccess();
          })
          .catch((e) => {
            reportError(e, { ctx: 'orders.batch.write', opCount });
            reportWriteFailure('orders.batch.write', e);
            scheduleRetry();
          });
      } else {
        lastSyncedOrdersRef.current = orders;
      }
    }, ORDERS_DEBOUNCE_MS);

    return () => {
      if (ordersDebounceRef.current) clearTimeout(ordersDebounceRef.current);
    };
  }, [orders, storeId, retryTick]);

  // ── splits write ────────────────────────────────────────────
  useEffect(() => {
    if (!storeId) return;
    if (splits === lastSyncedSplitsRef.current) return;
    const db = getFirestore();
    if (!db) return;
    db.collection('stores')
      .doc(storeId)
      .collection('state')
      .doc('splits')
      .set({ value: splits })
      .then(() => {
        lastSyncedSplitsRef.current = splits;
        reportWriteSuccess();
      })
      .catch((e) => {
        reportError(e, { ctx: 'splits.write' });
        reportWriteFailure('splits.write', e);
        scheduleRetry();
      });
  }, [splits, storeId, retryTick]);

  // ── groups write ────────────────────────────────────────────
  useEffect(() => {
    if (!storeId) return;
    if (groups === lastSyncedGroupsRef.current) return;
    const db = getFirestore();
    if (!db) return;
    db.collection('stores')
      .doc(storeId)
      .collection('state')
      .doc('groups')
      .set({ value: groups })
      .then(() => {
        lastSyncedGroupsRef.current = groups;
        reportWriteSuccess();
      })
      .catch((e) => {
        reportError(e, { ctx: 'groups.write' });
        reportWriteFailure('groups.write', e);
        scheduleRetry();
      });
  }, [groups, storeId, retryTick]);

  // ── revenue.total write ─────────────────────────────────────
  useEffect(() => {
    if (!storeId) return;
    if (revenue.total === lastSyncedRevenueTotalRef.current) return;
    const db = getFirestore();
    if (!db) return;
    db.collection('stores')
      .doc(storeId)
      .collection('state')
      .doc('revenueTotal')
      .set({ total: revenue.total })
      .then(() => {
        lastSyncedRevenueTotalRef.current = revenue.total;
        reportWriteSuccess();
      })
      .catch((e) => {
        reportError(e, { ctx: 'revenue.total.write' });
        reportWriteFailure('revenue.total.write', e);
        scheduleRetry();
      });
  }, [revenue.total, storeId, retryTick]);

  // ── revenue.history write (diff + 디바운스) ────────────────
  useEffect(() => {
    if (!storeId) return;
    if (revenue.history === lastSyncedHistoryRef.current) return;

    if (historyDebounceRef.current) clearTimeout(historyDebounceRef.current);
    historyDebounceRef.current = setTimeout(() => {
      const db = getFirestore();
      if (!db) return;
      const storeRef = db.collection('stores').doc(storeId);
      const synced = lastSyncedHistoryRef.current || [];
      const next = revenue.history || [];
      const syncedById = new Map(
        synced.filter((h) => h && h.id != null).map((h) => [String(h.id), h])
      );
      const nextById = new Map(
        next.filter((h) => h && h.id != null).map((h) => [String(h.id), h])
      );
      const batch = db.batch();
      let opCount = 0;
      for (const [id, item] of nextById) {
        if (syncedById.get(id) !== item) {
          batch.set(storeRef.collection('history').doc(id), item);
          opCount++;
        }
      }
      for (const [id] of syncedById) {
        if (!nextById.has(id)) {
          batch.delete(storeRef.collection('history').doc(id));
          opCount++;
        }
      }
      if (opCount > 0) {
        batch
          .commit()
          .then(() => {
            lastSyncedHistoryRef.current = next;
            reportWriteSuccess();
          })
          .catch((e) => {
            reportError(e, { ctx: 'history.batch.write', opCount });
            reportWriteFailure('history.batch.write', e);
            scheduleRetry();
          });
      } else {
        lastSyncedHistoryRef.current = next;
      }
    }, HISTORY_DEBOUNCE_MS);

    return () => {
      if (historyDebounceRef.current) clearTimeout(historyDebounceRef.current);
    };
  }, [revenue.history, storeId, retryTick]);

  // ── addressBook.entries write (diff + 디바운스) ────────────
  useEffect(() => {
    if (!storeId) return;
    if (addressBook.entries === lastSyncedAddressEntriesRef.current) return;

    if (addressEntriesDebounceRef.current)
      clearTimeout(addressEntriesDebounceRef.current);
    addressEntriesDebounceRef.current = setTimeout(() => {
      const db = getFirestore();
      if (!db) return;
      const storeRef = db.collection('stores').doc(storeId);
      const synced = lastSyncedAddressEntriesRef.current || {};
      const next = addressBook.entries || {};
      const batch = db.batch();
      let opCount = 0;
      for (const key of Object.keys(next)) {
        if (next[key] !== synced[key]) {
          const docId = safeDocId(key);
          batch.set(storeRef.collection('addresses').doc(docId), {
            _key: key,
            ...next[key],
          });
          opCount++;
        }
      }
      for (const key of Object.keys(synced)) {
        if (!(key in next)) {
          const docId = safeDocId(key);
          batch.delete(storeRef.collection('addresses').doc(docId));
          opCount++;
        }
      }
      if (opCount > 0) {
        batch
          .commit()
          .then(() => {
            lastSyncedAddressEntriesRef.current = next;
            reportWriteSuccess();
          })
          .catch((e) => {
            reportError(e, { ctx: 'addresses.batch.write', opCount });
            reportWriteFailure('addresses.batch.write', e);
            scheduleRetry();
          });
      } else {
        lastSyncedAddressEntriesRef.current = next;
      }
    }, ADDRESS_DEBOUNCE_MS);

    return () => {
      if (addressEntriesDebounceRef.current)
        clearTimeout(addressEntriesDebounceRef.current);
    };
  }, [addressBook.entries, storeId, retryTick]);

  // ── addressBook 메타 write (todayDate / todayDeliveredKeys / autoRemember) ──
  useEffect(() => {
    if (!storeId) return;
    const synced = lastSyncedAddressMetaRef.current;
    if (
      synced &&
      synced.todayDate === addressBook.todayDate &&
      synced.todayDeliveredKeys === addressBook.todayDeliveredKeys &&
      synced.autoRemember === addressBook.autoRemember
    ) {
      return;
    }
    const db = getFirestore();
    if (!db) return;
    // ignoredSimilarPairs 는 meta 에 넣지 않는다 — Firestore 에 안 쓰므로 무한루프 불가.
    const meta = {
      todayDate: addressBook.todayDate,
      todayDeliveredKeys: addressBook.todayDeliveredKeys,
      autoRemember: addressBook.autoRemember,
    };
    db.collection('stores')
      .doc(storeId)
      .collection('state')
      .doc('addressBookMeta')
      .set(meta)
      .then(() => {
        lastSyncedAddressMetaRef.current = meta;
        reportWriteSuccess();
      })
      .catch((e) => {
        reportError(e, { ctx: 'addressBookMeta.write' });
        reportWriteFailure('addressBookMeta.write', e);
        scheduleRetry();
      });
  }, [
    addressBook.todayDate,
    addressBook.todayDeliveredKeys,
    addressBook.autoRemember,
    storeId,
    retryTick,
  ]);
}
