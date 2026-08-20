// 버전 단일화 가드.
//
// 왜 어긋나면 위험한가:
//   1) app.json 의 runtimeVersion 정책이 "appVersion" — 폰 OTA 는 *같은 version 끼리만*
//      호환된다. 이 값이 실제 릴리스 흐름(package.json) 과 따로 놀면 어떤 빌드가 어떤
//      업데이트를 받는지 아무도 추적 못 한다.
//   2) package.json 의 version 은 electron-builder 가 .exe 버전 + 자동 업데이트
//      (latest.yml) 판정에 그대로 쓴다.
//
// 2026-08-20: 실제로 app.json 1.0.2 vs package.json 1.0.55 로 53 단계 벌어져 있었다.
// 숫자 하나짜리 테스트가 그 재발을 막는다.

const pkg = require('../package.json');
const appJson = require('../app.json');

describe('버전 동기화', () => {
  test('app.json 의 expo.version 과 package.json 의 version 이 같다', () => {
    expect(appJson.expo.version).toBe(pkg.version);
  });

  test('semver 형식 (EAS / electron-builder 둘 다 요구)', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('iOS buildNumber 는 정수 문자열 — TestFlight 업로드마다 증가해야 함', () => {
    expect(appJson.expo.ios.buildNumber).toMatch(/^\d+$/);
  });
});
