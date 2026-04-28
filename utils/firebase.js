// Firebase 초기화 + 헬퍼 (네이티브 전용).
// 매장 단위 클라우드 공유 (Anonymous Auth + Firestore) 의 진입점.
//
// 설정 파일 (GoogleService-Info.plist / google-services.json) 이 프로젝트 루트에 없으면
// 네이티브 빌드가 안 되므로, JS 단에서는 따로 graceful skip 분기 안 둠.
// 대신 빌드 단계에서 사용자가 파일을 빠뜨리면 명확한 에러로 알게 됨.

import { getApp, getApps } from '@react-native-firebase/app';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';

let _initialized = false;

// Firebase 자체는 @react-native-firebase 가 네이티브 측에서 자동 init 함
// (google-services.json / GoogleService-Info.plist 기반).
// 이 함수는 JS 측 후처리 — 오프라인 캐시 활성화, 익명 로그인 보장 등.
export async function initFirebase() {
  if (_initialized) return;

  // 네이티브 init 이 끝났는지 sanity check.
  // getApps() 가 비어있다면 설정 파일 누락 — 명시적으로 throw.
  if (getApps().length === 0) {
    throw new Error(
      '[firebase] 네이티브 init 실패. GoogleService-Info.plist / google-services.json 이 프로젝트 루트에 있는지 확인하세요.'
    );
  }

  // Firestore 오프라인 캐시 활성화 — 매장 Wi-Fi 끊겨도 주문 받기 위해.
  // 기본값으로도 켜져 있지만 명시적으로 unlimited cache size 지정.
  firestore().settings({
    persistence: true,
    cacheSizeBytes: firestore.CACHE_SIZE_UNLIMITED,
  });

  // 익명 로그인 — 매장 코드 입력 전에도 uid 가 있어야 Firestore 읽기 가능.
  // 이미 로그인 상태면 skip.
  if (!auth().currentUser) {
    try {
      await auth().signInAnonymously();
    } catch (e) {
      // 네트워크 끊긴 첫 부팅이면 실패 가능. 다음 부팅/재시도 때 다시 시도.
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log('[firebase] 익명 로그인 실패 (네트워크 문제 가능):', e?.message);
      }
    }
  }

  _initialized = true;
}

export function getFirebaseApp() {
  return getApp();
}

export function getAuth() {
  return auth();
}

export function getFirestore() {
  return firestore();
}

export function getCurrentUid() {
  return auth().currentUser?.uid || null;
}

// Firestore Timestamp 헬퍼 — 매장/멤버/주문 문서에 createdAt/updatedAt 박을 때 사용.
// @react-native-firebase v22+ 에서 namespace API (FieldValue.serverTimestamp) 의 sentinel 직렬화가
// "Nested arrays are not supported" 로 거부되는 케이스가 있어, 클라이언트 Date 객체로 우회.
// Firestore 가 자동으로 Timestamp 로 변환해줌. 폰 시계 기반이라 약간 오차 가능 — 본격 운영 시
// modular API (`import { serverTimestamp } from '...'`) 또는 Cloud Function 으로 전환 검토.
export function serverTimestamp() {
  return new Date();
}
