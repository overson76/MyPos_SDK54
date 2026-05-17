// Electron → SIP 착신 → 주소록 조회 → Firebase → 모든 기기 팝업 + TTS
// 1.0.42: 미매칭 신규 번호 자동 phone-only 등록 — 직원이 관리자 → 주소록에서 채움.
import { useEffect, useRef } from 'react';
import { getFirestore } from './firebase';
import { useOrders } from './OrderContext';
import { speakIncomingCid } from './notify';

export function useCidHandler(storeId) {
  const { addressBook, addPhoneOnly } = useOrders();
  // ref 로 최신 addressBook 유지 — effect 재등록 없이 콜백에서 항상 최신값 참조
  const abRef = useRef(addressBook);
  abRef.current = addressBook;
  const addPhoneOnlyRef = useRef(addPhoneOnly);
  addPhoneOnlyRef.current = addPhoneOnly;

  useEffect(() => {
    if (!storeId) return;
    if (typeof window === 'undefined' || !window.mypos?.isElectron) return;

    window.mypos.startCid(storeId).catch(() => {});

    const unsub = window.mypos.onIncomingCall(async ({ phoneNumber, formattedNumber }) => {
      const db = getFirestore();
      if (!db || !storeId) return;

      // 전화번호(숫자만)로 주소록 항목 조회.
      // 2026-05-16: phones array (휴대폰 + 일반전화 다중) + 옛 phone 단일 모두 검색.
      const digits = (phoneNumber || '').replace(/\D/g, '');
      const entries = Object.values(abRef.current?.entries || {});
      const phoneDigitsOf = (e) => {
        const list = [];
        if (Array.isArray(e?.phones)) {
          for (const p of e.phones) {
            const d = String(p || '').replace(/\D/g, '');
            if (d) list.push(d);
          }
        }
        if (e?.phone) {
          const d = String(e.phone).replace(/\D/g, '');
          if (d && !list.includes(d)) list.push(d);
        }
        return list;
      };
      const match = digits
        ? entries.find((e) => phoneDigitsOf(e).includes(digits))
        : null;

      const alias = match?.alias || null;
      const address = match?.label || null;
      const orderCount = match?.count || 0;

      // 신규 번호 자동 등록 — pendingAddress entry. 직원이 주소록에서 주소 채워서 정식 entry 로.
      // addPhoneOnly 가 같은 phone digits 중복 등록을 자체 가드.
      if (!match && digits) {
        try {
          addPhoneOnlyRef.current?.(digits);
        } catch (e) {
          console.warn('[cid] 신규 번호 자동 등록 실패:', e);
        }
      }

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
            isNewNumber: !match,
            ts: new Date(),
          });
      } catch (e) {
        console.error('[cid] Firebase 기록 실패:', e);
      }
    });

    return () => unsub?.();
  }, [storeId]); // addressBook 은 ref 로 참조 — deps 불필요
}
