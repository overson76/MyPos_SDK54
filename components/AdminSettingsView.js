// 관리자 → 설정 탭의 본문.
//
// 1.0.22: 자주 안 쓰는 설정성 옵션 모음 (배달 주소 자동 기억 / 주문지 출력 정책 / 앱 종료).
// 1.0.24: 핀잠금 / 자동 잠금 / 배달 음성 안내 추가 이동 (시스템 탭에서).
//
// 시스템 탭에는 운영·진단 도구 (자동 업데이트, CID 진단, KIS 진단, OTA, 앱 데이터 초기화,
// Sentry 테스트 등) 만 남음.

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { useResponsive } from '../utils/useResponsive';
import { useOrders } from '../utils/OrderContext';
import { useLock } from '../utils/LockContext';
import {
  getSpeakAddress,
  setSpeakAddress,
} from '../utils/notify';
import { loadJSON, saveJSON } from '../utils/persistence';
import PrintPolicySection from './PrintPolicySection';
import PinManageModal from './PinManageModal';

function isElectron() {
  return typeof window !== 'undefined' && !!window.mypos?.isElectron;
}

function quitElectron() {
  if (typeof window !== 'undefined' && typeof window.mypos?.quitApp === 'function') {
    window.mypos.quitApp();
  }
}

export default function AdminSettingsView() {
  const { scale } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);
  const { addressBook, setAutoRemember } = useOrders();
  const lock = useLock();
  const addressCount = Object.keys(addressBook?.entries || {}).length;
  const electron = isElectron();

  const [speakAddr, setSpeakAddrState] = useState(() => getSpeakAddress());
  const [pinModal, setPinModal] = useState(null); // 'set' | 'change' | 'clear' | null

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
    if (typeof window !== 'undefined') {
      const msg =
        action === 'set'
          ? 'PIN 잠금이 설정됐습니다.'
          : action === 'changed'
          ? 'PIN 이 변경됐습니다.'
          : 'PIN 잠금이 해제됐습니다.';
      window?.alert?.(msg);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* === 기기 잠금 / 자동 잠금 === */}
      <Text style={styles.sectionTitle}>🔒 기기 잠금 / 자동 잠금</Text>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.label}>
            PIN 잠금 {lock.pinSet ? '설정됨' : '미설정'}
            {lock.pinSet && (lock.isUnlocked ? ' · 🔓 해제' : ' · 🔒 잠김')}
          </Text>
          <Text style={styles.helper}>
            수익 현황 등 민감한 영역을 4자리 PIN 으로 보호합니다.
            앱이 백그라운드로 가거나 일정 시간 미사용 시 자동 잠금.
          </Text>
        </View>
        {!lock.pinSet ? (
          <TouchableOpacity
            style={styles.btnPrimary}
            onPress={() => setPinModal('set')}
          >
            <Text style={styles.btnPrimaryText}>PIN 설정</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <TouchableOpacity
              style={styles.btnSecondary}
              onPress={() => setPinModal('change')}
            >
              <Text style={styles.btnSecondaryText}>변경</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.btnSecondary}
              onPress={() => setPinModal('clear')}
            >
              <Text style={styles.btnSecondaryText}>해제</Text>
            </TouchableOpacity>
            {lock.isUnlocked ? (
              <TouchableOpacity
                style={styles.btnPrimary}
                onPress={() => lock.lock()}
              >
                <Text style={styles.btnPrimaryText}>지금 잠그기</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      </View>

      {lock.pinSet ? (
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.label}>
              자동 잠금 — {lock.autoLockMin}분 비활성 후
            </Text>
            <Text style={styles.helper}>
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
              <Text style={styles.sliderValue}>{lock.autoLockMin}분</Text>
            </View>
          </View>
          <Switch
            value={lock.autoLockEnabled}
            onValueChange={(v) => lock.setAutoLockEnabled(v)}
            accessibilityLabel="자동 잠금 사용"
          />
        </View>
      ) : null}

      {/* === 개인정보 — 배달 주소 음성 안내 === */}
      <Text style={[styles.sectionTitle, { marginTop: 24 }]}>🔊 개인정보</Text>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.label}>배달 주소 음성 안내</Text>
          <Text style={styles.helper}>
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

      {/* === 배달 주소 자동 기억 === */}
      <Text style={[styles.sectionTitle, { marginTop: 24 }]}>📍 배달 주소</Text>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.label}>배달 주소 자동 기억</Text>
          <Text style={styles.helper}>
            배달이 완료되면 주소를 주소록에 자동 저장합니다 · 현재 {addressCount}개
          </Text>
        </View>
        <TouchableOpacity
          style={[
            styles.toggleTrack,
            addressBook?.autoRemember && styles.toggleTrackOn,
          ]}
          onPress={() => setAutoRemember(!addressBook?.autoRemember)}
          activeOpacity={0.7}
          accessibilityLabel="배달 주소 자동 기억"
        >
          <View
            style={[
              styles.toggleKnob,
              addressBook?.autoRemember && styles.toggleKnobOn,
            ]}
          />
        </TouchableOpacity>
      </View>

      {/* === 주문지 출력 정책 === */}
      <PrintPolicySection />

      {/* === PC 카운터 앱 종료 (Electron 환경에서만) === */}
      {electron ? (
        <>
          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>🛑 앱 종료</Text>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.label}>PC 카운터 앱 종료</Text>
              <Text style={styles.helper}>
                영업 종료 후 앱을 닫습니다. 다음 시작 시 자동 업데이트가 있으면 적용됩니다.{'\n'}
                단축키: Ctrl + Shift + Q (언제든 사용 가능)
              </Text>
            </View>
            <TouchableOpacity
              style={styles.btnDanger}
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
              <Text style={styles.btnDangerText}>앱 종료</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}

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

function makeStyles(scale = 1) {
  const fp = (n) => Math.round(n * scale);
  return StyleSheet.create({
    container: { padding: 16, paddingBottom: 60 },
    sectionTitle: {
      fontSize: fp(15),
      fontWeight: '800',
      color: '#374151',
      marginTop: 12,
      marginBottom: 8,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: 4,
      gap: 12,
      borderBottomWidth: 1,
      borderBottomColor: '#f3f4f6',
    },
    rowText: { flex: 1 },
    label: { fontSize: fp(14), fontWeight: '700', color: '#111827' },
    helper: {
      fontSize: fp(11),
      color: '#6b7280',
      marginTop: 2,
      lineHeight: fp(15),
    },
    sliderValue: {
      fontSize: fp(11),
      color: '#374151',
      fontWeight: '600',
      minWidth: 36,
      textAlign: 'right',
    },
    toggleTrack: {
      width: 48,
      height: 28,
      borderRadius: 14,
      backgroundColor: '#e5e7eb',
      padding: 2,
      justifyContent: 'center',
    },
    toggleTrackOn: { backgroundColor: '#10b981' },
    toggleKnob: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: '#fff',
      shadowColor: '#000',
      shadowOpacity: 0.15,
      shadowRadius: 2,
      elevation: 1,
    },
    toggleKnobOn: { transform: [{ translateX: 20 }] },
    btnPrimary: {
      backgroundColor: '#2563eb',
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 8,
    },
    btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: fp(13) },
    btnSecondary: {
      backgroundColor: '#f3f4f6',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: '#d1d5db',
    },
    btnSecondaryText: { color: '#374151', fontWeight: '700', fontSize: fp(12) },
    btnDanger: {
      backgroundColor: '#dc2626',
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 8,
    },
    btnDangerText: { color: '#fff', fontWeight: '700', fontSize: fp(13) },
  });
}
