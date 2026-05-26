// 결정적 복구 스크립트 — Firebase JS SDK 를 Node.js 에서 사용해서
// 사장님 매장의 menu_rows 를 defaultCategoryRows 로 강제 set.
//
// 절차:
//   1. firestore.rules 의 state/{stateId} 의 write 를 임시 풀어야 한다 (별도 단계).
//   2. 이 스크립트 실행 — anon auth + setDoc.
//   3. rules 원복.
//
// nested array (array of array) 처리:
//   Firestore 는 직접 못 받지만 Firebase JS SDK 가 어떻게 처리하는지 직접 검증.

const path = require('path');
const fs = require('fs');

// .env 수동 로드 (dotenv 미설치)
{
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
}

const { initializeApp } = require('firebase/app');
const {
  getFirestore,
  doc,
  setDoc,
  getDoc,
} = require('firebase/firestore');
const { getAuth, signInAnonymously } = require('firebase/auth');

const STORE_ID = process.argv[2] || 'i1rfYjK9SXsmLEzcAcui';

const { defaultCategoryRows } = require(path.join(
  __dirname,
  '..',
  'utils',
  'menuData'
));

const app = initializeApp({
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
});

const db = getFirestore(app);
const auth = getAuth(app);

(async () => {
  try {
    console.log('1. 익명 인증 시작...');
    const cred = await signInAnonymously(auth);
    console.log('   uid:', cred.user.uid);

    console.log('2. setDoc 시도 — nested array 처리 검증...');
    await setDoc(
      doc(db, 'stores', STORE_ID, 'state', 'menu_rows'),
      { value: defaultCategoryRows }
    );
    console.log('   set OK');

    console.log('3. 결과 read back...');
    const snap = await getDoc(
      doc(db, 'stores', STORE_ID, 'state', 'menu_rows')
    );
    if (snap.exists()) {
      const data = snap.data();
      console.log('   exists. value keys:', Object.keys(data.value || {}));
      console.log(
        '   sample 즐겨찾기:',
        JSON.stringify(data.value?.['즐겨찾기']?.slice(0, 1))
      );
    } else {
      console.log('   not exists');
    }
    process.exit(0);
  } catch (err) {
    console.error('ERROR:', err.code || '', err.message);
    if (err.code === 'permission-denied') {
      console.error('  → rules 가 막음. state/{stateId} write 임시 허용 필요.');
    }
    process.exit(1);
  }
})();
