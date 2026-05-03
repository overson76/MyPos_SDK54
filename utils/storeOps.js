// 매장 생성/참여/멤버 관리 — Firestore 트랜잭션 함수 모음.
// StoreContext 가 호출. UI 가 직접 호출해도 무방.
//
// 보안 규칙(firestore.rules) 의 가정:
//   - storeCodes/{code} → { storeId } 로 매장 코드 매핑 (인증된 사용자 read 가능)
//   - stores/{storeId} 의 멤버만 운영 데이터 read/write
//   - 가입 요청은 본인만 생성, 대표/본인이 삭제

import { getFirestore, getCurrentUid, serverTimestamp } from './firebase';
import { addBreadcrumb } from './sentry';
import { snapExists } from './firestoreCompat';
import { verifyRevenuePin } from './revenuePin';

// 매장 코드 알파벳 — 헷갈리는 글자(0/O, 1/I/L) 제외.
// 31^8 ≈ 8.5조 가지 → 충돌 거의 없음.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 8;

function generateStoreCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

// UI 표시용 — `ABCD-1234` 형태. 입력 시 하이픈 제거 후 저장.
export function formatStoreCode(code) {
  if (!code || code.length !== CODE_LENGTH) return code || '';
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function normalizeStoreCode(input) {
  if (!input) return '';
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function requireDb() {
  const db = getFirestore();
  if (!db) throw new Error('Firebase 가 초기화되지 않았습니다. 잠시 후 다시 시도하세요.');
  return db;
}

function requireUid() {
  const uid = getCurrentUid();
  if (!uid) throw new Error('익명 로그인이 아직 끝나지 않았습니다. 잠시 후 다시 시도하세요.');
  return uid;
}

// ─── 매장 생성 (대표) ─────────────────────────────────────────
// 1) 매장 코드 생성 + 충돌 검사 (최대 5회 재시도)
// 2) stores/{storeId} + storeCodes/{code} + members/{uid='owner'} 동시 쓰기 (트랜잭션)
export async function createStore({ name, displayName }) {
  const db = requireDb();
  const uid = requireUid();

  const trimmedName = (name || '').trim();
  const trimmedDisplay = (displayName || '').trim();
  if (!trimmedName) throw new Error('상호를 입력해주세요.');
  if (!trimmedDisplay) throw new Error('대표 이름을 입력해주세요.');

  addBreadcrumb('store.create.start', { name: trimmedName });

  // 사용 가능 코드 후보 찾기
  let code = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateStoreCode();
    try {
      const snap = await db.collection('storeCodes').doc(candidate).get();
      if (!snapExists(snap)) {
        code = candidate;
        break;
      }
    } catch (e) {
      // 첫 시도 실패해도 다음 후보 시도. 모두 실패하면 아래 throw.
      addBreadcrumb('store.create.codeCheckFail', { attempt, error: String(e?.message || e) });
    }
  }
  if (!code) throw new Error('매장 코드 생성에 실패했습니다. 다시 시도해주세요.');

  const storeRef = db.collection('stores').doc();
  const storeId = storeRef.id;
  const codeRef = db.collection('storeCodes').doc(code);
  const memberRef = storeRef.collection('members').doc(uid);

  // 순차 쓰기 — RNFirebase v24 + 새 아키텍처에서 runTransaction 네이티브 크래시 회피.
  // 트랜잭션 보장은 잃지만, 1단계 실패 시 매장 자체가 안 만들어져 정합성은 유지됨.
  // 2단계(코드)/3단계(멤버) 실패 시 사용자가 다시 시도하면 됨 (storeId 는 새로 발급).
  addBreadcrumb('store.create.step1.storeDoc', { storeId });
  await storeRef.set({
    name: trimmedName,
    code,
    ownerId: uid,
    createdAt: serverTimestamp(),
  });

  addBreadcrumb('store.create.step2.codeMapping', { code });
  await codeRef.set({ storeId });

  addBreadcrumb('store.create.step3.memberDoc', { uid });
  await memberRef.set({
    role: 'owner',
    displayName: trimmedDisplay,
    joinedAt: serverTimestamp(),
  });

  addBreadcrumb('store.create.success', { storeId, code });

  return {
    storeId,
    code,
    name: trimmedName,
    ownerId: uid,
    role: 'owner',
    displayName: trimmedDisplay,
  };
}

// ─── 매장 코드로 매장 찾기 (가입 전 미리보기) ──────────
// hasRevenuePin: AuthScreen 이 "대표로 가입(PIN 인증)" 옵션 활성화 여부 결정에 사용.
// code: lastStore 캐시에 저장하기 위해 함께 반환 (가입 후 사고 시 자가 복구용).
export async function findStoreByCode(rawCode) {
  const db = requireDb();
  const code = normalizeStoreCode(rawCode);
  if (code.length !== CODE_LENGTH) {
    throw new Error('매장 코드는 8자리입니다.');
  }
  const codeSnap = await db.collection('storeCodes').doc(code).get();
  if (!snapExists(codeSnap)) {
    throw new Error('매장 코드를 찾을 수 없습니다. 대표에게 다시 확인하세요.');
  }
  const { storeId } = codeSnap.data();
  const storeSnap = await db.collection('stores').doc(storeId).get();
  if (!snapExists(storeSnap)) {
    throw new Error('매장 정보를 불러올 수 없습니다.');
  }
  const store = storeSnap.data();
  return {
    storeId,
    name: store.name,
    code,
    ownerId: store.ownerId,
    hasRevenuePin: !!(store.revenuePinHash && store.revenuePinSalt),
  };
}

// ─── 가입 요청 (직원) ────────────────────────────────────────
// stores/{storeId}/joinRequests/{uid} 문서 생성. 대표 폰에 listener 가 있어 알림 받음.
export async function requestJoin({ storeId, displayName }) {
  const db = requireDb();
  const uid = requireUid();

  const trimmed = (displayName || '').trim();
  if (!trimmed) throw new Error('본인 표시 이름을 입력해주세요.');

  await db
    .collection('stores')
    .doc(storeId)
    .collection('joinRequests')
    .doc(uid)
    .set({
      displayName: trimmed,
      requestedAt: serverTimestamp(),
    });

  addBreadcrumb('store.joinRequested', { storeId });
}

// ─── 가입 요청 승인 (대표) ───────────────────────────────────
// joinRequests 의 displayName 으로 members 생성 + joinRequests 삭제 (트랜잭션).
export async function approveJoinRequest({ storeId, requestUid }) {
  const db = requireDb();

  const requestRef = db
    .collection('stores')
    .doc(storeId)
    .collection('joinRequests')
    .doc(requestUid);
  const memberRef = db
    .collection('stores')
    .doc(storeId)
    .collection('members')
    .doc(requestUid);

  await db.runTransaction(async (tx) => {
    const reqSnap = await tx.get(requestRef);
    if (!snapExists(reqSnap)) throw new Error('이미 처리되었거나 취소된 요청입니다.');
    const { displayName } = reqSnap.data();
    tx.set(memberRef, {
      role: 'staff',
      displayName: displayName || '',
      joinedAt: serverTimestamp(),
    });
    tx.delete(requestRef);
  });

  addBreadcrumb('store.staffApproved', { storeId, memberUid: requestUid });
}

// ─── 가입 요청 거부 (대표) ───────────────────────────────────
export async function rejectJoinRequest({ storeId, requestUid }) {
  const db = requireDb();
  await db
    .collection('stores')
    .doc(storeId)
    .collection('joinRequests')
    .doc(requestUid)
    .delete();
  addBreadcrumb('store.staffRejected', { storeId, memberUid: requestUid });
}

// ─── 본인 가입 요청 취소 (직원, 승인 대기 중) ────────────────
export async function cancelJoinRequest({ storeId }) {
  const db = requireDb();
  const uid = requireUid();
  await db
    .collection('stores')
    .doc(storeId)
    .collection('joinRequests')
    .doc(uid)
    .delete();
}

// ─── 멤버 강제 제거 (대표) ───────────────────────────────────
// 강퇴된 멤버는 onSnapshot 리스너로 감지 → 즉시 unjoined 전환.
export async function removeMember({ storeId, memberUid }) {
  const db = requireDb();
  await db
    .collection('stores')
    .doc(storeId)
    .collection('members')
    .doc(memberUid)
    .delete();
  addBreadcrumb('store.memberRemoved', { storeId, memberUid });
}

// ─── 매장 통째 삭제 (대표만) ──────────────────────────────
// 매장을 완전히 정리할 때 사용. 모든 멤버가 UNJOINED 상태로 전환됨.
//
// 삭제 순서가 중요: 멤버를 먼저 지우면 isOwner 권한이 사라져서 그 다음 단계가 막힘.
// 1. 데이터 서브컬렉션 (멤버 권한으로 가능): menu/orders/history/addresses/state
// 2. joinRequests (대표만): 가입 요청 제거
// 3. 다른 멤버 (대표만): 본인 owner doc 제외하고 직원 제거
// 4. 매장 코드 매핑: 대표만 삭제 가능 (rules 가 매장 ownerId 확인)
// 5. 매장 doc: 대표만
// 6. 본인 owner 멤버 doc: 마지막에 삭제 (이게 빠지면 isOwner 못 함)
//
// 단계별 try/catch — 일부 실패해도 계속 진행하여 최대한 정리.
// batch.commit() 은 RNFirebase v24 + 새 아키텍처 네이티브 크래시 위험 → 순차 delete.
export async function deleteStore({ storeId }) {
  const db = requireDb();
  const uid = requireUid();
  const storeRef = db.collection('stores').doc(storeId);

  const storeSnap = await storeRef.get();
  if (!snapExists(storeSnap)) {
    addBreadcrumb('store.deleteSkipped', { storeId, reason: 'notFound' });
    return;
  }
  const storeData = storeSnap.data() || {};
  if (storeData.ownerId !== uid) {
    throw new Error('대표만 매장을 삭제할 수 있습니다.');
  }

  addBreadcrumb('store.delete.start', { storeId });

  // 1) 운영 데이터 서브컬렉션 — isMember 권한이라 owner 인 동안 모두 가능.
  const dataSubcollections = ['menu', 'orders', 'history', 'addresses', 'state'];
  for (const sub of dataSubcollections) {
    try {
      const snap = await storeRef.collection(sub).get();
      for (const doc of snap.docs) {
        try { await doc.ref.delete(); } catch {}
      }
    } catch {}
  }

  // 2) 가입 요청 — 대표 권한
  try {
    const snap = await storeRef.collection('joinRequests').get();
    for (const doc of snap.docs) {
      try { await doc.ref.delete(); } catch {}
    }
  } catch {}

  // 3) 다른 멤버(직원) 제거 — 본인 owner doc 은 마지막에 삭제하므로 제외.
  try {
    const snap = await storeRef.collection('members').get();
    for (const doc of snap.docs) {
      if (doc.id === uid) continue; // 본인 owner doc 은 마지막에
      try { await doc.ref.delete(); } catch {}
    }
  } catch {}

  // 4) 매장 코드 매핑 제거 — 본인 owner doc 살아있으니 isOwner 통과.
  if (storeData.code) {
    try { await db.collection('storeCodes').doc(storeData.code).delete(); } catch {}
  }

  // 5) 매장 doc 삭제 — owner doc 살아있으니 isOwner 통과.
  try { await storeRef.delete(); } catch {}

  // 6) 본인 owner 멤버 doc 마지막 삭제. 이거 빠지면 다음 부팅 시 isMember 캐시로
  //    JOINED 상태로 잠깐 보일 수 있어 명시적으로 정리.
  //    매장 doc 이 이미 삭제됐어도 본인 doc 은 본인이 항상 삭제 가능 (rules: memberUid == uid()).
  try {
    await storeRef.collection('members').doc(uid).delete();
  } catch {}

  addBreadcrumb('store.delete.success', { storeId });
}

// ─── 본인 탈퇴 ──────────────────────────────────────────────
export async function leaveStore({ storeId }) {
  const db = requireDb();
  const uid = requireUid();
  await db
    .collection('stores')
    .doc(storeId)
    .collection('members')
    .doc(uid)
    .delete();
  addBreadcrumb('store.left', { storeId });
}

// ─── 매장 주소 + 좌표 업데이트 (대표) ────────────────────────
// 주소는 카카오 Local API 로 변환된 좌표와 함께 저장 — 배달 거리 계산 기준점.
// address/lat/lng 모두 null 허용 (해제). 보안 규칙은 owner 만 stores 문서 update 허용 가정.
export async function updateStoreAddress({ storeId, address, lat, lng }) {
  const db = requireDb();
  const trimmed = typeof address === 'string' ? address.trim().slice(0, 200) : '';
  const validLat = typeof lat === 'number' && isFinite(lat) && lat >= -90 && lat <= 90;
  const validLng = typeof lng === 'number' && isFinite(lng) && lng >= -180 && lng <= 180;
  await db
    .collection('stores')
    .doc(storeId)
    .set(
      {
        address: trimmed || null,
        lat: validLat ? lat : null,
        lng: validLng ? lng : null,
      },
      { merge: true }
    );
  addBreadcrumb('store.address.update', { storeId, hasCoord: validLat && validLng });
}

// ─── 가입 요청 목록 listener (대표 화면) ─────────────────────
// onChange: (requests: Array<{ uid, displayName, requestedAt }>) => void
export function subscribeJoinRequests(storeId, onChange) {
  const db = requireDb();
  return db
    .collection('stores')
    .doc(storeId)
    .collection('joinRequests')
    .onSnapshot(
      (snap) => {
        if (!snap) return;
        const list = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
        onChange(list);
      },
      (err) => {
        // permission-denied 등 — 조용히 무시 (크래시 방지)
        addBreadcrumb('store.joinRequests.error', { code: err?.code });
      }
    );
}

// ─── 멤버 목록 listener (멤버 관리 화면) ─────────────────────
export function subscribeMembers(storeId, onChange) {
  const db = requireDb();
  return db
    .collection('stores')
    .doc(storeId)
    .collection('members')
    .onSnapshot(
      (snap) => {
        if (!snap) return;
        const list = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
        onChange(list);
      },
      (err) => {
        addBreadcrumb('store.members.error', { code: err?.code });
      }
    );
}

// ─── owner 자가 복구 — 매장 PIN 인증으로 본인 owner 멤버 등록 ──────────
// 익명 UID 손실(TestFlight 새 빌드 / .exe autoUpdater 첫 부팅 / keychain 분리 등)로
// 대표가 본인 매장 owner 권한을 잃은 경우, 매장 PIN 으로 본인 인증 후 owner 멤버 자가 등록.
//
// 보안 트레이드오프 (필수 인지):
//   - 매장 PIN 알면 누구나 owner 가 될 수 있음 (직원이 PIN 알면 owner 탈취 가능)
//   - 매장 PIN 미설정 매장은 자동 복구 불가능 — Firebase Console 에서 직접 ownerId 수정 필요
//
// stores.ownerId 는 변경 안 됨 (rules 가 변경 금지). isOwner() 는 members.role 기반이라
// 권한은 정상 작동하지만, deleteStore() 는 stores.ownerId 와 비교하므로 새 owner 는 매장 삭제 불가.
export async function rejoinAsOwnerWithPin({ storeId, plainPin, displayName }) {
  const db = requireDb();
  const uid = requireUid();

  const storeRef = db.collection('stores').doc(storeId);
  const snap = await storeRef.get();
  if (!snapExists(snap)) throw new Error('매장을 찾을 수 없습니다.');
  const store = snap.data();

  if (!store.revenuePinHash || !store.revenuePinSalt) {
    throw new Error(
      '매장 PIN 이 설정돼 있지 않아 자동 복구가 불가능합니다.\n' +
      '다른 owner 폰의 승인을 받거나, Firebase Console 에서 ownerId 를 직접 수정해주세요.'
    );
  }

  const pinOk = await verifyRevenuePin(
    { revenuePinHash: store.revenuePinHash, revenuePinSalt: store.revenuePinSalt },
    plainPin
  );
  if (!pinOk) throw new Error('매장 PIN 이 일치하지 않습니다.');

  // members/{uid} 에 owner 로 자가 등록.
  // rules 통과: memberUid == uid() && role == 'owner' (firestore.rules:80).
  await storeRef.collection('members').doc(uid).set({
    role: 'owner',
    displayName: (displayName || '대표').trim(),
    joinedAt: serverTimestamp(),
  });

  addBreadcrumb('store.rejoinAsOwner', { storeId });

  return {
    storeId,
    code: store.code,
    name: store.name,
    ownerId: store.ownerId, // 옛 ownerId 그대로 (rules 가 변경 금지)
    role: 'owner',
    displayName: (displayName || '대표').trim(),
  };
}
