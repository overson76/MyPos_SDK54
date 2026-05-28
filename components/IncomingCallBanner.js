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

// 2026-05-28: 사장님 호소 "분명히 저장된 번호인데 새 전화로 인식 — 엉망".
// CID 매칭 X (isNewNumber=true) 일 때 알림에 "👤 통합" 버튼 추가 — 사장님이
// 즉시 별칭 입력 → 비슷한 별칭/주소 entry 자동 추천 → 클릭 한 번에 phone 통합.
// 사장님이 매장에서 휴대폰/대표번호 여러 번호 같은 손님 통합하는 흐름.
export default function IncomingCallBanner({ call, onOrderPress, onMergePress, onDismiss }) {
  const { scale } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);

  if (!call) return null;

  // 매칭 안 된 신규 번호일 때만 "통합" 버튼 보여줌 — 매칭된 단골은 이미 식별됨.
  const showMergeBtn = !!onMergePress && !call.alias && !call.address;

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
          {showMergeBtn ? (
            <TouchableOpacity style={styles.mergeBtn} onPress={onMergePress}>
              <Text style={styles.mergeBtnText}>👤 통합</Text>
            </TouchableOpacity>
          ) : null}
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
    // 1.0.47 — 카드 한 단계 크게. 매장 PC 멀리서도 잘 보이게.
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#1F2937',
      borderRadius: 16,
      paddingVertical: 16,
      paddingHorizontal: 20,
      gap: 14,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.4,
      shadowRadius: 12,
      elevation: 14,
      minWidth: 380,
      maxWidth: 640,
    },
    left: { justifyContent: 'center' },
    icon: { fontSize: fp(32) },
    center: { flex: 1, gap: 4 },
    number: {
      fontSize: fp(22),
      fontWeight: '800',
      color: '#fff',
      letterSpacing: 0.5,
    },
    address: {
      fontSize: fp(17),
      color: '#FF7A45',
      fontWeight: '700',
    },
    newCustomer: {
      fontSize: fp(15),
      color: '#9CA3AF',
      fontWeight: '600',
    },
    count: {
      fontSize: fp(14),
      color: '#6EE7B7',
      fontWeight: '600',
    },
    right: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    orderBtn: {
      backgroundColor: '#FF7A45',
      paddingHorizontal: 18,
      paddingVertical: 12,
      borderRadius: 10,
    },
    orderBtnText: {
      color: '#fff',
      fontSize: fp(16),
      fontWeight: '800',
    },
    mergeBtn: {
      backgroundColor: '#2563eb',
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 10,
    },
    mergeBtnText: {
      color: '#fff',
      fontSize: fp(14),
      fontWeight: '800',
    },
    dismissBtn: {
      padding: 6,
    },
    dismissText: {
      color: '#9CA3AF',
      fontSize: fp(20),
      fontWeight: '700',
    },
  });
}
