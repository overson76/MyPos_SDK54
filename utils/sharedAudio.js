// 매장 공유 음성/사운드 알림 — Firestore 도큐먼트 한 곳에 이벤트를 박으면
// 모든 매장 멤버 기기가 listener 로 받아 동시에 재생.
//
// 패턴:
//   - 트리거 기기는 _localDispatch 로 본인도 즉시 재생 (네트워크 왕복 대기 X)
//   - Firestore 의 stores/{sid}/state/audioEvent 단일 문서를 set → 다른 기기 onSnapshot
//   - listener 는 payload.source !== 본인 uid 일 때만 재생 (본인 trigger 중복 방지)
//   - storeId 미설정/네트워크 끊김이면 본인만 재생 (graceful fallback)
//
// 음성 텍스트 / 사운드 종류는 notify.js 의 _localDispatch 함수가 해석.
// 호출자(OrderScreen 등) 는 notify.js 의 export 함수만 사용 — sharedAudio 직접 사용 X.

import { getFirestore, getCurrentUid } from './firebase';
import { snapExists } from './firestoreCompat';
import { reportError } from './sentry';

const DOC_PATH_COLLECTION = 'state';
const DOC_PATH_ID = 'audioEvent';

let _storeId = null;
let _unsub = null;
let _localDispatch = null;
// 첫 mount 시점 이전의 옛 이벤트는 무시. 신규 이벤트만 재생.
let _lastReceivedTs = 0;

// notify.js 가 호출 — 본인 기기에서 실제 재생할 함수를 등록.
export function registerLocalDispatch(fn) {
  _localDispatch = typeof fn === 'function' ? fn : null;
}

// App.js 또는 Provider 에서 storeId 변경 시 호출.
// storeId 가 null 이면 listener teardown 만.
export function setSharedAudioStore(storeId) {
  if (_unsub) {
    try {
      _unsub();
    } catch (e) {}
    _unsub = null;
  }
  _storeId = storeId || null;
  if (!_storeId) return;

  const db = getFirestore();
  if (!db) return;

  // 첫 mount 직후의 옛 이벤트(어제/방금 전) 가 자동 재생되지 않게 cutoff.
  _lastReceivedTs = Date.now();

  try {
    _unsub = db
      .collection('stores')
      .doc(_storeId)
      .collection(DOC_PATH_COLLECTION)
      .doc(DOC_PATH_ID)
      .onSnapshot(
        (snap) => {
          if (!snapExists(snap)) return;
          const data = snap.data();
          if (!data || typeof data.ts !== 'number') return;
          if (data.ts <= _lastReceivedTs) return; // 옛/중복 이벤트
          _lastReceivedTs = data.ts;

          // 본인이 trigger 한 이벤트는 이미 _localDispatch 로 즉시 재생됐으니 skip.
          const myUid = getCurrentUid();
          if (data.source && myUid && data.source === myUid) return;

          if (_localDispatch) {
            try {
              _localDispatch(data);
            } catch (e) {
              reportError(e, { ctx: 'sharedAudio.localDispatch', payload: data });
            }
          }
        },
        (err) => reportError(err, { ctx: 'sharedAudio.listener', storeId: _storeId })
      );
  } catch (e) {
    reportError(e, { ctx: 'sharedAudio.subscribe', storeId: _storeId });
  }
}

// notify.js 가 호출 — 본인 즉시 재생 + Firestore 에 박아 다른 기기 알림.
// payload: { type: 'sound', sound: 'order'|'change'|... } | { type: 'speak', text: string }
export function triggerSharedAudio(payload) {
  if (!payload) return;

  // 1) 본인 즉시 재생 (네트워크 왕복 대기 없음)
  if (_localDispatch) {
    try {
      _localDispatch(payload);
    } catch (e) {
      reportError(e, { ctx: 'sharedAudio.localTrigger', payload });
    }
  }

  // 2) Firestore 에 박아 다른 기기들 알림
  if (!_storeId) return; // 매장 미가입 — 본인만 재생 (위에서 끝)
  const db = getFirestore();
  if (!db) return;

  const myUid = getCurrentUid();
  const ts = Date.now();
  // 본인 listener 가 자신의 이벤트로 인식해 skip 하도록 source 박음.
  // _lastReceivedTs 도 미리 갱신 — listener 가 본인 write 를 다시 받아도 self-skip + ts skip 이중 방어.
  _lastReceivedTs = ts;

  db.collection('stores')
    .doc(_storeId)
    .collection(DOC_PATH_COLLECTION)
    .doc(DOC_PATH_ID)
    .set({
      type: payload.type || null,
      sound: payload.sound || null,
      text: payload.text || null,
      ts,
      source: myUid || null,
    })
    .catch((e) => reportError(e, { ctx: 'sharedAudio.write', payload }));
}
