// 앱 빌드 번호 — 배포할 때마다 수동으로 올림.
// iOS 는 app.json 의 ios.buildNumber 와 동기화,
// 웹/Electron 은 Constants.nativeBuildVersion 이 없으므로 여기서 직접 읽음.
export const BUILD_NUMBER = 9;
