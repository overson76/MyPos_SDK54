// export-store-snapshot.js 가 만든 JSON dump 로부터 Firestore 데이터 복원.
//
// 사용:
//   node scripts/restore-store-snapshot.js <storeId> <snapshotDir>
//
// 동작:
//   - 매장 문서 + 7개 sub-collection (members/menu/orders/history/addresses/state/joinRequests)
//     의 각 문서를 PATCH 로 Firestore 에 set.
//   - 이미 존재하는 문서는 덮어쓰기 (merge=false). 멤버권한 등 영향 주의.
//   - nested array (예: state/menu_rows 의 value) 가 포함되면 Firestore 가 reject —
//     export 시점에 nested array 가 없었어야 정상. 사장님 매장 state/menu_rows 는
//     없는 게 정상 상태 (사고 후 진단으로 확인됨).
//
// 운영 정책:
//   - 같은 storeId 에 복원 = 옛 매장 데이터로 되돌리기. 영업 외 시간에만 권장.
//   - 다른 storeId 에 복원 = 새 매장으로 데이터 옮기기. ownerId 필드는 그대로라
//     ownerId 가 일치하는 사용자만 owner 권한 유지.

const fs = require('fs');
const path = require('path');
const https = require('https');

const STORE_ID = process.argv[2];
const SNAP_DIR = process.argv[3];
if (!STORE_ID || !SNAP_DIR) {
  console.error('Usage: node restore-store-snapshot.js <storeId> <snapshotDir>');
  process.exit(1);
}

if (!fs.existsSync(SNAP_DIR)) {
  console.error('snapshot 디렉토리 없음:', SNAP_DIR);
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
  console.error('access_token 없음 — firebase login 먼저');
  process.exit(1);
}

function restCall(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      method,
      hostname: 'firestore.googleapis.com',
      path: urlPath,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// 한 문서 PATCH. fields 는 export 시점의 Firestore 형식 그대로.
async function patchDoc(docName, fields) {
  if (!fields) return { status: 'skip-empty' };
  // export 의 name = projects/.../documents/stores/<src>/<sub>/<id> →
  // 새 storeId 로 path 변경
  const pathParts = docName.split('/documents/')[1];
  const subParts = pathParts.split('/');
  // ['stores', '<src>', ...rest]
  subParts[1] = STORE_ID;
  const newPath = subParts.join('/');

  return restCall(
    'PATCH',
    `/v1/projects/${PROJECT}/databases/(default)/documents/${newPath}`,
    { fields }
  );
}

async function patchStoreDoc(json) {
  if (!json?.fields) return;
  return restCall(
    'PATCH',
    `/v1/projects/${PROJECT}/databases/(default)/documents/stores/${STORE_ID}`,
    { fields: json.fields }
  );
}

(async () => {
  console.log(`복원 대상: stores/${STORE_ID}`);
  console.log(`소스: ${SNAP_DIR}`);

  // 매장 문서
  const storePath = path.join(SNAP_DIR, '_store.json');
  if (fs.existsSync(storePath)) {
    const j = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    const r = await patchStoreDoc(j);
    console.log(`  매장 문서 → status=${r?.status || 'skip'}`);
  }

  // sub-collections
  const subs = [
    'members',
    'menu',
    'orders',
    'history',
    'addresses',
    'state',
    'joinRequests',
  ];
  for (const sub of subs) {
    const subPath = path.join(SNAP_DIR, `${sub}.json`);
    if (!fs.existsSync(subPath)) {
      console.log(`  ${sub}: 파일 없음, skip`);
      continue;
    }
    const docs = JSON.parse(fs.readFileSync(subPath, 'utf8'));
    let ok = 0,
      fail = 0;
    for (const doc of docs) {
      const r = await patchDoc(doc.name, doc.fields);
      if (r.status >= 200 && r.status < 300) ok++;
      else {
        fail++;
        if (fail <= 3) console.log(`    fail: ${doc.name.split('/').pop()} → ${r.status} ${r.body.slice(0, 100)}`);
      }
    }
    console.log(`  ${sub}: 성공=${ok}, 실패=${fail}`);
  }
  console.log('복원 완료');
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
