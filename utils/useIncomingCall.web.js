// 전화 착신 이벤트 구독 — 웹/Electron 렌더러 공통.
// Firebase stores/{storeId}/state/incomingCall 문서를 실시간 감시.
// 새 착신이 오면 { phoneNumber, formattedNumber, address, orderCount, ts } 반환.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getFirestore } from './firebase';

// 옛 stale 이벤트(앱 부팅 전 또는 매우 오래된 incomingCall 문서) 차단용 — 화면 자동 사라짐과 무관.
const STALE_AGE_MS = 15_000;

// 반환 시그니처: { call, dismiss }
//   - call: null | { phoneNumber, formattedNumber, address, orderCount, alias, ... }
//   - dismiss: 외부에서 알림을 즉시 숨기는 함수 (주문 확정 또는 ✕ 클릭 시).
//
// 자동 dismiss 정책 (2026-05-21 사장님 정책):
//   - 자동 시간 해제 *없음*. 사장님이 메뉴 담는 동안 누구의 주문인지 상시 확인해야 하므로
//     알림은 명시적 액션(주문 확정 / ✕ 클릭 / 새 착신으로 덮임)이 있을 때까지 *계속 유지*.
//   - 옛 정책(15초 후 자동 사라짐)은 "주문 확정 시 자동 dismiss" 와 충돌했음 — 둘 다 활성화하면
//     사장님이 메뉴 담는 중간에 알림이 사라져 누구 주문인지 잃음. 자동 시간 해제 제거.
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

      // 앱 부팅 이전 또는 STALE_AGE_MS 초과한 stale 이벤트는 무시 (옛 incomingCall 문서가
      // Firestore 에 남아있어도 새 부팅에서 떠오르지 않게).
      const age = Date.now() - (data.ts?.toMillis?.() || data.ts || 0);
      if (age > STALE_AGE_MS || (data.ts?.toMillis?.() || 0) < mountTs.current) {
        setCall(null);
        return;
      }
      setCall(data);
    });

    return () => unsub();
  }, [storeId]);

  const dismiss = useCallback(() => setCall(null), []);
  return { call, dismiss };
}
