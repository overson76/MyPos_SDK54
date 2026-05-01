// 전화 착신 팝업 — 화면 상단에 표시.
// 발신번호 + 이전 주문 주소(있으면) 표시 → 탭하면 배달 주문 화면 열림.

import { useMemo } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useResponsive } from '../utils/useResponsive';

export default function IncomingCallBanner({ call, onOrderPress, onDismiss }) {
  const { scale } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);

  if (!call) return null;

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <View style={styles.banner}>
        <View style={styles.left}>
          <Text style={styles.icon}>📞</Text>
        </View>
        <View style={styles.center}>
          <Text style={styles.number}>{call.formattedNumber || call.phoneNumber}</Text>
          {call.alias ? (
            <Text style={styles.address} numberOfLines={1}>
              👤 {call.alias}
            </Text>
          ) : call.address ? (
            <Text style={styles.address} numberOfLines={1}>
              📍 {call.address}
            </Text>
          ) : (
            <Text style={styles.newCustomer}>새 손님</Text>
          )}
          {call.orderCount > 0 ? (
            <Text style={styles.count}>{call.orderCount}번째 주문</Text>
          ) : null}
        </View>
        <View style={styles.right}>
          {onOrderPress ? (
            <TouchableOpacity style={styles.orderBtn} onPress={onOrderPress}>
              <Text style={styles.orderBtnText}>주문받기</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.dismissBtn} onPress={onDismiss} hitSlop={8}>
            <Text style={styles.dismissText}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function makeStyles(scale = 1) {
  const fp = (n) => Math.round(n * scale);
  return StyleSheet.create({
    overlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 9999,
      alignItems: 'center',
      paddingTop: Platform.OS === 'ios' ? 50 : 8,
      paddingHorizontal: 12,
    },
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#1F2937',
      borderRadius: 14,
      paddingVertical: 12,
      paddingHorizontal: 14,
      gap: 10,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 10,
      minWidth: 300,
      maxWidth: 500,
    },
    left: { justifyContent: 'center' },
    icon: { fontSize: fp(24) },
    center: { flex: 1, gap: 2 },
    number: {
      fontSize: fp(17),
      fontWeight: '800',
      color: '#fff',
      letterSpacing: 0.5,
    },
    address: {
      fontSize: fp(13),
      color: '#FF7A45',
      fontWeight: '600',
    },
    newCustomer: {
      fontSize: fp(12),
      color: '#9CA3AF',
    },
    count: {
      fontSize: fp(11),
      color: '#6EE7B7',
    },
    right: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    orderBtn: {
      backgroundColor: '#FF7A45',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
    },
    orderBtnText: {
      color: '#fff',
      fontSize: fp(13),
      fontWeight: '800',
    },
    dismissBtn: {
      padding: 4,
    },
    dismissText: {
      color: '#6B7280',
      fontSize: fp(16),
      fontWeight: '700',
    },
  });
}
