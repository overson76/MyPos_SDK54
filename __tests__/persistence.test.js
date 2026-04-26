// AsyncStorage 는 jest-expo preset 의 기본 mock 이 동작.
// 직접 mock 을 다시 깔아 동작을 명시적으로 통제한다.
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  return {
    __store: store,
    getItem: jest.fn((k) => Promise.resolve(store.has(k) ? store.get(k) : null)),
    setItem: jest.fn((k, v) => {
      store.set(k, v);
      return Promise.resolve();
    }),
    removeItem: jest.fn((k) => {
      store.delete(k);
      return Promise.resolve();
    }),
    multiGet: jest.fn((keys) =>
      Promise.resolve(keys.map((k) => [k, store.has(k) ? store.get(k) : null]))
    ),
  };
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadJSON,
  loadMany,
  saveJSON,
  removeKey,
  makeDebouncedSaver,
} from '../utils/persistence';

beforeEach(() => {
  AsyncStorage.__store.clear();
  jest.clearAllMocks();
});

describe('saveJSON / loadJSON', () => {
  test('저장 후 로드 라운드트립', async () => {
    await saveJSON('foo', { a: 1, b: [2, 3] });
    expect(await loadJSON('foo')).toEqual({ a: 1, b: [2, 3] });
  });

  test('미저장 키는 fallback 반환', async () => {
    expect(await loadJSON('missing', 'default')).toBe('default');
    expect(await loadJSON('missing')).toBeNull();
  });

  test('파싱 실패시 fallback (절대 throw 안함)', async () => {
    AsyncStorage.__store.set('mypos:v1:bad', '{not-json');
    expect(await loadJSON('bad', { ok: true })).toEqual({ ok: true });
  });

  test('키 prefix 가 mypos:v1: 로 적용됨', async () => {
    await saveJSON('hello', 1);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('mypos:v1:hello', '1');
  });
});

describe('loadMany', () => {
  test('여러 키를 한 번에 로드', async () => {
    await saveJSON('a', 1);
    await saveJSON('b', { x: 2 });
    const out = await loadMany(['a', 'b', 'c']);
    expect(out).toEqual({ a: 1, b: { x: 2 }, c: null });
  });
});

describe('removeKey', () => {
  test('지운 후 로드시 null', async () => {
    await saveJSON('temp', 1);
    await removeKey('temp');
    expect(await loadJSON('temp')).toBeNull();
  });
});

describe('makeDebouncedSaver', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('연속 호출시 마지막 값만 저장', async () => {
    const save = makeDebouncedSaver(100);
    save('k', 1);
    save('k', 2);
    save('k', 3);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    jest.advanceTimersByTime(100);
    // pending promise 해소 — flush
    await Promise.resolve();
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('mypos:v1:k', '3');
  });

  test('서로 다른 키는 독립 디바운스', async () => {
    const save = makeDebouncedSaver(100);
    save('a', 1);
    save('b', 2);
    jest.advanceTimersByTime(100);
    await Promise.resolve();
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(2);
  });
});
