// PIN 잠금 — 4자리 PIN 의 해시(SHA-256 + salt) 만 저장. 평문 PIN 은 디스크에 절대 안 남음.
// 네이티브: expo-secure-store (iOS Keychain / Android EncryptedSharedPreferences)
// 웹: localStorage 폴백 (디바이스 격리 가정 — 매장 단말 한정 사용)
import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const isWeb = Platform.OS === 'web';
const KEY_HASH = 'mypos_pin_hash_v1';
const KEY_SALT = 'mypos_pin_salt_v1';

// SecureStore 는 키 형식 제한 (영숫자/-/_ 만). 위 키 그대로 사용 가능.
async function storeGet(key) {
  if (isWeb) {
    try {
      return typeof localStorage !== 'undefined'
        ? localStorage.getItem(key)
        : null;
    } catch (e) {
      return null;
    }
  }
  try {
    return await SecureStore.getItemAsync(key);
  } catch (e) {
    return null;
  }
}

async function storeSet(key, value) {
  if (isWeb) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
    } catch (e) {}
    return;
  }
  try {
    await SecureStore.setItemAsync(key, value);
  } catch (e) {}
}

async function storeDelete(key) {
  if (isWeb) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
    } catch (e) {}
    return;
  }
  try {
    await SecureStore.deleteItemAsync(key);
  } catch (e) {}
}

function genSalt() {
  // 16바이트 랜덤 salt → 32-char hex
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hashPin(pin, salt) {
  // SHA-256(salt + pin) → hex 문자열
  const input = `${salt}:${pin}`;
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    input,
    { encoding: Crypto.CryptoEncoding.HEX }
  );
}

export function isValidPin(pin) {
  return typeof pin === 'string' && /^[0-9]{4,8}$/.test(pin);
}

export async function hasPin() {
  const h = await storeGet(KEY_HASH);
  return !!h;
}

// PIN 새로 설정. 기존 PIN 이 있으면 verifyPin 으로 검증한 뒤에만 호출.
export async function setPin(pin) {
  if (!isValidPin(pin)) throw new Error('PIN 은 4-8자리 숫자여야 합니다.');
  const salt = genSalt();
  const hash = await hashPin(pin, salt);
  await storeSet(KEY_SALT, salt);
  await storeSet(KEY_HASH, hash);
}

export async function verifyPin(pin) {
  if (!isValidPin(pin)) return false;
  const [storedHash, salt] = await Promise.all([
    storeGet(KEY_HASH),
    storeGet(KEY_SALT),
  ]);
  if (!storedHash || !salt) return false;
  const computed = await hashPin(pin, salt);
  // timing-safe 비교는 hex 문자열이라 큰 문제 아님 — 단순 비교.
  return computed === storedHash;
}

export async function clearPin() {
  await Promise.all([storeDelete(KEY_HASH), storeDelete(KEY_SALT)]);
}
