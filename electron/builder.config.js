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
  // 기본 artifactName 은 NSIS installer 에 적용. portable 은 별도 (아래 portable.artifactName).
  // 두 타겟이 같은 이름으로 publish 되면 GitHub 에서 덮어쓰면서 latest.yml 의 sha512 와
  // 실제 파일 해시가 어긋남 → 매장 PC 가 "sha512 checksum mismatch" 거부 → 자동 업데이트 실패.
  // 매장 운영 사고 직전 케이스라 반드시 분리.
  artifactName: '${productName}-Setup-${version}-${arch}.${ext}',
  copyright: 'Copyright © 2026 cadpia',

  // 빌드된 .exe 의 package.json 의 main 만 override.
  // 루트 package.json 의 main: "index.js" 는 Expo 진입점으로 그대로 둠 — 빌드 시 충돌 회피.
  extraMetadata: {
    main: 'electron/main.js',
  },

  // 빌드 산출물에 포함할 파일들.
  // Phase 4: dist/ 를 번들 포함 — 라이브 URL 실패 시 로컬 폴백용.
  // dist/ 가 없으면 offline.js 의 mountLocalServer 가 조용히 skip, 라이브 URL 만 사용.
  // Phase 5(KIS): C# 브릿지 소스는 빌드 산출물 제외 (extraResources 로 .exe 만 포함).
  // CID(SIP): node_modules/sip 를 명시적으로 포함 — production dependency 자동 포함을
  // electron-builder 가 처리하지만, asar 빌드에서 누락된 사례 추적 중이라 안전 보장.
  files: [
    'electron/**/*',
    'dist/**/*',
    'utils/escposBuilder.js',   // electron/printer/print.js 가 require 함
    'utils/lguApi.js',          // 1.0.44: electron/main.js, electron/cidServer.js 가 require
    'utils/ipWatcher.js',       // 1.0.44: electron/main.js 가 require (LG U+ Webhook 흐름)
    'package.json',
    'node_modules/sip/**/*',    // CID SIP 리스너 — 명시 포함 (1.0.9 진단)
    '!electron/payment/bridge/**',  // 소스/.csproj/bin/obj 제외 — extraResources 로 .exe 만 별도 포함
    '!**/node_modules/*/{CHANGELOG.md,README.md,README,readme.md,readme}',
    '!**/node_modules/*/{test,__tests__,tests,powered-test,example,examples}',
    '!**/{.DS_Store,.git,.gitignore,.npmrc,.eslintrc.json}',
  ],

  // Phase 5: KIS 결제 브릿지 .exe 를 process.resourcesPath/bridge 에 복사.
  // electron/payment/kis.js 의 resolveBridgePath 가 이 위치를 1순위로 찾음.
  // 브릿지가 빌드 안 됐으면 (KisPaymentBridge.exe 없음) electron-builder 가 from 미존재로 조용히 skip.
  // 매장이 KIS 가맹 후 dotnet build 한 결과를 .exe 안에 동봉.
  extraResources: [
    {
      from: 'electron/payment/bridge/bin/x86/Release/net48',
      to: 'bridge',
      filter: ['KisPaymentBridge.exe', '*.dll', '*.config'],
    },
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
  // 1.0.47 변경: oneClick true → false. 1.0.11~1.0.46 의 silent install 이 1.0.45 락 들고
  // 있는 상태에서 customInit 의 2초 종료 시간 부족 → 인스톨러 silent fail. 사장님이 매번
  // 수동 삭제 + 재설치 패턴을 강요당함. UI 표시 + Sleep 5000 으로 덮어쓰기 설치 정상화.
  nsis: {
    oneClick: false,                              // UI 표시 — silent fail 차단
    allowElevation: true,                         // 권한 자동 승격
    allowToChangeInstallationDirectory: false,    // 경로 변경 X (단순화)
    runAfterFinish: true,                         // 설치 끝나면 자동 실행
    perMachine: false,                            // 사용자 폴더 (관리자 권한 불필요)
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'MyPos',
    deleteAppDataOnUninstall: false,              // 재설치 시 IndexedDB / cookie 유지 (매장 멤버십)
    // 1.0.11: NSIS uninstall 단계 hang 영구 차단 — 사전 hook 으로 mypos*.exe 강제 종료.
    // 1.0.47: Sleep 2000 → 5000 (Service Worker 정리 시간 보장).
    // include 경로는 buildResources(=electron/build) 기준 상대경로.
    include: 'installer.nsh',
  },

  // portable 산출물 — auto-update 와 무관, USB 옮기기용.
  // NSIS installer (auto-update 대상) 와 파일명이 같으면 GitHub publish 시 덮어쓰면서
  // latest.yml 의 sha512 와 실제 .exe 해시가 어긋남 → 매장 PC 자동 업데이트 거부.
  // -portable 접미사로 두 산출물 이름 분리.
  portable: {
    artifactName: '${productName}-${version}-${arch}-portable.${ext}',
  },

  // 자동 업데이트 — GitHub Releases 를 update server 로 사용.
  //
  // 빌드 시 publish:
  //   GH_TOKEN=<personal access token> npm run electron:build -- --publish always
  //   → 빌드 후 자동으로 GitHub Releases 에 .exe / latest.yml 업로드.
  //
  // 매장 PC (.exe 설치된 사용자) 자동 업데이트:
  //   - 부팅 시 electron-updater 가 GitHub API 로 최신 release 확인
  //   - 새 버전 있으면 백그라운드 다운로드
  //   - 사장님이 자연스럽게 .exe 닫을 때 (영업 종료) 다음 시작 시 새 버전 적용
  //   - 영업 중 강제 reload X — 매장 운영 안전 우선
  //
  // 주의: repo private 이면 매장 PC 도 GH_TOKEN 필요 → 별도 update 서버 (Cloudflare R2 등)
  // 고려. 현재는 public repo 전제.
  publish: {
    provider: 'github',
    owner: 'overson76',
    repo: 'MyPos_SDK54',
    releaseType: 'release',
  },

  // electron-builder 가 main.js 위치 찾는 데 사용.
  // package.json 의 "main" 도 같은 값이어야 함.
};
