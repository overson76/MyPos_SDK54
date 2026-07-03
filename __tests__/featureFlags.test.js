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

  test('기본값 전부 ON (현 동작 유지)', () => {
    const all = getAllFeatureFlags();
    for (const f of FEATURE_FLAGS) {
      expect(all[f.key]).toBe(true);
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
      expect(f.default).toBe(true); // 전부 기본 ON
    }
  });
});
