// Firebase 초기화 + 헬퍼 (웹 전용).
// 카운터 PC 의 Expo Web 빌드가 폰들과 같은 Firestore 매장 데이터를 공유하기 위함.
//
// 호출자(StoreContext / storeOps / MenuContext / useOrderFirestoreSync) 는
// @react-native-firebase 의 namespace API 패턴 (db.collection().doc().get() 등) 을
// 그대로 사용. 이 파일은 그 패턴을 흉내내는 thin wrapper 를 제공하고,
// 내부적으로 Firebase JS SDK v9+ modular API 를 호출.
//
// 환경변수: .env 의 EXPO_PUBLIC_FIREBASE_* 6개. 누락 시 init 조용히 skip
// (웹에서 Firebase 미설정 상태로도 앱은 부팅되도록).

import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  initializeFirestore,
  getFirestore as fsGetFirestore,
  collection as fsCollection,
  doc as fsDoc,
  getDoc as fsGetDoc,
  getDocs as fsGetDocs,
  setDoc as fsSetDoc,
  updateDoc as fsUpdateDoc,
  deleteDoc as fsDeleteDoc,
  onSnapshot as fsOnSnapshot,
  writeBatch as fsWriteBatch,
  runTransaction as fsRunTransaction,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import {
  getAuth as fsGetAuth,
  signInAnonymously as fsSignInAnonymously,
  setPersistence,
  browserLocalPersistence,
} from 'firebase/auth';

let _initialized = false;
let _wrappedDb = null;
let _wrappedAuth = null;

// babel-preset-expo 의 EXPO_PUBLIC_* inline transformer 는 `process.env.EXPO_PUBLIC_X`
// 직접 참조 패턴만 식별. 변수에 담아 우회(const env = process.env)하면 inline 누락
// → production 빌드에서 undefined 가 되어 init skip 되는 함정. 직접 참조 필수.
function readConfig() {
  return {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  };
}

function configIsValid(cfg) {
  return !!(cfg.apiKey && cfg.projectId && cfg.appId);
}

export async function initFirebase() {
  if (_initialized) return;

  const cfg = readConfig();
  if (!configIsValid(cfg)) {
    // 웹 환경에 Firebase 키가 안 박혔으면 동기화 비활성 — 앱은 정상 부팅.
    if (typeof console !== 'undefined') {
      // eslint-disable-next-line no-console
      console.warn(
        '[firebase.web] EXPO_PUBLIC_FIREBASE_* 환경변수가 비어있어 동기화 기능을 끕니다.'
      );
    }
    _initialized = true;
    return;
  }

  // 이미 init 돼 있으면(HMR 등) 재사용. 새 앱이면 initializeFirestore 로 캐시 구성.
  const alreadyHadApp = getApps().length > 0;
  const app = alreadyHadApp ? getApp() : initializeApp(cfg);

  const rawAuth = fsGetAuth(app);
  // PC 새로고침/재부팅 시 익명 uid 유지 — IndexedDB 기반 영속화.
  try {
    await setPersistence(rawAuth, browserLocalPersistence);
  } catch (e) {
    // 일부 사파리 사설 모드에선 실패 가능 — 메모리 영속화로 자동 폴백.
  }

  // Firebase v11+ 에서 enableIndexedDbPersistence 가 제거됨.
  // 새 앱이면 initializeFirestore 로 IndexedDB 캐시 구성 (새 API).
  // 이미 있는 앱이면 getFirestore 로 기존 인스턴스 반환 (HMR 재설정 방지).
  let rawDb;
  if (!alreadyHadApp) {
    try {
      rawDb = initializeFirestore(app, {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      });
    } catch (e) {
      // failed-precondition (다른 탭에서 이미 켬) / 브라우저 미지원 시 메모리 캐시로 폴백.
      rawDb = fsGetFirestore(app);
    }
  } else {
    rawDb = fsGetFirestore(app);
  }

  _wrappedDb = wrapDb(rawDb);
  _wrappedAuth = wrapAuth(rawAuth);

  // 익명 로그인 — 매장 코드 입력 전에도 uid 가 있어야 Firestore 읽기 가능.
  if (!rawAuth.currentUser) {
    try {
      await fsSignInAnonymously(rawAuth);
    } catch (e) {
      // 네트워크 끊긴 첫 부팅이면 실패 가능. 다음 부팅/재시도 때.
    }
  }

  // Electron 전용: 인증 상태가 바뀔 때마다 userData 파일에 저장.
  // preload 가 다음 시작 시 이 값을 localStorage 에 주입 → origin 달라도 동일 UID 유지.
  if (typeof window !== 'undefined' && window.mypos?.saveAuthState) {
    rawAuth.onAuthStateChanged((user) => {
      if (!user) return; // 로그아웃 상태엔 저장 안 함 — 기존 상태 보존
      try {
        const keys = {};
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('firebase:')) keys[k] = localStorage.getItem(k);
        }
        if (Object.keys(keys).length > 0) {
          window.mypos.saveAuthState(keys).catch(() => {});
        }
      } catch {}
    });
  }

  _initialized = true;
}

export function getFirebaseApp() {
  return getApps().length > 0 ? getApp() : null;
}

export function getAuth() {
  return _wrappedAuth;
}

export function getFirestore() {
  return _wrappedDb;
}

export function getCurrentUid() {
  if (!_wrappedAuth) return null;
  return _wrappedAuth._raw.currentUser?.uid || null;
}

// Firestore Timestamp 헬퍼 — 매장/멤버/주문 문서에 createdAt/updatedAt 박을 때 사용.
// 네이티브 측과 동일하게 Date 객체 반환 (Firestore 가 자동 변환).
export function serverTimestamp() {
  return new Date();
}

// ─────────────────────────────────────────────────────────────────
// namespace-like wrapper: RN-Firebase 의 db.collection().doc()...
// 패턴을 흉내내서 호출자 코드를 수정하지 않게 함.
// ─────────────────────────────────────────────────────────────────

function wrapDb(rawDb) {
  return {
    _raw: rawDb,
    collection: (name) => wrapCollection(fsCollection(rawDb, name)),
    batch: () => wrapBatch(fsWriteBatch(rawDb)),
    runTransaction: (fn) =>
      fsRunTransaction(rawDb, (rawTx) => fn(wrapTransaction(rawTx))),
  };
}

function wrapCollection(rawCol) {
  return {
    _raw: rawCol,
    // doc(id) 또는 doc() (auto-id) 모두 지원.
    doc: (id) =>
      wrapDocRef(id != null ? fsDoc(rawCol, String(id)) : fsDoc(rawCol)),
    // getDocs 결과를 래핑 — doc.ref.delete() 등이 native처럼 동작하도록.
    get: async () => {
      const rawSnap = await fsGetDocs(rawCol);
      return wrapQuerySnapshot(rawSnap);
    },
    onSnapshot: (cb, errCb) => fsOnSnapshot(rawCol, cb, errCb),
  };
}

// QuerySnapshot 래퍼 — deleteStore 등이 doc.ref.delete() 를 호출할 수 있도록.
function wrapQuerySnapshot(rawSnap) {
  return {
    docs: rawSnap.docs.map((d) => ({
      id: d.id,
      data: () => d.data(),
      exists: () => (typeof d.exists === 'function' ? d.exists() : !!d.exists),
      metadata: d.metadata,
      ref: {
        _raw: d.ref,
        id: d.ref.id,
        delete: () => fsDeleteDoc(d.ref),
        get: () => fsGetDoc(d.ref),
        set: (data, opts) => opts ? fsSetDoc(d.ref, data, opts) : fsSetDoc(d.ref, data),
        update: (data) => fsUpdateDoc(d.ref, data),
        collection: (name) => wrapCollection(fsCollection(d.ref, name)),
        onSnapshot: (cb, errCb) => fsOnSnapshot(d.ref, cb, errCb),
      },
    })),
    empty: rawSnap.empty,
    size: rawSnap.size,
    metadata: rawSnap.metadata,
  };
}

function wrapDocRef(rawDocRef) {
  return {
    _raw: rawDocRef,
    get id() {
      return rawDocRef.id;
    },
    collection: (name) => wrapCollection(fsCollection(rawDocRef, name)),
    get: () => fsGetDoc(rawDocRef),
    set: (data, opts) =>
      opts ? fsSetDoc(rawDocRef, data, opts) : fsSetDoc(rawDocRef, data),
    // update — RNFirebase namespace 패턴 호환. setRevenuePin / clearRevenuePin 에서 사용.
    update: (data) => fsUpdateDoc(rawDocRef, data),
    delete: () => fsDeleteDoc(rawDocRef),
    onSnapshot: (cb, errCb) => fsOnSnapshot(rawDocRef, cb, errCb),
  };
}

function wrapBatch(rawBatch) {
  return {
    set: (wrappedDoc, data, opts) => {
      if (opts) rawBatch.set(wrappedDoc._raw, data, opts);
      else rawBatch.set(wrappedDoc._raw, data);
      return wrappedDoc;
    },
    delete: (wrappedDoc) => {
      rawBatch.delete(wrappedDoc._raw);
      return wrappedDoc;
    },
    commit: () => rawBatch.commit(),
  };
}

function wrapTransaction(rawTx) {
  return {
    get: (wrappedDoc) => rawTx.get(wrappedDoc._raw),
    set: (wrappedDoc, data, opts) =>
      opts ? rawTx.set(wrappedDoc._raw, data, opts) : rawTx.set(wrappedDoc._raw, data),
    delete: (wrappedDoc) => rawTx.delete(wrappedDoc._raw),
  };
}

function wrapAuth(rawAuth) {
  return {
    _raw: rawAuth,
    get currentUser() {
      return rawAuth.currentUser;
    },
    signInAnonymously: () => fsSignInAnonymously(rawAuth),
  };
}
