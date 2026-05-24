#!/usr/bin/env node
/**
 * NAS ↔ 로컬 비밀값 동기화.
 *
 * 동작 — mtime 기반 양방향 sync:
 *   - 양쪽 모두 있음 → 더 최신을 다른 쪽으로 복사 (로컬 덮어쓰기 전 .bak 백업)
 *   - 한쪽만 있음 → 다른 쪽으로 복사
 *   - 양쪽 없음 → skip
 *   - NAS 미마운트 / 환경변수 미설정 → silent skip (영업 안 멎게)
 *
 * 명시적 push: `node scripts/sync-secrets.js push` — 로컬 → NAS 강제.
 *
 * NAS 경로 우선순위:
 *   1. 환경변수 MYPOS_NAS_SECRETS (예: Z:\secrets\mypos 또는 /Volumes/secrets/mypos)
 *   2. OS 별 흔한 마운트 경로 자동 탐지
 *
 * 동기화 대상:
 *   - <project>/.env                              ↔  <NAS>/.env
 *   - <home>/.expo/state.json                     ↔  <NAS>/expo-state.json
 *   - <home>/.wrangler/config/default.toml        ↔  <NAS>/wrangler-config.toml
 *     (Cloudflare wrangler OAuth 토큰 — npm run deploy:web 비대화형 인증)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const HOME = os.homedir();

const FILES = [
  { local: path.join(PROJECT_ROOT, '.env'), nasName: '.env', label: '.env' },
  { local: path.join(HOME, '.expo', 'state.json'), nasName: 'expo-state.json', label: 'EAS state' },
  // 2026-05-24: wrangler 4.x OAuth 토큰을 NAS 공유. 한 PC 에서 `wrangler login`
  // 1회면 모든 PC 가 자동 받아 deploy:web 비대화형 인증 통과. 미인증 PC 에서는
  // 파일이 없어 silent skip → 영업 안 멎음.
  { local: path.join(HOME, '.wrangler', 'config', 'default.toml'), nasName: 'wrangler-config.toml', label: 'wrangler config' },
];

function log(msg) {
  process.stdout.write(`[secrets] ${msg}\n`);
}

function resolveNasDir() {
  if (process.env.MYPOS_NAS_SECRETS) return process.env.MYPOS_NAS_SECRETS;

  const candidates = process.platform === 'win32'
    ? ['Z:\\secrets\\mypos', 'Y:\\secrets\\mypos', '\\\\NAS\\secrets\\mypos']
    : process.platform === 'darwin'
      ? ['/Volumes/secrets/mypos', '/Volumes/NAS/secrets/mypos', path.join(HOME, 'NAS', 'secrets', 'mypos')]
      : [path.join(HOME, 'NAS', 'secrets', 'mypos')];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch { /* ENOENT 등 무시 */ }
  }
  return null;
}

function statMtime(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return null;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dst) {
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
}

function bytesEqual(a, b) {
  try {
    const ba = fs.readFileSync(a);
    const bb = fs.readFileSync(b);
    return ba.equals(bb);
  } catch {
    return false;
  }
}

function ensureNasReadme(nasDir) {
  const readme = path.join(nasDir, 'README.txt');
  if (fs.existsSync(readme)) return;
  const body = [
    'MyPos 비밀값 보관소 (NAS).',
    '',
    '이 폴더는 깃에 절대 올리지 않습니다. 외부 공유 금지.',
    '운영 PC (윈도우 / 맥북) 가 npm start 시 자동으로 동기화합니다.',
    '',
    '키 갱신 시: 어느 PC 든 로컬 .env 수정 후 `npm run secrets:push` 또는',
    '            여기 .env 를 직접 편집 (다음 npm start 시 다른 PC 가 자동 pull).',
    '',
    `생성: ${new Date().toISOString()}`,
    '',
  ].join('\n');
  fs.writeFileSync(readme, body, 'utf8');
}

function syncOne({ local, nasName, label }, nasDir, mode) {
  const nasPath = path.join(nasDir, nasName);
  const lt = statMtime(local);
  const nt = statMtime(nasPath);

  if (mode === 'push') {
    if (lt == null) {
      log(`  - ${label}: 로컬 없음, push skip`);
      return;
    }
    copyFile(local, nasPath);
    log(`  ✓ ${label}: 로컬 → NAS (push)`);
    return;
  }

  // mode === 'sync'
  if (lt == null && nt == null) {
    log(`  - ${label}: 양쪽 없음, skip`);
    return;
  }

  if (lt != null && nt == null) {
    copyFile(local, nasPath);
    log(`  ✓ ${label}: 로컬 → NAS (NAS 비어있어 초기 등록)`);
    return;
  }

  if (lt == null && nt != null) {
    copyFile(nasPath, local);
    log(`  ✓ ${label}: NAS → 로컬 (새 환경 등록)`);
    return;
  }

  // 양쪽 모두 있음
  if (bytesEqual(local, nasPath)) {
    log(`  - ${label}: 동일, skip`);
    return;
  }

  // mtime 차이가 1초 이내면 동일로 간주 (FS 정밀도 / 네트워크 NAS 보정)
  if (Math.abs(lt - nt) < 1000) {
    log(`  - ${label}: 내용 다르지만 mtime 유사 — 안전상 skip (push/pull 명시 명령 권장)`);
    return;
  }

  if (lt > nt) {
    copyFile(local, nasPath);
    log(`  ✓ ${label}: 로컬 → NAS (로컬이 더 최신)`);
    return;
  }

  // NAS 가 더 최신 — 로컬 백업 후 덮어쓰기
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${local}.bak.${stamp}`;
  try {
    fs.copyFileSync(local, backup);
  } catch (e) {
    log(`  ! ${label}: 로컬 백업 실패 (${e.message}) — 동기화 중단`);
    return;
  }
  copyFile(nasPath, local);
  log(`  ✓ ${label}: NAS → 로컬 (NAS 가 더 최신, 로컬 백업: ${path.basename(backup)})`);
}

function main() {
  const mode = (process.argv[2] || 'sync').toLowerCase();
  if (mode !== 'sync' && mode !== 'push') {
    log(`알 수 없는 모드: ${mode}. 사용법: node scripts/sync-secrets.js [sync|push]`);
    process.exit(2);
  }

  const nasDir = resolveNasDir();
  if (!nasDir) {
    log('NAS 미설정 — skip. (환경변수 MYPOS_NAS_SECRETS 설정 또는 표준 경로 마운트 필요)');
    return;
  }

  let exists = false;
  try {
    exists = fs.statSync(nasDir).isDirectory();
  } catch { /* 폴더 없거나 마운트 끊김 */ }

  if (!exists) {
    if (mode === 'push') {
      ensureDir(nasDir);
      exists = true;
    } else {
      log(`NAS 폴더 없음 (${nasDir}) — skip. 네트워크 / 공유 마운트 확인.`);
      return;
    }
  }

  log(`NAS 위치: ${nasDir}  (mode=${mode})`);

  try {
    ensureNasReadme(nasDir);
  } catch (e) {
    // 권한 / 잠시 끊김 등 — 동기화 자체는 시도
    log(`  ! README 생성 skip (${e.message})`);
  }

  for (const file of FILES) {
    try {
      syncOne(file, nasDir, mode);
    } catch (e) {
      log(`  ! ${file.label}: 오류 (${e.message}) — 다음 파일로 진행`);
    }
  }

  log('완료.');
}

main();
