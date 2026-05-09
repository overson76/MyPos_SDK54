// 관리자 → 설정 탭의 본문 — 1.0.22.
//
// 사장님이 "자주 안 쓰는 옵션들 한 곳에 모으기" 요청한 항목 묶음:
//   1. 배달 주소 자동 기억 토글 (메뉴 관리에서 이동)
//   2. 주문지 출력 정책 (PrintPolicySection — 시스템 탭에서 이동)
//   3. PC 카운터 앱 종료 (시스템 탭에서 이동)
//
// 시스템 탭에는 운영 / 진단 도구 (자동 업데이트, CID 진단, KIS 진단, OTA, 앱 데이터 초기화,
// Sentry 테스트 등 자주 들여다보는 항목) 만 남음.

import { useMemo } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useResponsive } from '../utils/useResponsive';
import { useOrders } from '../utils/OrderContext';
import PrintPolicySection from './PrintPolicySection';

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
  const addressCount = Object.keys(addressBook?.entries || {}).length;
  const electron = isElectron();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* === 배달 주소 자동 기억 === */}
      <Text style={styles.sectionTitle}>📍 배달 주소</Text>
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

      {/* === 주문지 출력 정책 (별도 컴포넌트) === */}
      <PrintPolicySection />

      {/* === PC 카운터 앱 종료 (Electron 환경에서만) === */}
      {electron ? (
        <>
          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>앱 종료</Text>
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
    btnDanger: {
      backgroundColor: '#dc2626',
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 8,
    },
    btnDangerText: { color: '#fff', fontWeight: '700', fontSize: fp(13) },
  });
}
