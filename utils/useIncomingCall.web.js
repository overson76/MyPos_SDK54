// 전화 착신 이벤트 구독 — 웹/Electron 렌더러 공통.
// Firebase stores/{storeId}/state/incomingCall 문서를 실시간 감시.
// 새 착신이 오면 { phoneNumber, formattedNumber, address, orderCount, ts } 반환.

import { useEffect, useRef, useState } from 'react';
import { getFirestore } from './firebase';

const CUTOFF_MS = 15_000; // 15초 이내 착신만 유효 (1.0.47 — 사장님 충분히 보고 누를 시간)

export function useIncomingCall(storeId) {
  const [call, setCall] = useState(null);
  const mountTs = useRef(Date.now());

  useEffect(() => {
    if (!storeId) return;
    const db = getFirestore();
    if (!db) return;

    const ref = db
      .collection('stores')
      .doc(storeId)
      .collection('state')
      .doc('incomingCall');

    const unsub = ref.onSnapshot((snap) => {
      if (!snap.exists) { setCall(null); return; }
      const data = snap.data();
      if (!data) { setCall(null); return; }

      // 오래된 이벤트 무시 (앱 마운트 이전 또는 10초 초과)
      const age = Date.now() - (data.ts?.toMillis?.() || data.ts || 0);
      if (age > CUTOFF_MS || (data.ts?.toMillis?.() || 0) < mountTs.current) {
        setCall(null);
        return;
      }
      setCall(data);
    });

    return () => unsub();
  }, [storeId]);

  // 15초 후 자동 해제 — 사장님이 손 떼고도 충분히 정보 확인 + 주문받기 누를 시간 (1.0.47)
  useEffect(() => {
    if (!call) return;
    const t = setTimeout(() => setCall(null), 15_000);
    return () => clearTimeout(t);
  }, [call]);

  return call; // null | { phoneNumber, formattedNumber, address, orderCount }
}
