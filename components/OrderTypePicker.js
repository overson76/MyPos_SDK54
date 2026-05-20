// 주문 종류 선택 모달 — PENDING + cart > 0 + "주문" 누름 시 띄움.
// 사장님이 배달/포장/예약 셋 중 하나 선택 → 그 종류의 빈 슬롯 자동 배당 + PENDING 정보 transfer.
//
// 사장님 정책 (2026-05-21): 매장(regular) 테이블은 처음부터 사장님이 직접 선택하므로
// 이 모달에 포함 안 함. 전화 주문 3 종류 (배달/포장/예약) 만 빠르게 선택.
//
// iOS new architecture 의 <Modal> + 중첩 Pressable 호환 이슈 회피 — absolute 오버레이 (matching
// PaymentMethodPicker 패턴).

import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useResponsive } from '../utils/useResponsive';

// 옵션 정의 — type / 라벨 / 강조색 (tableTypeColors 와 일치).
const ORDER_TYPE_OPTIONS = [
  { type: 'delivery',    label: '🛵 배달', color: '#ef4444', hint: 'd1~d5 자동 배당' },
  { type: 'takeout',     label: '🛍 포장', color: '#a855f7', hint: 'p1~p2 자동 배당' },
  { type: 'reservation', label: '📅 예약', color: '#f59e0b', hint: 'y1~y2 자동 배당' },
];

export default function OrderTypePicker({ onSelect, onClose, total, callerLabel }) {
  const { scale } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);

  return (
    <View style={styles.overlay} pointerEvents="auto">
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title}>주문 종류 선택</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>

          {callerLabel ? (
            <Text style={styles.callerText} numberOfLines={1}>
              👤 {callerLabel}
            </Text>
          ) : null}
          {typeof total === 'number' && total > 0 ? (
            <Text style={styles.totalText}>합계 {total.toLocaleString('ko-KR')}원</Text>
          ) : null}

          <View style={styles.grid}>
            {ORDER_TYPE_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.type}
                style={[styles.typeBtn, { borderColor: opt.color }]}
                onPress={() => onSelect(opt.type)}
                activeOpacity={0.8}
              >
                <Text style={[styles.typeLabel, { color: opt.color }]}>{opt.label}</Text>
                <Text style={styles.typeHint}>{opt.hint}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.footerHint}>
            매장 테이블 주문은 이 모달 대신 테이블 탭에서 직접 선택하세요.
          </Text>
        </Pressable>
      </Pressable>
    </View>
  );
}

function makeStyles(scale = 1) {
  const fp = (n) => Math.round(n * scale);
  return StyleSheet.create({
    overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 200 },
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    card: {
      width: 420,
      backgroundColor: '#fff',
      borderRadius: 16,
      padding: 20,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    title: { fontSize: fp(17), fontWeight: '800', color: '#111827' },
    close: { fontSize: fp(20), color: '#6b7280', paddingHorizontal: 8 },
    callerText: {
      fontSize: fp(14),
      color: '#FF7A45',
      fontWeight: '700',
      marginBottom: 4,
    },
    totalText: {
      fontSize: fp(15),
      color: '#374151',
      fontWeight: '700',
      marginBottom: 12,
    },
    grid: {
      flexDirection: 'row',
      gap: 10,
      marginBottom: 12,
    },
    typeBtn: {
      flex: 1,
      borderWidth: 2,
      borderRadius: 12,
      paddingVertical: 22,
      alignItems: 'center',
      backgroundColor: '#fff',
    },
    typeLabel: { fontSize: fp(18), fontWeight: '800', marginBottom: 4 },
    typeHint: { fontSize: fp(11), color: '#9ca3af', fontWeight: '500' },
    footerHint: {
      fontSize: fp(11),
      color: '#9ca3af',
      textAlign: 'center',
      marginTop: 4,
    },
  });
}
