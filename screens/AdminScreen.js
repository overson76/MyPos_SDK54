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
import AdminSettingsView from '../components/AdminSettingsView';
import PinManageModal, { PIN_LENGTH } from '../components/PinManageModal';
import {
  getSpeakAddress,
  getVolume,
  playSoundTest,
  setSpeakAddress,
  setVolume,
} from '../utils/notify';
import { loadJSON, saveJSON } from '../utils/persistence';
import { useLock } from '../utils/LockContext';
import { useStore } from '../utils/StoreContext';
import { leaveStore as leaveStoreOp } from '../utils/storeOps';
import { clearPin, setPin as savePin, verifyPin } from '../utils/pinLock';
import { reportError } from '../utils/sentry';
import { useResponsive } from '../utils/useResponsive';
import Constants from 'expo-constants';
import { BUILD_NUMBER } from '../utils/buildInfo';
import {
  isElectronUpdateAvailable,
  applyElectronUpdateNow,
  checkForElectronUpdate,
  getElectronUpdateStatus,
  subscribeElectronUpdate,
} from '../utils/electronUpdate';
import { checkForUpdates } from '../utils/otaUpdates';
import { hasRevenuePin } from '../utils/revenuePin';

// Electron(.exe) 환경에서 앱 종료 — 키오스크 모드에 X 버튼 없을 때 사용.
function isElectron() {
  return typeof window !== 'undefined' && !!window.mypos?.isElectron;
}
function quitElectron() {
  if (typeof window !== 'undefined' && typeof window.mypos?.quitApp === 'function') {
    window.mypos.quitApp();
  }
}

// 1.0.22: '설정' 탭 신설 — 자주 안 쓰는 설정성 옵션 모음
//   (배달 주소 자동 기억 / 주문지 출력 정책 / 앱 종료).
// 시스템 탭은 운영·진단 도구 (자동 업데이트, CID/KIS 진단, OTA, Sentry, 초기화) 만 남음.
const SECTIONS = [
  { key: 'menu', label: '메뉴 관리' },
  { key: 'revenue', label: '수익 현황' },
  { key: 'settings', label: '설정' },
  { key: 'system', label: '시스템' },
];

// 1.0.24: PinManageModal + PIN_LENGTH 는 components/PinManageModal.js 로 이동
// (AdminSettingsView 와 공유). 아래에서 import.

function SystemSettingsView() {
  const { scale } = useResponsive();
  const sysStyles = useMemo(() => makeSysStyles(scale), [scale]);
  const lock = useLock();
  const { storeInfo, isOwner } = useStore();
  const [speakAddr, setSpeakAddrState] = useState(() => getSpeakAddress());
  const [pinModal, setPinModal] = useState(null); // 'set' | 'change' | 'clear' | null

  // Electron(.exe) 자동 업데이트 — 매장 PC 카운터 환경. 일반 브라우저 / 폰 에서는 카드 안 보임.
  const updateSupported = isElectronUpdateAvailable();
  const [updateStatus, setUpdateStatus] = useState(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateApplying, setUpdateApplying] = useState(false);

  // OTA(폰 앱) 업데이트 상태 — 네이티브 환경에서만 표시.
  const [otaStatus, setOtaStatus] = useState(null); // null | 'checking' | 'downloading' | 'downloaded' | 'upToDate' | 'error'
  const [otaBusy, setOtaBusy] = useState(false);

  // CID 진단 — Electron(.exe) 환경에서만. SIP 가 어디서 막히는지 사장님이 화면으로 확인.
  const [cidDiag, setCidDiag] = useState(null); // null | { ... 진단 스냅샷 }
  const [cidBusy, setCidBusy] = useState(false);
  const handleCidDiagnose = async () => {
    if (cidBusy) return;
    setCidBusy(true);
    try {
      const r = await window?.mypos?.cidDiagnose?.();
      setCidDiag(r || { error: '진단 실패 — IPC 응답 없음' });
    } catch (e) {
      setCidDiag({ error: String(e?.message || e) });
    } finally {
      setCidBusy(false);
    }
  };

  const handleOtaCheck = async () => {
    if (otaBusy) return;
    setOtaBusy(true);
    setOtaStatus('checking');
    await checkForUpdates({ onStatus: setOtaStatus });
    setOtaBusy(false);
  };

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

  // 1.0.20: "지금 적용" — 다운로드된 새 버전을 즉시 적용. 사장님이 영업 종료 후 명시 클릭.
  // 영업 중 실수 클릭 방지로 confirm 다이얼로그 + destructive style.
  const handleApplyUpdate = async () => {
    if (updateApplying) return;
    const newVersion = updateStatus?.version || '새 버전';
    Alert.alert(
      '새 버전 적용',
      `지금 ${newVersion} 을(를) 적용할까요?\n\n` +
        `.exe 가 잠시 닫히고 새 버전이 자동으로 시작됩니다.\n` +
        `영업 중에는 권장하지 않습니다 — 잠시 결제 / 주문이 중단됩니다.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '지금 적용',
          style: 'destructive',
          onPress: async () => {
            setUpdateApplying(true);
            const r = await applyElectronUpdateNow();
            if (!r?.ok) {
              setUpdateApplying(false);
              Alert.alert(
                '적용 실패',
                r?.message || r?.error || r?.reason || '알 수 없는 오류'
              );
            }
            // ok=true 면 곧 .exe 가 종료되니 응답 처리 불필요.
          },
        },
      ]
    );
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

      {/* (1.0.24: PIN 잠금 / 자동 잠금 / 음성 안내 모두 관리자 → 설정 탭으로 이동) */}

      <View style={sysStyles.note}>
        <Text style={sysStyles.noteText}>
          • 메뉴 가격 / 이름 / 배달 주소 / 시간 등 입력값은 자동으로 길이·형식 검증됩니다.
        </Text>
      </View>

      {/* (1.0.22: 주문지 출력 정책은 관리자 → 설정 탭으로 이동) */}

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
                다운로드 완료 후 사장님이 직접 "🚀 지금 적용" 버튼을 누르면 .exe 가 닫히고
                새 버전이 자동 시작됩니다. (1.0.20+: 영업 안전 차원의 명시 적용 정책)
              </Text>
              {updateStatus?.kind === 'downloading' &&
              typeof updateStatus.percent === 'number' ? (
                <Text style={sysStyles.helper}>
                  진행률: {Math.round(updateStatus.percent)}%
                </Text>
              ) : null}
            </View>
            {updateStatus?.kind === 'downloaded' ? (
              <TouchableOpacity
                style={[
                  sysStyles.btnPrimary,
                  updateApplying && { opacity: 0.5 },
                ]}
                disabled={updateApplying}
                onPress={handleApplyUpdate}
              >
                <Text style={sysStyles.btnPrimaryText}>
                  {updateApplying ? '적용 중…' : '🚀 지금 적용'}
                </Text>
              </TouchableOpacity>
            ) : (
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
            )}
          </View>
        </>
      ) : null}

      {/* === CID 진단 — Electron(.exe) 환경에서만. SIP 5060 / REGISTER 결과 확인. === */}
      {isElectron() ? (
        <>
          <Text style={[sysStyles.sectionTitle, { marginTop: 20 }]}>📞 CID 진단 (PC 카운터)</Text>
          <View style={sysStyles.row}>
            <View style={sysStyles.rowText}>
              <Text style={sysStyles.label}>전화 자동 감지(SIP) 상태</Text>
              <Text style={sysStyles.helper}>
                매장 PC 의 SIP 리스너가 5060 을 잡았는지, REGISTER 가 가는지, 응답이 어떤지 확인합니다.{'\n'}
                {storeInfo?.storeId
                  ? `현재 매장 ID(끝 12자): ${String(storeInfo.storeId).slice(-12)}`
                  : '⚠ 매장 ID 가 비어있음 — start-cid 가 호출되지 않을 수 있습니다.'}
              </Text>
            </View>
            <TouchableOpacity
              style={[sysStyles.btnSecondary, cidBusy && { opacity: 0.5 }]}
              disabled={cidBusy}
              onPress={handleCidDiagnose}
            >
              <Text style={sysStyles.btnSecondaryText}>
                {cidBusy ? '진단 중…' : '🔍 진단'}
              </Text>
            </TouchableOpacity>
          </View>
          {cidDiag ? (
            <View style={sysStyles.diagBox}>
              <Text style={sysStyles.diagLine}>
                sip 패키지: {cidDiag.sipPackageLoaded ? '✅ 로드됨' : `❌ 로드 실패${cidDiag.sipPackageError ? ` (${cidDiag.sipPackageError})` : ''}`}
              </Text>
              <Text style={sysStyles.diagLine}>
                리스너 시작 호출: {cidDiag.listenerStartCalled ? `✅ ${cidDiag.listenerStartedAt || ''}` : '❌ 아직 호출 안 됨 (storeId 비어있거나 start-cid 누락)'}
              </Text>
              <Text style={sysStyles.diagLine}>
                running: {cidDiag.running ? '✅ true' : '❌ false'}
                {cidDiag.sipStartError ? `   ⚠ start 실패: ${cidDiag.sipStartError}` : ''}
              </Text>
              <Text style={sysStyles.diagLine}>
                UDP {cidDiag.portProbe?.port ?? '?'} 바인딩: {cidDiag.portProbe?.bound ? '✅ 잡혀있음 (SIP 가 잡고 있을 가능성)' : `❌ 비어있음${cidDiag.portProbe?.errorCode ? ` (${cidDiag.portProbe.errorCode})` : ''}`}
              </Text>
              <Text style={sysStyles.diagLine}>
                REGISTER 송신: {cidDiag.registerSentCount ?? 0} 회{cidDiag.registerLastAt ? ` · 마지막 ${cidDiag.registerLastAt}` : ''}
              </Text>
              <Text style={sysStyles.diagLine}>
                마지막 SIP 응답: {cidDiag.lastResponseStatus ?? '없음'}{cidDiag.lastResponseAt ? ` · ${cidDiag.lastResponseAt}` : ''}
              </Text>
              <Text style={sysStyles.diagLine}>
                마지막 INVITE: {cidDiag.lastInviteFrom ? `${cidDiag.lastInviteFrom} (${cidDiag.lastInviteAt})` : '없음'}
              </Text>
              {cidDiag.lastError ? (
                <Text style={[sysStyles.diagLine, { color: '#dc2626' }]}>
                  ⚠ 마지막 에러: {cidDiag.lastError}
                </Text>
              ) : null}
              {cidDiag.configSnapshot ? (
                <View style={{ marginTop: 6, borderTopWidth: 1, borderTopColor: '#374151', paddingTop: 6 }}>
                  <Text style={sysStyles.diagLine}>
                    설정: {cidDiag.configSnapshot.user}@{cidDiag.configSnapshot.domain}:{cidDiag.configSnapshot.port}
                  </Text>
                  <Text style={sysStyles.diagLine}>
                    host: {cidDiag.configSnapshot.host}{cidDiag.configSnapshot.envHostSet ? '' : ' (env 미설정 → default)'}
                  </Text>
                  <Text style={sysStyles.diagLine}>
                    user: {cidDiag.configSnapshot.envUserSet ? '✅ env' : '❌ default'} · pass: {cidDiag.configSnapshot.passSet ? `✅ ${cidDiag.configSnapshot.passLength}자` : '❌ 빈값'}{cidDiag.configSnapshot.envPassSet ? ' (env)' : ' (default)'}
                  </Text>
                  <Text style={sysStyles.diagLine}>
                    domain: {cidDiag.configSnapshot.envDomainSet ? '✅ env' : '❌ default → lgdacom.net'}
                  </Text>
                </View>
              ) : null}
              {cidDiag.error ? (
                <Text style={[sysStyles.diagLine, { color: '#dc2626' }]}>
                  IPC 오류: {cidDiag.error}
                </Text>
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}

      {/* (1.0.22: 앱 종료는 관리자 → 설정 탭으로 이동) */}

      {/* === 폰 앱 OTA 업데이트 — 네이티브 환경에서만 보임. === */}
      {Platform.OS !== 'web' ? (
        <>
          <Text style={[sysStyles.sectionTitle, { marginTop: 20 }]}>
            📱 앱 업데이트
          </Text>
          <View style={sysStyles.row}>
            <View style={sysStyles.rowText}>
              <Text style={sysStyles.label}>
                {otaStatus === 'checking' && '🔍 최신 버전 확인 중...'}
                {otaStatus === 'downloading' && '⬇️ 새 버전 다운로드 중...'}
                {otaStatus === 'downloaded' && '✅ 다운로드 완료'}
                {otaStatus === 'upToDate' && '✅ 최신 버전입니다'}
                {otaStatus === 'error' && '❌ 업데이트 확인 실패'}
                {!otaStatus && '업데이트 확인'}
              </Text>
              <Text style={sysStyles.helper}>
                {otaStatus === 'downloaded'
                  ? '앱을 완전히 종료 후 재시작하면 새 버전이 적용됩니다.'
                  : '새 버전이 있으면 백그라운드에서 다운로드합니다.\n앱 시작 시 자동 확인 — 버튼은 수동 확인용.'}
              </Text>
            </View>
            <TouchableOpacity
              style={[sysStyles.btnSecondary, otaBusy && { opacity: 0.5 }]}
              onPress={handleOtaCheck}
              disabled={otaBusy}
            >
              <Text style={sysStyles.btnSecondaryText}>
                {otaBusy ? '확인 중...' : '지금 확인'}
              </Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}

      {/* === PC 재연동 — 자진 탈퇴 + 캐시 초기화 + 새로고침.
            직원: 운영자 다시 승인 후 재입장.
            대표: 수익 PIN 있으면 재연동 가능 — 재접속 시 매장 코드 + PIN 으로 즉시 입장. === */}
      {Platform.OS === 'web' ? (
        <>
          <Text style={[sysStyles.sectionTitle, { marginTop: 20 }]}>PC 연동</Text>
          <View style={sysStyles.row}>
            <View style={sysStyles.rowText}>
              <Text style={sysStyles.label}>매장 재연동 (자진 탈퇴 → 재가입)</Text>
              <Text style={sysStyles.helper}>
                {isOwner
                  ? hasRevenuePin(storeInfo)
                    ? 'PC 를 초기화하고 매장 참여 화면으로 돌아갑니다.\n재접속 시 매장 코드 + 수익 PIN 으로 즉시 대표 입장.'
                    : '⚠ 대표는 수익 PIN 을 먼저 설정해야 재연동할 수 있습니다.\n(PIN 없으면 재접속 시 폰에서 승인이 필요합니다)'
                  : 'PC 화면이 폰과 데이터가 다를 때 사용. 본인 멤버 등록을 정리하고\n매장 참여 화면으로 돌아갑니다. 운영자가 다시 승인하면 정상 연결됩니다.'}
              </Text>
            </View>
            <TouchableOpacity
              style={[sysStyles.btnDanger, (isOwner && !hasRevenuePin(storeInfo)) && sysStyles.btnDisabled]}
              disabled={!!(isOwner && !hasRevenuePin(storeInfo))}
              onPress={async () => {
                if (isOwner && !hasRevenuePin(storeInfo)) {
                  window?.alert?.('수익 PIN 을 먼저 설정하세요.\n매장 관리 탭 → 수익 PIN 설정 후 다시 시도하세요.');
                  return;
                }
                const ownerMsg =
                  '대표 PC 연동을 해제합니다.\n\n' +
                  '· 로컬 데이터/캐시 모두 초기화\n' +
                  '· 재접속 시: 매장 코드 입력 → "대표로 가입" → 수익 PIN 입력\n\n' +
                  '계속하시겠습니까?';
                const staffMsg =
                  '본인을 매장에서 자진 탈퇴시킨 후 매장 참여 화면으로 돌아갑니다.\n\n' +
                  '· 운영자 승인 후 다시 연결\n' +
                  '· 로컬 데이터/캐시 모두 초기화\n\n' +
                  '계속하시겠습니까?';
                const ok = window?.confirm?.(isOwner ? ownerMsg : staffMsg);
                if (!ok) return;
                // 1) Firestore 에서 본인 멤버 문서 삭제 (자진 탈퇴)
                try {
                  if (storeInfo?.storeId) {
                    await leaveStoreOp({ storeId: storeInfo.storeId });
                  }
                } catch {}
                // 2) Electron 파일 캐시 삭제 — 재시작 시 storeId 복구 차단
                try {
                  if (typeof window !== 'undefined' && window.mypos?.clearMembership) {
                    await window.mypos.clearMembership();
                  }
                } catch {}
                // 3) Firebase 로그아웃 — IndexedDB 인증 상태 제거
                try {
                  const { getAuth, signOut } = await import('firebase/auth');
                  await signOut(getAuth());
                } catch {}
                // 4) IndexedDB 전체 삭제 — Firebase Firestore 캐시 포함
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
                // 5) 서비스워커 + 캐시 + 로컬스토리지 초기화 후 새로고침
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

      {/* === 폰 연동 복구 — iOS/Android 전용. 동기화 꼬였을 때 앱 캐시 초기화. === */}
      {Platform.OS !== 'web' ? (
        <>
          <Text style={[sysStyles.sectionTitle, { marginTop: 20 }]}>폰 연동 복구</Text>
          <View style={sysStyles.row}>
            <View style={sysStyles.rowText}>
              <Text style={sysStyles.label}>앱 데이터 초기화</Text>
              <Text style={sysStyles.helper}>
                폰이 매장과 동기화가 안 되거나 화면이 이상할 때.{'\n'}
                앱 캐시 전체를 초기화하고 재시작합니다.{'\n'}
                ⚠️ 재시작 후 매장 코드로 다시 참여 필요.
              </Text>
            </View>
            <TouchableOpacity
              style={sysStyles.btnDanger}
              onPress={async () => {
                try {
                  const AsyncStorage =
                    require('@react-native-async-storage/async-storage').default;
                  await AsyncStorage.clear();
                  const { reloadAsync } = require('expo-updates');
                  await reloadAsync();
                } catch (e) {
                  Alert.alert('오류', String(e?.message || e));
                }
              }}
            >
              <Text style={sysStyles.btnDangerText}>초기화</Text>
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

      {/* (1.0.24: PinManageModal 은 AdminSettingsView 로 이동) */}
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
        ) : section === 'settings' ? (
          <AdminSettingsView />
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
    diagBox: {
      marginTop: 8,
      padding: 12,
      backgroundColor: '#1F2937',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: '#374151',
    },
    diagLine: {
      fontSize: fp(11),
      color: '#E5E7EB',
      lineHeight: fp(18),
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
  });
}

// 1.0.24: makePinStyles 도 components/PinManageModal.js 로 이동.
