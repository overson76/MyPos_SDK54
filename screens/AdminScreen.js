import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Slider from '@react-native-community/slider';
import SettingScreen from './SettingScreen';
import RevenueScreen from './RevenueScreen';
import LockGate from '../components/LockGate';
import RevenueLockGate from '../components/RevenueLockGate';
import StoreManagementSection from '../components/StoreManagementSection';
import PinEntry from '../components/PinEntry';
import {
  getSpeakAddress,
  getVolume,
  playSoundTest,
  setSpeakAddress,
  setVolume,
} from '../utils/notify';
import { loadJSON, saveJSON } from '../utils/persistence';
import { useLock } from '../utils/LockContext';
import { clearPin, setPin as savePin, verifyPin } from '../utils/pinLock';
import { reportError } from '../utils/sentry';
import { useResponsive } from '../utils/useResponsive';
import Constants from 'expo-constants';
import { BUILD_NUMBER } from '../utils/buildInfo';
import {
  isElectronUpdateAvailable,
  checkForElectronUpdate,
  getElectronUpdateStatus,
  subscribeElectronUpdate,
} from '../utils/electronUpdate';

// Electron(.exe) 환경에서 앱 종료 — 키오스크 모드에 X 버튼 없을 때 사용.
function isElectron() {
  return typeof window !== 'undefined' && !!window.mypos?.isElectron;
}
function quitElectron() {
  if (typeof window !== 'undefined' && typeof window.mypos?.quitApp === 'function') {
    window.mypos.quitApp();
  }
}

const SECTIONS = [
  { key: 'menu', label: '메뉴 관리' },
  { key: 'revenue', label: '수익 현황' },
  { key: 'system', label: '시스템' },
];

const PIN_LENGTH = 4;

// PIN 설정 / 변경 / 해제 모달.
// mode: 'set' (신규) | 'change' (변경 — old + new) | 'clear' (해제 — old 검증)
function PinManageModal({ mode, onClose, onDone }) {
  const { scale } = useResponsive();
  const pinStyles = useMemo(() => makePinStyles(scale), [scale]);
  const [step, setStep] = useState(mode === 'change' || mode === 'clear' ? 'old' : 'new');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [firstNew, setFirstNew] = useState(''); // 'new' 단계에서 처음 입력한 값

  const titleByStep =
    step === 'old'
      ? mode === 'change'
        ? '기존 PIN 입력'
        : 'PIN 잠금 해제 — 현재 PIN 입력'
      : step === 'new'
      ? '새 PIN 입력 (4자리)'
      : '새 PIN 한 번 더 입력';

  const subtitleByStep =
    step === 'old'
      ? '확인을 위해 기존 PIN 을 입력하세요'
      : step === 'new'
      ? '메뉴 가격 / 매출 보호용 PIN'
      : '확인을 위해 다시 입력하세요';

  const onSubmit = async (pin) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (step === 'old') {
        const ok = await verifyPin(pin);
        if (!ok) {
          setError('PIN 이 일치하지 않습니다.');
        } else if (mode === 'clear') {
          await clearPin();
          onDone?.('cleared');
        } else {
          // change → 새 PIN 입력 단계로
          setStep('new');
        }
      } else if (step === 'new') {
        setFirstNew(pin);
        setStep('confirm');
      } else {
        // confirm
        if (pin !== firstNew) {
          setError('두 번 입력한 PIN 이 다릅니다. 다시 시작하세요.');
          setFirstNew('');
          setStep('new');
        } else {
          await savePin(pin);
          onDone?.(mode === 'set' ? 'set' : 'changed');
        }
      }
    } catch (e) {
      setError(e?.message || 'PIN 처리 중 오류');
    } finally {
      setBusy(false);
    }
  };

  // RN <Modal> 대신 absolute 오버레이 — iOS new arch + nested Pressable 호환성 이슈 우회
  return (
    <View style={pinStyles.overlay} pointerEvents="auto">
      <Pressable style={pinStyles.backdrop} onPress={onClose}>
        <Pressable style={pinStyles.card} onPress={() => {}}>
          <View style={pinStyles.header}>
            <Text style={pinStyles.headerTitle}>{titleByStep}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Text style={pinStyles.close}>✕</Text>
            </TouchableOpacity>
          </View>
          <PinEntry
            title=""
            subtitle={subtitleByStep}
            errorMessage={error}
            length={PIN_LENGTH}
            onSubmit={onSubmit}
          />
        </Pressable>
      </Pressable>
    </View>
  );
}

function SystemSettingsView() {
  const { scale } = useResponsive();
  const sysStyles = useMemo(() => makeSysStyles(scale), [scale]);
  const lock = useLock();
  const [speakAddr, setSpeakAddrState] = useState(() => getSpeakAddress());
  const [pinModal, setPinModal] = useState(null); // 'set' | 'change' | 'clear' | null

  // Electron(.exe) 자동 업데이트 — 매장 PC 카운터 환경. 일반 브라우저 / 폰 에서는 카드 안 보임.
  const updateSupported = isElectronUpdateAvailable();
  const [updateStatus, setUpdateStatus] = useState(null);
  const [updateChecking, setUpdateChecking] = useState(false);

  useEffect(() => {
    if (!updateSupported) return;
    let cancelled = false;
    // 마운트 직후 마지막 알려진 상태 한 번 폴링
    getElectronUpdateStatus().then((s) => {
      if (!cancelled) setUpdateStatus(s);
    });
    // 이후 메인 프로세스의 broadcast 구독 — 새 상태 push 받음
    const unsub = subscribeElectronUpdate((s) => {
      if (!cancelled) setUpdateStatus(s);
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [updateSupported]);

  const handleCheckUpdate = async () => {
    if (updateChecking) return;
    setUpdateChecking(true);
    try {
      await checkForElectronUpdate();
    } finally {
      setUpdateChecking(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    loadJSON('speakAddress', false).then((v) => {
      if (cancelled) return;
      const flag = !!v;
      setSpeakAddrState(flag);
      setSpeakAddress(flag);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleSpeakAddr = (next) => {
    setSpeakAddrState(next);
    setSpeakAddress(next);
    saveJSON('speakAddress', next);
  };

  const onPinDone = async (action) => {
    setPinModal(null);
    await lock.refreshPinStatus();
    const msg =
      action === 'set'
        ? 'PIN 잠금이 설정됐습니다.'
        : action === 'changed'
        ? 'PIN 이 변경됐습니다.'
        : 'PIN 잠금이 해제됐습니다.';
    if (Platform.OS === 'web') {
      // 웹에선 가벼운 알림만
      // eslint-disable-next-line no-alert
      window?.alert?.(msg);
    } else {
      Alert.alert('완료', msg);
    }
  };

  return (
    <ScrollView
      style={sysStyles.container}
      contentContainerStyle={{ paddingBottom: 24 }}
      showsVerticalScrollIndicator
    >
      {/* === 매장 관리 (매장 정보 + 수익 PIN, 대표 전용 항목 포함) === */}
      <StoreManagementSection />

      {/* === 보안 / PIN 잠금 (기기 PIN — 자동 잠금) === */}
      <Text style={sysStyles.sectionTitle}>기기 잠금 / 자동 잠금</Text>
      <View style={sysStyles.row}>
        <View style={sysStyles.rowText}>
          <Text style={sysStyles.label}>
            PIN 잠금 {lock.pinSet ? '설정됨' : '미설정'}
            {lock.pinSet && (lock.isUnlocked ? ' · 🔓 해제' : ' · 🔒 잠김')}
          </Text>
          <Text style={sysStyles.helper}>
            수익 현황 등 민감한 영역을 4자리 PIN 으로 보호합니다.
            앱이 백그라운드로 가거나 일정 시간 미사용 시 자동 잠금.
          </Text>
        </View>
        {!lock.pinSet ? (
          <TouchableOpacity
            style={sysStyles.btnPrimary}
            onPress={() => setPinModal('set')}
          >
            <Text style={sysStyles.btnPrimaryText}>PIN 설정</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TouchableOpacity
              style={sysStyles.btnSecondary}
              onPress={() => setPinModal('change')}
            >
              <Text style={sysStyles.btnSecondaryText}>변경</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={sysStyles.btnSecondary}
              onPress={() => setPinModal('clear')}
            >
              <Text style={sysStyles.btnSecondaryText}>해제</Text>
            </TouchableOpacity>
            {lock.isUnlocked ? (
              <TouchableOpacity
                style={sysStyles.btnPrimary}
                onPress={() => lock.lock()}
              >
                <Text style={sysStyles.btnPrimaryText}>지금 잠그기</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      </View>

      {lock.pinSet ? (
        <View style={sysStyles.row}>
          <View style={sysStyles.rowText}>
            <Text style={sysStyles.label}>
              자동 잠금 — {lock.autoLockMin}분 비활성 후
            </Text>
            <Text style={sysStyles.helper}>
              마지막 활동 후 시간이 지나면 자동으로 다시 잠금. 백그라운드 진입 시는 즉시.
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <Slider
                style={{ flex: 1, height: 28 }}
                minimumValue={1}
                maximumValue={30}
                step={1}
                value={lock.autoLockMin}
                onSlidingComplete={(v) =>
                  lock.setAutoLockMin(Math.round(v))
                }
                minimumTrackTintColor="#2563eb"
                maximumTrackTintColor="#d1d5db"
                disabled={!lock.autoLockEnabled}
              />
              <Text style={sysStyles.sliderValue}>{lock.autoLockMin}분</Text>
            </View>
          </View>
          <Switch
            value={lock.autoLockEnabled}
            onValueChange={(v) => lock.setAutoLockEnabled(v)}
            accessibilityLabel="자동 잠금 사용"
          />
        </View>
      ) : null}

      {/* === 개인정보 (배달 주소 음성 안내) === */}
      <Text style={[sysStyles.sectionTitle, { marginTop: 20 }]}>
        개인정보
      </Text>
      <View style={sysStyles.row}>
        <View style={sysStyles.rowText}>
          <Text style={sysStyles.label}>배달 주소 음성 안내</Text>
          <Text style={sysStyles.helper}>
            끄면 매장 스피커에서 고객 주소를 읽지 않습니다 (화면에는 그대로 표시).
            매장 운영 환경에 다른 손님이 있다면 OFF 권장.
          </Text>
        </View>
        <Switch
          value={speakAddr}
          onValueChange={toggleSpeakAddr}
          accessibilityLabel="배달 주소 음성 안내"
        />
      </View>

      <View style={sysStyles.note}>
        <Text style={sysStyles.noteText}>
          • 메뉴 가격 / 이름 / 배달 주소 / 시간 등 입력값은 자동으로 길이·형식 검증됩니다.
        </Text>
      </View>

      {/* === Electron 자동 업데이트 — PC 카운터 .exe 환경에서만 보임. === */}
      {updateSupported ? (
        <>
          <Text style={[sysStyles.sectionTitle, { marginTop: 20 }]}>
            🔄 자동 업데이트 (PC 카운터)
          </Text>
          <View style={sysStyles.row}>
            <View style={sysStyles.rowText}>
              <Text style={sysStyles.label}>
                {updateStatus?.message || '아직 확인 안 됨'}
              </Text>
              <Text style={sysStyles.helper}>
                새 버전이 배포되면 백그라운드에서 다운로드합니다. 영업 중 강제 재시작 X —
                다음 앱 시작 시 자동 적용. 영업 종료 후 .exe 닫고 다시 열면 새 버전.
              </Text>
              {updateStatus?.kind === 'downloading' &&
              typeof updateStatus.percent === 'number' ? (
                <Text style={sysStyles.helper}>
                  진행률: {Math.round(updateStatus.percent)}%
                </Text>
              ) : null}
            </View>
            <TouchableOpacity
              style={[
                sysStyles.btnSecondary,
                updateChecking && { opacity: 0.5 },
              ]}
              disabled={updateChecking}
              onPress={handleCheckUpdate}
            >
              <Text style={sysStyles.btnSecondaryText}>
                {updateChecking ? '확인 중…' : '지금 확인'}
              </Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}

      {/* === 앱 종료 — Electron(.exe) 키오스크 환경에서만 보임. X 버튼 없을 때 사용. === */}
      {isElectron() ? (
        <>
          <Text style={[sysStyles.sectionTitle, { marginTop: 20 }]}>앱 종료</Text>
          <View style={sysStyles.row}>
            <View style={sysStyles.rowText}>
              <Text style={sysStyles.label}>PC 카운터 앱 종료</Text>
              <Text style={sysStyles.helper}>
                영업 종료 후 앱을 닫습니다. 다음 시작 시 자동 업데이트가 있으면 적용됩니다.{'\n'}
                단축키: Ctrl + Shift + Q (언제든 사용 가능)
              </Text>
            </View>
            <TouchableOpacity
              style={sysStyles.btnDanger}
              onPress={() => {
                if (Platform.OS === 'web') {
                  const ok = window?.confirm?.('앱을 종료하시겠습니까?');
                  if (ok) quitElectron();
                } else {
                  Alert.alert('앱 종료', '앱을 종료하시겠습니까?', [
                    { text: '취소', style: 'cancel' },
                    { text: '종료', style: 'destructive', onPress: quitElectron },
                  ]);
                }
              }}
            >
              <Text style={sysStyles.btnDangerText}>앱 종료</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}

      {/* === PC 재연동 — 웹(PC 카운터)에서 storeMembership=null 로 연동 끊겼을 때 복구 버튼 === */}
      {Platform.OS === 'web' ? (
        <>
          <Text style={[sysStyles.sectionTitle, { marginTop: 20 }]}>PC 연동</Text>
          <View style={sysStyles.row}>
            <View style={sysStyles.rowText}>
              <Text style={sysStyles.label}>매장 재연동</Text>
              <Text style={sysStyles.helper}>
                PC 화면이 폰과 주문 데이터가 다를 때 사용하세요.{'\n'}
                캐시·로컬 데이터를 초기화하고 매장에 다시 가입합니다.
              </Text>
            </View>
            <TouchableOpacity
              style={sysStyles.btnDanger}
              onPress={async () => {
                const ok = window?.confirm?.(
                  'PC를 매장에 다시 연동합니다.\n로컬 데이터가 초기화되고 페이지가 새로고침됩니다.\n계속하시겠습니까?'
                );
                if (!ok) return;
                // 1) Electron 파일 캐시 삭제 — 재시작 시 storeId 복구 차단
                try {
                  if (typeof window !== 'undefined' && window.mypos?.clearMembership) {
                    await window.mypos.clearMembership();
                  }
                } catch {}
                // 2) Firebase 로그아웃 — IndexedDB 인증 상태 제거
                try {
                  const { getAuth, signOut } = await import('firebase/auth');
                  await signOut(getAuth());
                } catch {}
                // 2) IndexedDB 전체 삭제 — Firebase Firestore 캐시 포함
                try {
                  if (window.indexedDB?.databases) {
                    const dbs = await window.indexedDB.databases();
                    await Promise.all(
                      dbs.map(
                        (db) =>
                          new Promise((res) => {
                            const r = window.indexedDB.deleteDatabase(db.name);
                            r.onsuccess = res;
                            r.onerror = res;
                          })
                      )
                    );
                  }
                } catch {}
                // 3) 서비스워커 + 캐시 + 로컬스토리지 초기화 후 새로고침
                try {
                  const regs = await navigator.serviceWorker?.getRegistrations() ?? [];
                  await Promise.all(regs.map((r) => r.unregister()));
                  const keys = await caches?.keys() ?? [];
                  await Promise.all(keys.map((k) => caches.delete(k)));
                } catch {}
                localStorage.clear();
                window.location.reload(true);
              }}
            >
              <Text style={sysStyles.btnDangerText}>🔄 재연동</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}

      {/* === 진단 — Sentry 연동 확인용. 개발 빌드(__DEV__)에서만 노출. 운영 빌드에서는 자동 숨김. === */}
      {__DEV__ ? (
        <>
          <Text style={[sysStyles.sectionTitle, { marginTop: 20 }]}>진단 (개발 빌드)</Text>
          <View style={sysStyles.row}>
            <View style={sysStyles.rowText}>
              <Text style={sysStyles.label}>Sentry 테스트 이벤트 전송</Text>
              <Text style={sysStyles.helper}>
                의도된 에러를 Sentry 로 전송합니다 (앱은 정상 동작).
                대시보드 Issues 탭에 30초~1분 안에 도착하면 연동 정상.
                네이티브 빌드에서만 실제 전송됩니다 (웹 미리보기는 no-op).
              </Text>
            </View>
            <TouchableOpacity
              style={sysStyles.btnSecondary}
              onPress={() => {
                reportError(new Error('테스트 — Sentry 연동 확인'), {
                  source: 'admin_diagnostics_button',
                  triggeredAt: new Date().toISOString(),
                });
                const msg = '테스트 이벤트를 전송했습니다. Sentry 대시보드를 확인하세요.';
                if (Platform.OS === 'web') window?.alert?.(msg);
                else Alert.alert('전송 완료', msg);
              }}
            >
              <Text style={sysStyles.btnSecondaryText}>🐞 테스트 전송</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}

      {/* === 버전 정보 — 모든 기기에서 동일 버전인지 한눈에 확인 === */}
      <View style={sysStyles.versionBox}>
        <Text style={sysStyles.versionText}>
          📱 MyPos v{Constants.expoConfig?.version || '1.0.0'}
          {' ('}
          {Constants.nativeBuildVersion || BUILD_NUMBER}
          {')  '}
          {Platform.OS === 'web'
            ? (isElectron() ? '🖥️ PC 카운터' : '🌐 웹')
            : Platform.OS === 'ios'
            ? '🍎 iPhone/iPad'
            : '🤖 Android'}
        </Text>
      </View>

      {pinModal ? (
        <PinManageModal
          mode={pinModal}
          onClose={() => setPinModal(null)}
          onDone={onPinDone}
        />
      ) : null}
    </ScrollView>
  );
}

export default function AdminScreen() {
  const { scale } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);
  const [section, setSection] = useState('menu');
  const [volume, setVolumeState] = useState(() => getVolume());

  useEffect(() => {
    let cancelled = false;
    loadJSON('volume', null).then((v) => {
      if (cancelled || typeof v !== 'number') return;
      setVolumeState(v);
      setVolume(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onVolumeChange = (v) => {
    setVolumeState(v);
    setVolume(v);
  };
  const onVolumeCommit = (v) => {
    saveJSON('volume', v);
  };

  return (
    <View style={styles.container}>
      <View style={styles.subTabBar}>
        {SECTIONS.map((s) => {
          const active = section === s.key;
          return (
            <TouchableOpacity
              key={s.key}
              style={[styles.subTabBtn, active && styles.subTabBtnActive]}
              onPress={() => setSection(s.key)}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.subTabText,
                  active && styles.subTabTextActive,
                ]}
              >
                {s.label}
              </Text>
            </TouchableOpacity>
          );
        })}
        <View style={{ flex: 1 }} />

        <View style={styles.volumeBox}>
          <Text style={styles.volumeIcon}>
            {volume === 0 ? '🔇' : volume < 0.4 ? '🔈' : volume < 0.75 ? '🔉' : '🔊'}
          </Text>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={1}
            step={0.05}
            value={volume}
            minimumTrackTintColor="#2563eb"
            maximumTrackTintColor="#d1d5db"
            thumbTintColor={Platform.OS === 'android' ? '#2563eb' : undefined}
            onValueChange={onVolumeChange}
            onSlidingComplete={onVolumeCommit}
            accessibilityLabel="알림 볼륨"
          />
          <Text style={styles.volumeText}>{Math.round(volume * 100)}%</Text>
        </View>

        <TouchableOpacity
          style={styles.testBtn}
          onPress={() => playSoundTest()}
          activeOpacity={0.7}
          accessibilityLabel="사운드 테스트"
          accessibilityHint="알림 톤과 음성이 정상 출력되는지 확인합니다"
        >
          <Text style={styles.testBtnText}>🔊 사운드 테스트</Text>
        </TouchableOpacity>
      </View>
      <View style={{ flex: 1 }}>
        {section === 'menu' ? (
          <SettingScreen />
        ) : section === 'revenue' ? (
          <RevenueLockGate length={PIN_LENGTH}>
            <RevenueScreen />
          </RevenueLockGate>
        ) : (
          <SystemSettingsView />
        )}
      </View>
    </View>
  );
}

// scale: useResponsive() 의 폰트 배율(lg=1.3, 그 외 1.0). 각 컴포넌트가 useMemo 로 호출.
function makeStyles(scale = 1) {
  const fp = (n) => Math.round(n * scale);
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff' },
    subTabBar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#f3f4f6',
      borderBottomWidth: 1,
      borderBottomColor: '#e5e7eb',
    },
    subTabBtn: {
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderBottomWidth: 3,
      borderBottomColor: 'transparent',
    },
    subTabBtnActive: { borderBottomColor: '#2563eb', backgroundColor: '#fff' },
    subTabText: { fontSize: fp(14), color: '#6b7280', fontWeight: '600' },
    subTabTextActive: { color: '#111827', fontWeight: '800' },
    volumeBox: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 8,
      paddingVertical: 4,
      marginRight: 8,
      backgroundColor: '#fff',
      borderWidth: 1,
      borderColor: '#d1d5db',
      borderRadius: 8,
    },
    volumeIcon: { fontSize: fp(16), marginRight: 4 },
    slider: { width: 120, height: 28 },
    volumeText: {
      fontSize: fp(12),
      color: '#374151',
      fontWeight: '600',
      minWidth: 36,
      textAlign: 'right',
    },
    testBtn: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginRight: 12,
      backgroundColor: '#fff',
      borderWidth: 1,
      borderColor: '#d1d5db',
      borderRadius: 8,
    },
    testBtnText: { fontSize: fp(13), color: '#374151', fontWeight: '600' },
  });
}

function makeSysStyles(scale = 1) {
  const fp = (n) => Math.round(n * scale);
  return StyleSheet.create({
    container: { flex: 1, padding: 20, backgroundColor: '#fff' },
    sectionTitle: {
      fontSize: fp(16),
      fontWeight: '800',
      color: '#111827',
      marginBottom: 12,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingVertical: 12,
      borderTopWidth: 1,
      borderTopColor: '#e5e7eb',
      borderBottomWidth: 1,
      borderBottomColor: '#e5e7eb',
    },
    rowText: { flex: 1, paddingRight: 16 },
    label: { fontSize: fp(14), fontWeight: '700', color: '#111827', marginBottom: 4 },
    helper: { fontSize: fp(12), color: '#6b7280', lineHeight: fp(18) },
    sliderValue: {
      minWidth: 36,
      fontSize: fp(12),
      fontWeight: '700',
      color: '#374151',
      textAlign: 'right',
    },
    btnPrimary: {
      backgroundColor: '#2563eb',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
    },
    btnPrimaryText: { color: '#fff', fontSize: fp(13), fontWeight: '700' },
    btnSecondary: {
      backgroundColor: '#fff',
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: '#d1d5db',
    },
    btnSecondaryText: { color: '#374151', fontSize: fp(13), fontWeight: '600' },
    note: {
      marginTop: 16,
      padding: 12,
      backgroundColor: '#f9fafb',
      borderRadius: 8,
    },
    noteText: { fontSize: fp(12), color: '#374151', lineHeight: fp(20) },
    versionBox: {
      alignItems: 'center',
      paddingVertical: 20,
      marginTop: 12,
    },
    versionText: {
      fontSize: fp(12),
      color: '#9CA3AF',
      fontWeight: '600',
    },
  });
}

function makePinStyles(scale = 1) {
  const fp = (n) => Math.round(n * scale);
  return StyleSheet.create({
    // <Modal> 대체용 풀스크린 absolute 오버레이
    overlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 9999,
      elevation: 9999,
    },
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 16,
    },
    card: {
      width: '100%',
      maxWidth: 380,
      backgroundColor: '#fff',
      borderRadius: 12,
      overflow: 'hidden',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: '#e5e7eb',
    },
    headerTitle: { fontSize: fp(14), fontWeight: '800', color: '#111827' },
    close: { fontSize: fp(18), color: '#6b7280', paddingHorizontal: 4 },
  });
}
