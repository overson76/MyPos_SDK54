// 일회용 복구 스크립트 — 사장님 매장의 menu_rows 를 defaultCategoryRows 로 강제 set.
// firebase-tools 의 OAuth access_token 을 사용해 Firestore REST API 호출.
const fs = require('fs');
const path = require('path');
const https = require('https');

const STORE_ID = process.argv[2];
if (!STORE_ID) {
  console.error('Usage: node restore-menu-rows.js <storeId>');
  process.exit(1);
}

const PROJECT = 'mypos-4cfcc';
const TOKEN_FILE = path.join(
  process.env.USERPROFILE || process.env.HOME,
  '.config',
  'configstore',
  'firebase-tools.json'
);

const cfg = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
const token = cfg.tokens?.access_token;
if (!token) {
  console.error('access_token 없음 — firebase login 먼저 실행');
  process.exit(1);
}

const { defaultCategoryRows } = require(path.join(
  __dirname,
  '..',
  'utils',
  'menuData'
));

// JS value → Firestore REST value 변환. Firestore 는 array of array 직접 X →
// inner array 는 mapValue 로 wrapping 해야 한다.
function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'number') {
    return Number.isInteger(v)
      ? { integerValue: String(v) }
      : { doubleValue: v };
  }
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (Array.isArray(v)) {
    return { arrayValue: { values: v.map(toFirestoreValue) } };
  }
  if (typeof v === 'object') {
    const fields = {};
    for (const k of Object.keys(v)) {
      fields[k] = toFirestoreValue(v[k]);
    }
    return { mapValue: { fields } };
  }
  throw new Error('unknown type: ' + typeof v);
}

const body = JSON.stringify({
  fields: {
    value: toFirestoreValue(defaultCategoryRows),
  },
});

const opts = {
  method: 'PATCH',
  hostname: 'firestore.googleapis.com',
  path: `/v1/projects/${PROJECT}/databases/(default)/documents/stores/${STORE_ID}/state/menu_rows`,
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  },
};

const req = https.request(opts, (res) => {
  let data = '';
  res.on('data', (c) => (data += c));
  res.on('end', () => {
    console.log('status:', res.statusCode);
    console.log(data);
  });
});
req.on('error', (err) => {
  console.error('error:', err.message);
  process.exit(1);
});
req.write(body);
req.end();
