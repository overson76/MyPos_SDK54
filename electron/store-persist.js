// 매장 멤버십 파일 영속화 — 재설치해도 매장 연동 유지.
//
// 문제: Electron 앱 재설치 시 IndexedDB/localStorage 초기화
//       → 익명 UID 새로 발급 → 멤버십 사라짐 → 매장 코드 재입력 필요.
//
// 해결: storeMembership 을 앱 데이터 폴더(userData) 의 JSON 파일에도 저장.
//   - userData 폴더는 NSIS 재설치 시 유지됨 (deleteAppDataOnUninstall: false 설정).
//   - 앱 시작 시 파일 읽어 AsyncStorage 로 주입 → 자동 재연결.

const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const PERSIST_FILE = path.join(app.getPath('userData'), 'store-membership.json');

// 렌더러 → 메인: storeMembership 저장 요청
function saveMembership(data) {
  try {
    fs.writeFileSync(PERSIST_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.warn('[persist] 멤버십 저장 실패:', e.message);
  }
}

// 앱 시작 시: 파일에서 멤버십 읽기
function loadMembership() {
  try {
    if (!fs.existsSync(PERSIST_FILE)) return null;
    const raw = fs.readFileSync(PERSIST_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

// 멤버십 삭제 (탈퇴/강퇴 시)
function clearMembership() {
  try {
    if (fs.existsSync(PERSIST_FILE)) fs.unlinkSync(PERSIST_FILE);
  } catch {}
}

module.exports = { saveMembership, loadMembership, clearMembership };
