// 매장 가입 상태 관리.
// - loading: 부팅 중 / Firestore 멤버십 검증 중
// - unjoined: 매장 미가입 — AuthScreen 표시
// - pendingApproval: 직원이 가입 요청 보냄, 대표 승인 대기 — 대기 화면 표시
// - joined: 정상 작동 — 기존 앱 트리 렌더
//
// 멤버 문서 onSnapshot 으로 실시간 감시 → 대표가 직원 제거하면 즉시 unjoined 로 강제 전환.
// AsyncStorage 캐시(storeMembership / pendingJoin) 로 앱 재시작 시 가입 화면 안 뜨게 함.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { loadJSON, saveJSON, removeKey } from './persistence';
import { getFirestore, getCurrentUid } from './firebase';
import { reportError } from './sentry';
import { snapExists } from './firestoreCompat';

const StoreContext = createContext(null);

export const STORE_STATE = {
  LOADING: 'loading',
  UNJOINED: 'unjoined',
  PENDING_APPROVAL: 'pendingApproval',
  JOINED: 'joined',
};

const CACHE_KEY = 'storeMembership'; // { storeId, role }
const PENDING_KEY = 'pendingJoin'; // { storeId, displayName }

// Anonymous Auth 가 끝날 때까지 잠깐 대기 — initFirebase 가 fire-and-forget 이라
// 부팅 직후엔 currentUser 가 없을 수 있음.
async function waitForUid(maxMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (getCurrentUid()) return getCurrentUid();
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

export function StoreProvider({ children }) {
  const [state, setState] = useState(STORE_STATE.LOADING);
  const [storeInfo, setStoreInfo] = useState(null);
  // info 형태:
  //   joined        → { storeId, code, name, ownerId, role, displayName }
  //   pendingApproval → { storeId, displayName }
  const memberUnsubRef = useRef(null);
  const requestUnsubRef = useRef(null);

  const teardown = useCallback(() => {
    if (memberUnsubRef.current) {
      memberUnsubRef.current();
      memberUnsubRef.current = null;
    }
    if (requestUnsubRef.current) {
      requestUnsubRef.current();
      requestUnsubRef.current = null;
    }
  }, []);

  // 가입 후 멤버십 실시간 감시. 멤버 문서 사라지면 unjoined.
  const subscribeMembership = useCallback((storeId) => {
    const uid = getCurrentUid();
    const db = getFirestore();
    if (!uid || !db) return;

    const memberRef = db.collection('stores').doc(storeId).collection('members').doc(uid);
    const storeRef = db.collection('stores').doc(storeId);

    if (memberUnsubRef.current) memberUnsubRef.current();
    memberUnsubRef.current = memberRef.onSnapshot(
      async (snap) => {
        if (!snapExists(snap)) {
          // 멤버 제거됨 (대표가 강퇴 또는 본인 탈퇴)
          await removeKey(CACHE_KEY);
          setStoreInfo(null);
          setState(STORE_STATE.UNJOINED);
          return;
        }
        const member = snap.data();
        let store = null;
        try {
          const storeSnap = await storeRef.get();
          store = snapExists(storeSnap) ? storeSnap.data() : null;
        } catch (e) {
          // 매장 문서 읽기 실패 — 멤버 정보만으로 진행
        }
        const next = {
          storeId,
          code: store?.code || null,
          name: store?.name || null,
          ownerId: store?.ownerId || null,
          role: member.role,
          displayName: member.displayName || null,
          // 매장 공유 수익 PIN — 미설정 시 null. RevenueLockGate 가 검증에 사용.
          revenuePinHash: store?.revenuePinHash || null,
          revenuePinSalt: store?.revenuePinSalt || null,
        };
        setStoreInfo(next);
        await saveJSON(CACHE_KEY, { storeId, role: member.role });
        setState(STORE_STATE.JOINED);
      },
      (err) => {
        reportError(err, { ctx: 'StoreContext.subscribeMembership', storeId });
      }
    );
  }, []);

  // 가입 요청 후 대표 승인 감시. 대표가 승인하면 멤버 문서가 생김 → joined 로 전환.
  const subscribeJoinRequest = useCallback(
    (storeId) => {
      const uid = getCurrentUid();
      const db = getFirestore();
      if (!uid || !db) return;

      const memberRef = db.collection('stores').doc(storeId).collection('members').doc(uid);

      if (requestUnsubRef.current) requestUnsubRef.current();
      requestUnsubRef.current = memberRef.onSnapshot(
        async (snap) => {
          if (snapExists(snap)) {
            // 승인됨!
            await removeKey(PENDING_KEY);
            if (requestUnsubRef.current) {
              requestUnsubRef.current();
              requestUnsubRef.current = null;
            }
            subscribeMembership(storeId);
          }
        },
        (err) => {
          reportError(err, { ctx: 'StoreContext.subscribeJoinRequest', storeId });
        }
      );
    },
    [subscribeMembership]
  );

  // 부팅 시: 캐시 확인 → 멤버십 검증 → 적절한 상태로
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const uid = await waitForUid();
      if (cancelled) return;
      if (!uid) {
        setState(STORE_STATE.UNJOINED);
        return;
      }

      // Electron(.exe) 재설치 시 IndexedDB 초기화 문제 방어:
      // 파일 영속화된 멤버십을 AsyncStorage 로 복구한 뒤 진행.
      if (typeof window !== 'undefined' && window.mypos?.loadMembership) {
        try {
          const fileCached = await window.mypos.loadMembership();
          if (fileCached?.storeId) {
            await saveJSON(CACHE_KEY, fileCached);
          }
        } catch {}
      }

      const [cached, pending] = await Promise.all([
        loadJSON(CACHE_KEY, null),
        loadJSON(PENDING_KEY, null),
      ]);
      if (cancelled) return;

      if (cached?.storeId) {
        subscribeMembership(cached.storeId);
        return;
      }
      if (pending?.storeId) {
        setStoreInfo({ storeId: pending.storeId, displayName: pending.displayName });
        setState(STORE_STATE.PENDING_APPROVAL);
        subscribeJoinRequest(pending.storeId);
        return;
      }
      setState(STORE_STATE.UNJOINED);
    })();
    return () => {
      cancelled = true;
      teardown();
    };
  }, [subscribeMembership, subscribeJoinRequest, teardown]);

  // ── storeOps 가 호출하는 상태 변경 진입점 ─────────────────────
  // createStore 성공 시 호출. 즉시 joined.
  const markJoined = useCallback(
    async (info) => {
      // info: { storeId, code, name, ownerId, role, displayName }
      const cacheData = { storeId: info.storeId, role: info.role };
      await saveJSON(CACHE_KEY, cacheData);
      // Electron(.exe) 재설치 대비 파일에도 저장
      if (typeof window !== 'undefined' && window.mypos?.saveMembership) {
        try { await window.mypos.saveMembership(cacheData); } catch {}
      }
      setStoreInfo(info);
      setState(STORE_STATE.JOINED);
      subscribeMembership(info.storeId);
    },
    [subscribeMembership]
  );

  // joinStore 호출 후 가입 요청 만들고 대기.
  const markPending = useCallback(
    async ({ storeId, displayName }) => {
      await saveJSON(PENDING_KEY, { storeId, displayName });
      setStoreInfo({ storeId, displayName });
      setState(STORE_STATE.PENDING_APPROVAL);
      subscribeJoinRequest(storeId);
    },
    [subscribeJoinRequest]
  );

  // 가입 요청 취소 (대기 중 직원이 직접).
  const cancelPending = useCallback(async () => {
    teardown();
    await removeKey(PENDING_KEY);
    setStoreInfo(null);
    setState(STORE_STATE.UNJOINED);
  }, [teardown]);

  // 본인 탈퇴 (UI 에서 호출). 실제 Firestore 멤버 문서 삭제는 storeOps 가 처리.
  const markLeft = useCallback(async () => {
    teardown();
    await removeKey(CACHE_KEY);
    setStoreInfo(null);
    setState(STORE_STATE.UNJOINED);
  }, [teardown]);

  const value = useMemo(
    () => ({
      state,
      storeInfo,
      isJoined: state === STORE_STATE.JOINED,
      isOwner: storeInfo?.role === 'owner',
      markJoined,
      markPending,
      cancelPending,
      markLeft,
    }),
    [state, storeInfo, markJoined, markPending, cancelPending, markLeft]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
