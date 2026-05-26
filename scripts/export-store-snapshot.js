// 사장님 매장의 Firestore 데이터를 JSON 파일로 dump.
// 회귀 안전망 — 향후 사고 시 restore-store-snapshot.js 로 복원 가능.
//
// 사용:
//   node scripts/export-store-snapshot.js <storeId> [outDir]
//
// outDir 미지정 시 docs/snapshots/<storeId>-<YYYY-MM-DD-HHMM>/ 에 저장.
//
// dump 대상 sub-collection:
//   - 매장 문서 자체 (이름/주소/PIN/ownerId)
//   - members (멤버 + role)
//   - menu (메뉴 카탈로그)
//   - orders (진행 중 주문)
//   - history (매출 이력)
//   - addresses (주소록)
//   - state (settings: menu_rows / editable_options / groups / splits 등)
//   - joinRequests (가입 요청)

const fs = require('fs');
const path = require('path');
const https = require('https');

const STORE_ID = process.argv[2];
if (!STORE_ID) {
  console.error('Usage: node export-store-snapshot.js <storeId> [outDir]');
  process.exit(1);
}

const ts = new Date()
  .toISOString()
  .replace(/[:T]/g, '-')
  .slice(0, 16);
const OUT_DIR =
  process.argv[3] ||
  path.join(__dirname, '..', 'docs', 'snapshots', `${STORE_ID}-${ts}`);

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

function getJson(urlPath) {
  return new Promise((resolve, reject) => {
    const opts = {
      method: 'GET',
      hostname: 'firestore.googleapis.com',
      path: urlPath,
      headers: { Authorization: `Bearer ${token}` },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`${res.statusCode} ${data.slice(0, 200)}`));
        } else {
          resolve(JSON.parse(data));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function exportCollection(subPath) {
  const all = [];
  let pageToken = '';
  do {
    const qs = pageToken
      ? `?pageSize=300&pageToken=${encodeURIComponent(pageToken)}`
      : '?pageSize=300';
    const res = await getJson(
      `/v1/projects/${PROJECT}/databases/(default)/documents/stores/${STORE_ID}/${subPath}${qs}`
    );
    if (Array.isArray(res.documents)) all.push(...res.documents);
    pageToken = res.nextPageToken || '';
  } while (pageToken);
  return all;
}

async function exportDoc(subPath) {
  try {
    return await getJson(
      `/v1/projects/${PROJECT}/databases/(default)/documents/stores/${STORE_ID}/${subPath}`
    );
  } catch (e) {
    if (e.message.startsWith('404')) return null;
    throw e;
  }
}

(async () => {
  console.log(`매장: stores/${STORE_ID}`);
  console.log(`저장 경로: ${OUT_DIR}`);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const storeDoc = await exportDoc('');
  fs.writeFileSync(
    path.join(OUT_DIR, '_store.json'),
    JSON.stringify(storeDoc, null, 2)
  );
  console.log(`  매장 문서 ✓ (name=${storeDoc?.fields?.name?.stringValue || '?'})`);

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
    try {
      const docs = await exportCollection(sub);
      fs.writeFileSync(
        path.join(OUT_DIR, `${sub}.json`),
        JSON.stringify(docs, null, 2)
      );
      console.log(`  ${sub}: ${docs.length}건 ✓`);
    } catch (e) {
      console.error(`  ${sub}: ERROR ${e.message}`);
    }
  }

  fs.writeFileSync(
    path.join(OUT_DIR, '_meta.json'),
    JSON.stringify(
      {
        storeId: STORE_ID,
        exportedAt: new Date().toISOString(),
        project: PROJECT,
      },
      null,
      2
    )
  );
  console.log(`완료. 복원: node scripts/restore-store-snapshot.js ${STORE_ID} "${OUT_DIR}"`);
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
