import {
  FEATURE_FLAGS,
  getFeatureFlag,
  getAllFeatureFlags,
  setFeatureFlag,
  subscribeFeatureFlags,
  _resetFeatureFlagsForTest,
} from '../utils/featureFlags';

// saveJSON(AsyncStorage) 은 테스트 환경에서 no-op 로 — persistence 는 fallback 안전 설계.
jest.mock('../utils/persistence', () => ({
  loadJSON: jest.fn(async (_k, fb) => fb),
  saveJSON: jest.fn(),
}));

describe('featureFlags', () => {
  beforeEach(() => _resetFeatureFlagsForTest());

  // 2026-09-11 이전 계약은 "전부 기본 ON(현 동작 유지)" 이었다. 클라우드 한도
  // 소진 사고 후, 상시 트래픽을 만드는 선택 기능은 기본 OFF 로 바꾼다.
  // 부하 진단용 토글(무거운 계산)은 여전히 기본 ON — 끄는 건 사장님 판단.
  const DEFAULT_OFF = ['sharedAudioSync'];

  test('선언된 기본값 그대로 초기화된다', () => {
    const all = getAllFeatureFlags();
    for (const f of FEATURE_FLAGS) {
      expect(all[f.key]).toBe(f.default);
    }
  });

  test('상시 클라우드 트래픽을 만드는 기능은 기본 OFF', () => {
    for (const key of DEFAULT_OFF) {
      const f = FEATURE_FLAGS.find((x) => x.key === key);
      expect(f).toBeDefined();
      expect(f.default).toBe(false);
      expect(getFeatureFlag(key)).toBe(false);
    }
  });

  test('그 외 진단용 토글은 기본 ON 유지', () => {
    for (const f of FEATURE_FLAGS) {
      if (DEFAULT_OFF.includes(f.key)) continue;
      expect(f.default).toBe(true);
    }
  });

  test('미정의 키는 안전하게 true (비-React 경로 방어)', () => {
    expect(getFeatureFlag('존재하지않는키')).toBe(true);
  });

  test('setFeatureFlag 로 끄고 켜기', () => {
    setFeatureFlag('deliveryMap', false);
    expect(getFeatureFlag('deliveryMap')).toBe(false);
    setFeatureFlag('deliveryMap', true);
    expect(getFeatureFlag('deliveryMap')).toBe(true);
  });

  test('truthy/falsy 를 boolean 으로 정규화', () => {
    setFeatureFlag('aiRecommend', 0);
    expect(getFeatureFlag('aiRecommend')).toBe(false);
    setFeatureFlag('aiRecommend', 'yes');
    expect(getFeatureFlag('aiRecommend')).toBe(true);
  });

  test('구독자에게 변경 통지 + 해지', () => {
    const seen = [];
    const unsub = subscribeFeatureFlags((f) => seen.push(f.deliveryMap));
    setFeatureFlag('deliveryMap', false);
    setFeatureFlag('deliveryMap', true);
    unsub();
    setFeatureFlag('deliveryMap', false); // 해지 후 — 통지 안 됨
    expect(seen).toEqual([false, true]);
  });

  test('한 플래그 변경이 다른 플래그를 건드리지 않음', () => {
    setFeatureFlag('deliveryMap', false);
    expect(getFeatureFlag('aiRecommend')).toBe(true);
    expect(getFeatureFlag('deliveryDrivingDistance')).toBe(true);
  });

  test('FEATURE_FLAGS 항목은 key/label/help/default 를 모두 가짐', () => {
    for (const f of FEATURE_FLAGS) {
      expect(typeof f.key).toBe('string');
      expect(typeof f.label).toBe('string');
      expect(typeof f.help).toBe('string');
      expect(typeof f.default).toBe('boolean');
    }
  });
});
