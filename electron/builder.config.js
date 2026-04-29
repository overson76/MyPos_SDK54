// electron-builder 설정. JS 형식으로 작성하면 주석 + 동적 값 사용 가능.
//
// 산출물:
//   - portable: 설치 안 해도 .exe 더블클릭으로 실행. USB 로 옮겨서 다른 매장 PC 에 즉시 사용.
//   - nsis: Windows 정식 인스톨러. 시작 메뉴 / 바탕화면 바로가기 자동 생성.
//
// 코드 서명 (code signing): 미적용. Windows SmartScreen 이 "알 수 없는 게시자" 경고 띄움 →
// "추가 정보 → 실행" 클릭으로 우회. 공식 배포 시 EV Code Signing 인증서 (~연 $300) 구매하면 해결.
// 자체 매장 사용 단계에서는 미서명으로 충분.

const path = require('node:path');

module.exports = {
  appId: 'com.cadpia.mypos',
  productName: 'MyPos',
  artifactName: '${productName}-${version}-${arch}.${ext}',
  copyright: 'Copyright © 2026 cadpia',

  // 빌드된 .exe 의 package.json 의 main 만 override.
  // 루트 package.json 의 main: "index.js" 는 Expo 진입점으로 그대로 둠 — 빌드 시 충돌 회피.
  extraMetadata: {
    main: 'electron/main.js',
  },

  // 빌드 산출물에 포함할 파일들 — electron/ 폴더 전체 + Node 의존성.
  // 웹 빌드(dist/) 는 라이브 URL 로드라 미포함 (오프라인 모드는 향후 Phase 에서).
  files: [
    'electron/**/*',
    'package.json',
    '!**/node_modules/*/{CHANGELOG.md,README.md,README,readme.md,readme}',
    '!**/node_modules/*/{test,__tests__,tests,powered-test,example,examples}',
    '!**/{.DS_Store,.git,.gitignore,.npmrc,.eslintrc.json}',
  ],

  // 별도 폴더에 산출물 모아둠 — 루트 dist/ (Expo web build) 와 충돌 안 나게.
  directories: {
    output: path.join(__dirname, '..', 'electron-dist'),
    buildResources: path.join(__dirname, 'build'),
  },

  // Windows 타겟 — 매장 PC 우선.
  win: {
    target: [
      { target: 'portable', arch: ['x64'] },
      { target: 'nsis', arch: ['x64'] },
    ],
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    // SmartScreen 경고가 뜨겠지만 자체 매장 사용은 무방. 향후 EV 인증서 구매 시 추가.
  },

  // NSIS 인스톨러 옵션 — 매장 사장님이 알아서 설치할 수 있게 친숙한 UI.
  nsis: {
    oneClick: false, // 사용자 옵션 선택 가능
    perMachine: false, // 사용자 폴더 (관리자 권한 불필요)
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'MyPos',
    deleteAppDataOnUninstall: false, // 재설치 시 IndexedDB / cookie 유지 (매장 멤버십)
  },

  // electron-builder 가 main.js 위치 찾는 데 사용.
  // package.json 의 "main" 도 같은 값이어야 함.
};
