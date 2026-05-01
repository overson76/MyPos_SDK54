// Electron → SIP 착신 → Firebase → 모든 기기 팝업
import { useEffect } from 'react';
import { getFirestore } from './firebase';

export function useCidHandler(storeId) {
  useEffect(() => {
    if (!storeId) return;
    if (typeof window === 'undefined' || !window.mypos?.isElectron) return;

    // SIP 리스너 시작
    window.mypos.startCid(storeId).catch(() => {});

    // Electron → 메인 IPC → 렌더러 → Firebase
    const unsub = window.mypos.onIncomingCall(async ({ phoneNumber, formattedNumber }) => {
      const db = getFirestore();
      if (!db || !storeId) return;
      try {
        await db
          .collection('stores').doc(storeId)
          .collection('state').doc('incomingCall')
          .set({
            phoneNumber,
            formattedNumber,
            ts: new Date(),
          });
      } catch (e) {
        console.error('[cid] Firebase 기록 실패:', e);
      }
    });

    return () => unsub?.();
  }, [storeId]);
}
