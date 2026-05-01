// Electron → SIP 착신 → 주소록 조회 → Firebase → 모든 기기 팝업 + TTS
import { useEffect, useRef } from 'react';
import { getFirestore } from './firebase';
import { useOrders } from './OrderContext';
import { speakIncomingCid } from './notify';

export function useCidHandler(storeId) {
  const { addressBook } = useOrders();
  // ref 로 최신 addressBook 유지 — effect 재등록 없이 콜백에서 항상 최신값 참조
  const abRef = useRef(addressBook);
  abRef.current = addressBook;

  useEffect(() => {
    if (!storeId) return;
    if (typeof window === 'undefined' || !window.mypos?.isElectron) return;

    window.mypos.startCid(storeId).catch(() => {});

    const unsub = window.mypos.onIncomingCall(async ({ phoneNumber, formattedNumber }) => {
      const db = getFirestore();
      if (!db || !storeId) return;

      // 전화번호(숫자만)로 주소록 항목 조회
      const digits = (phoneNumber || '').replace(/\D/g, '');
      const entries = Object.values(abRef.current?.entries || {});
      const match = digits
        ? entries.find((e) => e.phone && e.phone.replace(/\D/g, '') === digits)
        : null;

      const alias = match?.alias || null;
      const address = match?.label || null;
      const orderCount = match?.count || 0;

      // 별칭 or 주소 TTS — 모든 기기로 브로드캐스트
      speakIncomingCid({ alias, address });

      try {
        await db
          .collection('stores').doc(storeId)
          .collection('state').doc('incomingCall')
          .set({
            phoneNumber,
            formattedNumber,
            alias: alias || null,
            address: address || null,
            orderCount,
            ts: new Date(),
          });
      } catch (e) {
        console.error('[cid] Firebase 기록 실패:', e);
      }
    });

    return () => unsub?.();
  }, [storeId]); // addressBook 은 ref 로 참조 — deps 불필요
}
