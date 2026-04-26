// AsyncStorage 기반 영속화 헬퍼.
// - 키 prefix 'mypos:v1:' 로 스키마 버전 포함 (향후 마이그레이션 대비)
// - JSON 직렬화. parse 실패시 fallback 반환 (앱 크래시 방지)
// - makeDebouncedSaver: 키별 디바운스로 디스크 쓰기 폭주 방지
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PREFIX = 'mypos:v1:';

export async function loadJSON(key, fallback = null) {
  try {
    const raw = await AsyncStorage.getItem(KEY_PREFIX + key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

export async function loadMany(keys) {
  // keys: ['orders', 'splits', ...] → { orders: parsed, ... }
  try {
    const prefixed = keys.map((k) => KEY_PREFIX + k);
    const pairs = await AsyncStorage.multiGet(prefixed);
    const out = {};
    pairs.forEach(([fullKey, raw], i) => {
      const k = keys[i];
      if (raw == null) {
        out[k] = null;
        return;
      }
      try {
        out[k] = JSON.parse(raw);
      } catch (e) {
        out[k] = null;
      }
    });
    return out;
  } catch (e) {
    const out = {};
    for (const k of keys) out[k] = null;
    return out;
  }
}

export async function saveJSON(key, value) {
  try {
    await AsyncStorage.setItem(KEY_PREFIX + key, JSON.stringify(value));
  } catch (e) {}
}

export async function removeKey(key) {
  try {
    await AsyncStorage.removeItem(KEY_PREFIX + key);
  } catch (e) {}
}

// 키별 디바운스. 같은 키에 대한 연속 호출은 마지막 값만 저장.
export function makeDebouncedSaver(delay = 300) {
  const timers = new Map();
  return function save(key, value) {
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      saveJSON(key, value);
      timers.delete(key);
    }, delay);
    timers.set(key, t);
  };
}
