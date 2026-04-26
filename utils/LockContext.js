// 관리자 모드 잠금 상태 관리.
// - PIN 미설정: 항상 unlocked (잠금 기능 비활성)
// - PIN 설정됨: 기본 locked. unlock(pin) 검증 성공 시에만 unlocked.
// - 자동 잠금: 마지막 활동 후 N분 경과 시 lock (기본 5분, 토글 가능)
// - 앱이 background 전환되면 즉시 lock
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { hasPin, verifyPin } from './pinLock';
import { loadJSON, saveJSON } from './persistence';
import { addBreadcrumb } from './sentry';

const LockContext = createContext(null);

const DEFAULT_AUTO_LOCK_MIN = 5;

export function LockProvider({ children }) {
  // pinSet === null: 부팅중 미확인. true/false: 결정됨.
  const [pinSet, setPinSet] = useState(null);
  const [unlocked, setUnlocked] = useState(false);
  const [autoLockMin, setAutoLockMin] = useState(DEFAULT_AUTO_LOCK_MIN);
  const [autoLockEnabled, setAutoLockEnabled] = useState(true);
  const lastActivityRef = useRef(Date.now());

  // 부팅 시: PIN 설정 여부 확인 + 자동잠금 설정 hydrate
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [exists, savedMin, savedEnabled] = await Promise.all([
        hasPin(),
        loadJSON('autoLockMin', DEFAULT_AUTO_LOCK_MIN),
        loadJSON('autoLockEnabled', true),
      ]);
      if (cancelled) return;
      setPinSet(!!exists);
      // PIN 미설정이면 unlocked 시작, 설정됨이면 locked 시작
      setUnlocked(!exists);
      if (typeof savedMin === 'number' && savedMin > 0) {
        setAutoLockMin(savedMin);
      }
      setAutoLockEnabled(savedEnabled !== false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // background 전환 시 즉시 lock
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        if (pinSet) setUnlocked(false);
      }
    });
    return () => sub.remove();
  }, [pinSet]);

  // 자동잠금 timer — 1분마다 체크, 마지막 활동 후 N분 경과시 lock
  useEffect(() => {
    if (!pinSet || !autoLockEnabled || !unlocked) return;
    const id = setInterval(() => {
      const idleMs = Date.now() - lastActivityRef.current;
      if (idleMs >= autoLockMin * 60 * 1000) {
        setUnlocked(false);
      }
    }, 60 * 1000);
    return () => clearInterval(id);
  }, [pinSet, autoLockEnabled, unlocked, autoLockMin]);

  const reportActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  const unlock = useCallback(async (pin) => {
    const ok = await verifyPin(pin);
    addBreadcrumb('admin.unlockAttempt', { ok });
    if (ok) {
      setUnlocked(true);
      lastActivityRef.current = Date.now();
    }
    return ok;
  }, []);

  const lock = useCallback(() => {
    addBreadcrumb('admin.lock', {});
    setUnlocked(false);
  }, []);

  // PIN 설정/변경/해제 후 컨텍스트 상태 갱신용
  const refreshPinStatus = useCallback(async () => {
    const exists = await hasPin();
    setPinSet(!!exists);
    if (!exists) setUnlocked(true);
  }, []);

  const setAutoLockMinPersisted = useCallback((minutes) => {
    const n = Math.max(1, Math.min(60, parseInt(minutes, 10) || 5));
    setAutoLockMin(n);
    saveJSON('autoLockMin', n);
  }, []);

  const setAutoLockEnabledPersisted = useCallback((enabled) => {
    setAutoLockEnabled(!!enabled);
    saveJSON('autoLockEnabled', !!enabled);
  }, []);

  const value = useMemo(
    () => ({
      // pinSet === null 이면 부팅중
      ready: pinSet !== null,
      pinSet: !!pinSet,
      // 잠긴 영역 접근 가능 여부 (PIN 미설정이면 항상 true)
      isUnlocked: !pinSet || unlocked,
      autoLockMin,
      autoLockEnabled,
      unlock,
      lock,
      refreshPinStatus,
      reportActivity,
      setAutoLockMin: setAutoLockMinPersisted,
      setAutoLockEnabled: setAutoLockEnabledPersisted,
    }),
    [
      pinSet,
      unlocked,
      autoLockMin,
      autoLockEnabled,
      unlock,
      lock,
      refreshPinStatus,
      reportActivity,
      setAutoLockMinPersisted,
      setAutoLockEnabledPersisted,
    ]
  );

  return <LockContext.Provider value={value}>{children}</LockContext.Provider>;
}

export function useLock() {
  const ctx = useContext(LockContext);
  if (!ctx) throw new Error('useLock must be used within LockProvider');
  return ctx;
}
