// AsyncStorage 기반 영속화 헬퍼.
// - 키 prefix 'mypos:v1:' 로 스키마 버전 포함 (향후 마이그레이션 대비)
// - JSON 직렬화. parse 실패시 fallback 반환 (앱 크래시 방지)
// - makeDebouncedSaver: 키별 디바운스로 디스크 쓰기 폭주 방지
import AsyncStorage from '@react-native-async-storage/async-storage';
import { measurePerf, notePerfInfo } from './perfDiag';

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
        const kb = Math.round((raw ? raw.length : 0) / 1024);
        if (kb >= 512) notePerfInfo(`⚠ ${k} 불러오기 크기 ${kb}KB`);
        out[k] = measurePerf(`불러오기:${k}`, () => JSON.parse(raw));
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
    // 2026-07-03: 43초 멈춤 진단 — 직렬화(동기 블로킹)를 이름표 계측으로 감싼다.
    //   데이터가 비정상적으로 커지면 여기가 범인. 크기도 기록해 어느 데이터가
    //   부풀었는지 함께 특정.
    const json = measurePerf(`저장:${key}`, () => JSON.stringify(value));
    const kb = Math.round((json ? json.length : 0) / 1024);
    if (kb >= 512) notePerfInfo(`⚠ ${key} 크기 ${kb}KB`); // 0.5MB 넘으면 이상 신호
    await AsyncStorage.setItem(KEY_PREFIX + key, json);
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
