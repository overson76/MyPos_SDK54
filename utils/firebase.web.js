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
  getFirestore as fsGetFirestore,
  collection as fsCollection,
  doc as fsDoc,
  getDoc as fsGetDoc,
  setDoc as fsSetDoc,
  deleteDoc as fsDeleteDoc,
  onSnapshot as fsOnSnapshot,
  writeBatch as fsWriteBatch,
  runTransaction as fsRunTransaction,
  enableIndexedDbPersistence,
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

  // 이미 init 돼 있으면(HMR 등) 재사용.
  const app = getApps().length === 0 ? initializeApp(cfg) : getApp();

  const rawAuth = fsGetAuth(app);
  // PC 새로고침/재부팅 시 익명 uid 유지 — IndexedDB 기반 영속화.
  try {
    await setPersistence(rawAuth, browserLocalPersistence);
  } catch (e) {
    // 일부 사파리 사설 모드에선 실패 가능 — 메모리 영속화로 자동 폴백.
  }

  const rawDb = fsGetFirestore(app);
  // 매장 인터넷 끊겨도 잠깐 버티게 IndexedDB 캐시 활성.
  // 여러 탭 동시 사용 시 한 곳에서만 켜지므로 실패 가능 — 무시 OK.
  try {
    await enableIndexedDbPersistence(rawDb);
  } catch (e) {
    // failed-precondition (다른 탭에서 이미 켬) / unimplemented (브라우저 미지원)
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
    onSnapshot: (cb, errCb) => fsOnSnapshot(rawCol, cb, errCb),
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
