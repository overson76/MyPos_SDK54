// Electron → SIP 착신 → 주소록 조회 → Firebase → 모든 기기 팝업 + TTS
// 1.0.42: 미매칭 신규 번호 자동 phone-only 등록 — 직원이 관리자 → 주소록에서 채움.
import { useEffect, useRef } from 'react';
import { getFirestore } from './firebase';
import { useOrders } from './OrderContext';
import { speakIncomingCid } from './notify';

// 2026-05-23: 한국 전화번호 정규화 — 매장에 저장된 entry phone 이 다양한 형식
// (010-1234-5678, +82-10-1234-5678, 821012345678 등) 으로 들어올 수 있어
// 양쪽 (CID sender + entry.phone/phones) 모두 같은 함수로 통과시켜야 매칭 누락 방지.
//
// 사장님 신고 "저장된 번호인데 왜 안 떠" 의 가능한 원인 중 하나 — entry 가 +82
// 형식으로 저장됐는데 LG U+ Centrex 의 sender 는 010 형식 → digits 길이 다름 → 미매칭.
function normalizePhoneDigits(raw) {
  if (!raw) return '';
  let d = String(raw).replace(/\D/g, '');
  // 한국 국가코드 82 prefix → 0 변환 (entry 가 +82 형식 / 국제 형식인 경우)
  if (d.startsWith('82') && d.length >= 11) {
    d = '0' + d.slice(2);
  }
  return d;
}

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
      // 2026-05-23: normalizePhoneDigits 로 +82 같은 국가코드 prefix 흡수.
      const digits = normalizePhoneDigits(phoneNumber);
      const entries = Object.values(abRef.current?.entries || {});
      const phoneDigitsOf = (e) => {
        const list = [];
        if (Array.isArray(e?.phones)) {
          for (const p of e.phones) {
            const d = normalizePhoneDigits(p);
            if (d && !list.includes(d)) list.push(d);
          }
        }
        if (e?.phone) {
          const d = normalizePhoneDigits(e.phone);
          if (d && !list.includes(d)) list.push(d);
        }
        return list;
      };
      const match = digits
        ? entries.find((e) => phoneDigitsOf(e).includes(digits))
        : null;

      // 2026-05-28: 사장님 호소 "분명히 저장된 번호인데 새 전화로 인식" 진단.
      //   매칭 실패 시 후보 entries (digits 부분 일치) 를 추출해 Firestore 에 박음.
      //   사장님이 *매장에서 즉시* 어디서 끊겼는지 식별 가능.
      let debugSuffixCandidates = null;
      if (!match && digits) {
        const last4 = digits.slice(-4);
        const last7 = digits.slice(-7);
        const candidates = [];
        for (const e of entries) {
          const eDigits = phoneDigitsOf(e);
          for (const ed of eDigits) {
            const matchedLast4 = last4.length === 4 && ed.endsWith(last4);
            const matchedLast7 = last7.length === 7 && ed.endsWith(last7);
            if (matchedLast4 || matchedLast7) {
              candidates.push({
                key: e.key,
                alias: e.alias || null,
                label: e.label || null,
                phones: eDigits,
                matchedLast7,
                matchedLast4,
              });
              break;
            }
          }
          if (candidates.length >= 5) break;
        }
        debugSuffixCandidates = candidates.length > 0 ? candidates : null;
        if (typeof console !== 'undefined') {
          console.warn('[cid] 매칭 실패 진단', {
            cidDigits: digits,
            totalEntries: entries.length,
            suffixCandidates: debugSuffixCandidates,
          });
        }
      }

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
            // 2026-05-23: 매칭 진단 — 사장님이 "왜 안 떠" 신고할 때 Firebase 콘솔
            // (또는 관리자 화면 향후) 에서 매칭 시도 결과 직접 확인 가능.
            debugDigits: digits || null,
            debugEntryCount: entries.length,
            // 2026-05-28: 매칭 실패 시 suffix 부분 일치 후보 (사장님 매장 진단용).
            //   사장님이 "분명히 저장된 번호" 라 하면 이 필드에 후보 entry 가 떠야 정상.
            //   비어있으면 정말로 어디에도 그 phone 이 없다는 뜻.
            debugSuffixCandidates: debugSuffixCandidates || null,
            ts: new Date(),
          });
      } catch (e) {
        console.error('[cid] Firebase 기록 실패:', e);
      }
    });

    return () => unsub?.();
  }, [storeId]); // addressBook 은 ref 로 참조 — deps 불필요
}
