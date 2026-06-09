// 전화 착신 이벤트 구독 — 웹/Electron 렌더러 공통.
// Firebase stores/{storeId}/state/incomingCall 문서를 실시간 감시.
// 새 착신이 오면 { phoneNumber, formattedNumber, address, orderCount, ts } 반환.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getFirestore } from './firebase';

// 옛 stale 이벤트(앱 부팅 전 또는 매우 오래된 incomingCall 문서) 차단용 — 화면 자동 사라짐과 무관.
const STALE_AGE_MS = 15_000;

// 2026-05-28: 사장님 호소 "AliasPromptModal 전화번호 칸 빈" 처방.
//   사장님 시나리오 — 시연/실CID 알림 떴는데 사장님이 직접 (다른) 슬롯 만들거나
//   ✕ 닫고 슬롯 만들면, 그 슬롯 deliveryPhone 없어 모달 currentPhone 도 빈.
//   최근 활성 CID phone 을 module-level 로 보관 → 5분 안에 만든 슬롯/모달의
//   fallback. 모든 매장 운영 흐름에서 자동 채움.
const LAST_CALL_TTL_MS = 5 * 60 * 1000;
let _lastCallPhone = '';
let _lastCallFormatted = '';
let _lastCallTs = 0;

export function recordLastCallPhone(phoneNumber, formattedNumber) {
  _lastCallPhone = String(phoneNumber || '').trim();
  _lastCallFormatted = String(formattedNumber || phoneNumber || '').trim();
  _lastCallTs = Date.now();
}

export function getLastCallPhone() {
  if (Date.now() - _lastCallTs > LAST_CALL_TTL_MS) return '';
  return _lastCallPhone;
}

export function getLastCallFormatted() {
  if (Date.now() - _lastCallTs > LAST_CALL_TTL_MS) return '';
  return _lastCallFormatted;
}

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
      // 2026-05-28: 최근 CID phone 글로벌 fallback 갱신 (5분 TTL).
      if (data.phoneNumber) {
        recordLastCallPhone(data.phoneNumber, data.formattedNumber || data.phoneNumber);
      }
      setCall(data);
    });

    return () => unsub();
  }, [storeId]);

  const dismiss = useCallback(() => {
    setCall(null);
    // 2026-06-09: 로컬뿐 아니라 Firestore incomingCall 문서도 삭제. 멀티기기(PC·아이패드)가
    //   각자 10초 자동 stash 해서 같은 전화가 여러 슬롯에 박히던 중복 사고 처방 — 한 기기가
    //   처리(주문받기/자동 stash)하면 모든 기기의 알림이 사라지고 타이머도 cleanup 됨.
    //   재수신(CID 서버 ring 반복)으로 incomingCall 이 부활하던 단일기기 경로도 차단.
    //   simulate 호출은 Firestore 문서가 없어 delete 가 noop. 실패해도 로컬 dismiss 는 유효.
    try {
      const db = getFirestore();
      if (db && storeId) {
        db.collection('stores').doc(storeId).collection('state').doc('incomingCall').delete();
      }
    } catch (e) {
      // 삭제 실패(네트워크 등)해도 로컬 dismiss 는 유지 — 흐름 안 막음
    }
  }, [storeId]);

  // 2026-05-28: 시연 / 검증용 — Firestore 안 거치고 로컬 state 만. 라이브 데이터 영향 0.
  // 가상 CID 호출로 IncomingCallBanner → AliasPromptModal → Toast 흐름 즉시 검증.
  const simulateCall = useCallback((data = {}) => {
    const phoneNumber = data.phoneNumber || '01099998888';
    const formattedNumber = data.formattedNumber || data.phoneNumber || '010-9999-8888';
    recordLastCallPhone(phoneNumber, formattedNumber);
    setCall({
      phoneNumber,
      formattedNumber,
      address: data.address || null,
      alias: data.alias || null,
      orderCount: data.orderCount || 0,
      isNewNumber: data.isNewNumber ?? !data.alias,
      ts: { toMillis: () => Date.now() },
      __simulated: true,
    });
  }, []);

  return { call, dismiss, simulateCall };
}
