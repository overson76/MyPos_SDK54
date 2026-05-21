// 전화 착신 이벤트 구독 — 네이티브(iOS/Android) 폰용.
// Firebase stores/{storeId}/state/incomingCall 문서를 실시간 감시.
//
// 2026-05-21 fix: 옛 코드는 noop 이었음 ("CID 이벤트는 Electron → Firebase → 웹/앱 순서
// 로 전달된다" 는 코멘트와 모순). 실제로는 폰들이 Firebase 구독 안 해서 *영영* 알림 못
// 받는 상태. .web.js 와 동일 구현으로 통일 — @react-native-firebase 의 namespace API 도
// .collection().doc().onSnapshot() 패턴 동일 지원.
//
// 반환 시그니처: { call, dismiss }
//   - call: null | { phoneNumber, formattedNumber, address, orderCount, alias, ts }
//   - dismiss: 외부에서 알림 즉시 숨기는 함수.
//
// 자동 dismiss 정책: App.js 가 10초 타이머로 자동 dismiss + 빈 d 슬롯에 자동 stash.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getFirestore } from './firebase';

// 옛 stale 이벤트(앱 부팅 전 또는 매우 오래된 incomingCall 문서) 차단용.
const STALE_AGE_MS = 15_000;

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

      // 앱 부팅 이전 또는 STALE_AGE_MS 초과한 stale 이벤트는 무시.
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
