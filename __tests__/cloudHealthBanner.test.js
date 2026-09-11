// 렌더 인프라(react-test-renderer) 미설치 — import-only 스모크.
// jest-expo 가 컴포넌트를 import 하면 JSX 트랜스폼 + import 체인 + 모듈 평가까지
// 수행되므로, 문법 오류 / 잘못된 import 는 여기서 잡힌다. (실제 화면은 매장에서 검증)
//
// 2026-09-11: 배너가 읽기(리스너) 끊김도 표시하게 확장 — 배너가 의존하는 cloudHealth
// API 가 전부 존재하는지 못 박아 둔다. 배너는 장애 중에만 뜨는 화면이라, export 이름이
// 어긋나면 정작 장애가 났을 때 흰 화면이 된다 (안전장치가 사고 원인이 되는 최악).

import CloudHealthBanner from '../components/CloudHealthBanner';
import {
  describeCloudError,
  getCloudHealth,
  getListenerHealth,
  subscribeCloudHealth,
  subscribeListenerHealth,
} from '../utils/cloudHealth';

describe('CloudHealthBanner import 스모크', () => {
  test('컴포넌트 import OK (문법/import 체인 검증)', () => {
    expect(typeof CloudHealthBanner).toBe('function');
  });

  test('배너가 쓰는 cloudHealth API 가 전부 존재한다', () => {
    expect(typeof describeCloudError).toBe('function');
    expect(typeof getCloudHealth).toBe('function');
    expect(typeof getListenerHealth).toBe('function');
    expect(typeof subscribeCloudHealth).toBe('function');
    expect(typeof subscribeListenerHealth).toBe('function');
  });

  test('초기 상태는 두 배너 모두 숨김 + ctxs 는 항상 배열', () => {
    // 배너가 listeners.ctxs.length 를 바로 읽으므로 undefined 면 렌더 시 터진다.
    const w = getCloudHealth();
    const r = getListenerHealth();
    expect(w.failing).toBe(false);
    expect(r.failing).toBe(false);
    expect(Array.isArray(r.ctxs)).toBe(true);
  });
});
