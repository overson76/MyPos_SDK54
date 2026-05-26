// 사장님 매장의 state/menu_rows listener emission 을 직접 받아서 확인.
// 클라이언트 빈 격자의 진짜 원인이 데이터인지 cache 인지 결정적 진단.
//
// 절차: anon 가입 → REST API admin 권한으로 매장 members 에 그 uid 임시 추가
//   → anon 클라이언트가 매장 멤버 권한으로 listener 등록 → emission 출력
//   → 진단 끝나면 members 에서 uid 제거.

const fs = require('fs');
const path = require('path');
const https = require('https');

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
const { getFirestore, doc, onSnapshot } = require('firebase/firestore');
const { getAuth, signInAnonymously } = require('firebase/auth');

const STORE_ID = process.argv[2] || 'i1rfYjK9SXsmLEzcAcui';
const PROJECT = 'mypos-4cfcc';
const TOKEN_FILE = path.join(
  process.env.USERPROFILE || process.env.HOME,
  '.config',
  'configstore',
  'firebase-tools.json'
);
const cfg = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
const adminToken = cfg.tokens.access_token;

function restCall(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      method,
      hostname: 'firestore.googleapis.com',
      path: urlPath,
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () =>
        resolve({ status: res.statusCode, body: data })
      );
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function addMember(uid) {
  return restCall(
    'PATCH',
    `/v1/projects/${PROJECT}/databases/(default)/documents/stores/${STORE_ID}/members/${uid}`,
    {
      fields: {
        role: { stringValue: 'owner' },
        displayName: { stringValue: '진단임시' },
      },
    }
  );
}

async function removeMember(uid) {
  return restCall(
    'DELETE',
    `/v1/projects/${PROJECT}/databases/(default)/documents/stores/${STORE_ID}/members/${uid}`
  );
}

const app = initializeApp({
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
});
const db = getFirestore(app);
const auth = getAuth(app);

(async () => {
  let uid = null;
  try {
    console.log('1. 익명 가입...');
    const cred = await signInAnonymously(auth);
    uid = cred.user.uid;
    console.log('   uid:', uid);

    console.log('2. members 에 임시 추가...');
    const r = await addMember(uid);
    console.log('   status:', r.status);
    if (r.status !== 200) {
      console.log('   body:', r.body.slice(0, 300));
      throw new Error('addMember failed');
    }

    console.log('3. menu_rows listener 등록 — 첫 emission 대기 (5초)...');
    await new Promise((resolve) => {
      const stop = onSnapshot(
        doc(db, 'stores', STORE_ID, 'state', 'menu_rows'),
        (snap) => {
          console.log('   --- emission ---');
          console.log('   exists:', snap.exists());
          if (snap.exists()) {
            const data = snap.data();
            console.log('   data keys:', Object.keys(data || {}));
            const v = data?.value;
            console.log('   value type:', typeof v);
            if (v && typeof v === 'object') {
              const keys = Object.keys(v);
              console.log('   value keys:', keys);
              for (const k of keys.slice(0, 3)) {
                const cat = v[k];
                if (Array.isArray(cat)) {
                  console.log(`   ${k}: array (${cat.length} rows)`);
                  console.log(`     first row:`, JSON.stringify(cat[0]));
                } else {
                  console.log(`   ${k}:`, JSON.stringify(cat).slice(0, 100));
                }
              }
            } else {
              console.log('   value:', JSON.stringify(v));
            }
          }
          setTimeout(() => { stop(); resolve(); }, 2000);
        },
        (err) => {
          console.error('   listener error:', err.code, err.message);
          resolve();
        }
      );
    });
  } catch (err) {
    console.error('ERROR:', err.code || '', err.message);
  } finally {
    if (uid) {
      console.log('4. members 에서 임시 제거...');
      const r = await removeMember(uid);
      console.log('   status:', r.status);
    }
    process.exit(0);
  }
})();
