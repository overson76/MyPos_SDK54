// 배달 회수 차수(round) — Firestore 영구 저장.
//
// 각 차수 = 출력 시점의 회수 목록 snapshot. 한 번 마감되면 변경 X.
//   - id: 'YYYY-MM-DD-rN' (예: '2026-05-15-r1')
//   - date: 'YYYY-MM-DD'
//   - roundNo: 그날 N번째 차수 (1, 2, 3 ...)
//   - createdAt: 출력 시각 timestamp
//   - sortMode: 출력 당시 정렬 ('near' | 'far') — 화면 표시는 사용자가 다시 바꿀 수 있음
//   - snapshot: { ranked, unknown, totalCount } — 출력 시점 결과 그대로
//
// 진행중 차수는 Firestore 에 없음 — 마지막 차수의 createdAt 이후 결제완료된 entry 를
// 화면에서 실시간 계산해 가상 표시. 사장님이 출력 누르는 시점에 정식 차수로 저장.

import { useCallback, useEffect, useState } from 'react';
import { getFirestore } from './firebase';
import { reportError } from './sentry';
import { useStore } from './StoreContext';
import { localDateString } from './orderHelpers';

export function useDeliveryRounds() {
  const { storeInfo } = useStore();
  const storeId = storeInfo?.storeId || null;
  const [rounds, setRounds] = useState({});

  // Firestore subscribe — 다른 기기(폰)에서 출력해도 즉시 반영.
  useEffect(() => {
    if (!storeId) return;
    const db = getFirestore();
    if (!db) return;
    const unsub = db
      .collection('stores')
      .doc(storeId)
      .collection('returnRounds')
      .onSnapshot(
        (snap) => {
          const map = {};
          snap.forEach((doc) => {
            const d = doc.data();
            if (d?.id) map[d.id] = d;
          });
          setRounds(map);
        },
        (err) => {
          try {
            reportError(err, { ctx: 'returnRounds.listener' });
          } catch (_) {}
        }
      );
    return () => {
      try {
        unsub();
      } catch (_) {}
    };
  }, [storeId]);

  // 새 차수 마감 + 저장. snapshot 은 computeDeliveryReturns() 의 반환값 형태.
  // 그날 차수 번호 = (기존 그날 차수 개수) + 1.
  const finalizeRound = useCallback(
    (snapshot, sortMode = 'far', date = null) => {
      const today = date || localDateString();
      const todayRounds = Object.values(rounds).filter(
        (r) => r && r.date === today
      );
      const roundNo = todayRounds.length + 1;
      const id = `${today}-r${roundNo}`;
      const round = {
        id,
        date: today,
        roundNo,
        createdAt: Date.now(),
        sortMode: sortMode || 'far',
        snapshot: {
          ranked: Array.isArray(snapshot?.ranked) ? snapshot.ranked : [],
          unknown: Array.isArray(snapshot?.unknown) ? snapshot.unknown : [],
          totalCount:
            (Array.isArray(snapshot?.ranked) ? snapshot.ranked.length : 0) +
            (Array.isArray(snapshot?.unknown) ? snapshot.unknown.length : 0),
        },
      };
      // 옵티미스틱 in-memory 갱신 — Firestore 응답 기다리지 않고 즉시 화면 반영.
      setRounds((prev) => ({ ...prev, [id]: round }));
      // storeId 가 있으면 Firestore 영구 저장. 없으면 in-memory 만 (offline).
      if (storeId) {
        const db = getFirestore();
        if (db) {
          db.collection('stores')
            .doc(storeId)
            .collection('returnRounds')
            .doc(id)
            .set(round)
            .catch((e) => {
              try {
                reportError(e, { ctx: 'returnRounds.write', id });
              } catch (_) {}
            });
        }
      }
      return round;
    },
    [rounds, storeId]
  );

  return { rounds, finalizeRound };
}
