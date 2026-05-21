// 앱 빌드 번호 — 배포할 때마다 수동으로 올림.
// iOS 는 app.json 의 ios.buildNumber 와 동기화,
// 웹/Electron 은 Constants.nativeBuildVersion 이 없으므로 여기서 직접 읽음.
export const BUILD_NUMBER = 12;

// 사용자에게 보이는 "현재버전" 표기용.
// package.json 의 version + GitHub Releases 의 latest tag 와 동기화 유지.
// 배포 흐름: package.json version 올림 → release 만들면 모든 기기 화면에
// "현재버전 == 최신버전" 으로 ✅ 최신 표시. 사장님이 "최신인가?" 한눈에 확인.
export const APP_VERSION = '1.0.52';
