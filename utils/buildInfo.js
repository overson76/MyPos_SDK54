// 앱 빌드 번호 — 배포할 때마다 수동으로 올림.
// iOS 는 app.json 의 ios.buildNumber 와 동기화,
// 웹/Electron 은 Constants.nativeBuildVersion 이 없으므로 여기서 직접 읽음.
export const BUILD_NUMBER = 13;

// 사용자에게 보이는 "현재버전" 표기용.
//
// 2026-05-29: 옛 하드코딩('1.0.52') 이 package.json(1.0.53) + GitHub Releases
// (v1.0.53) 와 어긋나 "새 버전 있음" 이 *영구* 표시되던 버그 처방 — 사장님 신고.
// 5/24 에 1.0.53 릴리스 publish 할 때 이 상수 갱신을 빠뜨린 게 원인.
// 이제 package.json 의 version 을 직접 참조 → 배포 시 자동 동기화, 다신 안 어긋남.
// (Metro/Expo 는 JSON import 지원. version 외 필드는 트리쉐이킹.)
import { version as PKG_VERSION } from '../package.json';
export const APP_VERSION = PKG_VERSION;
