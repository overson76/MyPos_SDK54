// 수익현황 PIN — 매장 단위 공유.
// 기기 PIN(pinLock.js) 과 분리 — PIN 해시는 stores/{storeId} 문서에 저장.
// 보안: 4자리 PIN 의 hash + salt 가 멤버에게 노출됨 (client-side brute force 가능).
// 매장 운영 규모에서 받아들이는 위험 — 직원이 PIN 모르면서 brute force 할 시나리오는 드뭄.

import { getFirestore } from './firebase';
import { addBreadcrumb } from './sentry';
import { genSalt, hashPin, isValidPin } from './pinLock';

// storeInfo 에 PIN 이 설정돼 있는지.
export function hasRevenuePin(storeInfo) {
  return !!(storeInfo?.revenuePinHash && storeInfo?.revenuePinSalt);
}

// PIN 검증 — storeInfo 의 hash/salt 를 client-side 비교.
// 별도 Firestore read 없음 (storeInfo 가 listener 로 이미 최신).
export async function verifyRevenuePin(storeInfo, pin) {
  if (!isValidPin(pin)) return false;
  if (!hasRevenuePin(storeInfo)) return false;
  const computed = await hashPin(pin, storeInfo.revenuePinSalt);
  return computed === storeInfo.revenuePinHash;
}

// PIN 설정/변경. 호출자가 사전에 기존 PIN 검증을 마쳐야 함 (대표만 설정 가능 정책은 호출 측에서).
export async function setRevenuePin({ storeId, newPin }) {
  if (!isValidPin(newPin))
    throw new Error('PIN 은 4자리 이상 8자리 이하 숫자입니다.');
  const db = getFirestore();
  if (!db) throw new Error('Firebase 가 초기화되지 않았습니다.');

  const salt = genSalt();
  const hash = await hashPin(newPin, salt);

  await db.collection('stores').doc(storeId).update({
    revenuePinHash: hash,
    revenuePinSalt: salt,
  });
  addBreadcrumb('store.revenuePinSet', { storeId });
}

// PIN 제거 — 잠금 해제 상태. 호출자가 권한 검증.
export async function clearRevenuePin({ storeId }) {
  const db = getFirestore();
  if (!db) throw new Error('Firebase 가 초기화되지 않았습니다.');
  await db.collection('stores').doc(storeId).update({
    revenuePinHash: null,
    revenuePinSalt: null,
  });
  addBreadcrumb('store.revenuePinCleared', { storeId });
}
