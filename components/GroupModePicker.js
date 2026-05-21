// 단체 묶기 직후 — 결제/메뉴 모드 선택 모달.
// 사장님 룰 2026-05-21: [통합] = 같이 메뉴/결제 / [분리] = 각자 메뉴/결제.
//
// iOS new architecture 의 <Modal> 호환 회피 — absolute 오버레이 패턴 (PaymentMethodPicker /
// TableSourcePicker / OrderTypePicker 와 동일).

import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useResponsive } from '../utils/useResponsive';

export default function GroupModePicker({ open, memberLabels, onSelect, onClose }) {
  const { scale } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);

  if (!open) return null;

  return (
    <View style={styles.backdrop} pointerEvents="auto">
      <Pressable style={styles.dim} onPress={onClose} />
      <View style={styles.panel}>
        <Text style={styles.title}>단체 결제 방식</Text>
        <Text style={styles.sub}>
          {memberLabels && memberLabels.length > 0
            ? `${memberLabels.join(' + ')} — 결제/메뉴를 어떻게 처리할까요?`
            : '결제/메뉴를 어떻게 처리할까요?'}
        </Text>
        <View style={styles.btnRow}>
          <TouchableOpacity
            style={[styles.btn, styles.btnShared]}
            onPress={() => onSelect('shared')}
            activeOpacity={0.8}
          >
            <Text style={[styles.btnLabel, styles.btnLabelShared]}>🔗 통합</Text>
            <Text style={styles.btnHint}>같이 메뉴 · 같이 결제</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnSplit]}
            onPress={() => onSelect('split')}
            activeOpacity={0.8}
          >
            <Text style={[styles.btnLabel, styles.btnLabelSplit]}>✂️ 분리</Text>
            <Text style={styles.btnHint}>각자 메뉴 · 각자 결제</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.cancel} onPress={onClose}>
          <Text style={styles.cancelLabel}>취소</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function makeStyles(scale = 1) {
  const s = (n) => n * scale;
  return StyleSheet.create({
    backdrop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 1000,
      justifyContent: 'center',
      alignItems: 'center',
    },
    dim: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
    },
    panel: {
      backgroundColor: '#ffffff',
      borderRadius: s(14),
      paddingHorizontal: s(22),
      paddingVertical: s(20),
      width: '90%',
      maxWidth: s(520),
    },
    title: {
      fontSize: s(20),
      fontWeight: '700',
      color: '#111827',
      textAlign: 'center',
      marginBottom: s(6),
    },
    sub: {
      fontSize: s(13),
      color: '#6b7280',
      textAlign: 'center',
      marginBottom: s(16),
    },
    btnRow: {
      flexDirection: 'row',
      gap: s(10),
      justifyContent: 'center',
    },
    btn: {
      flex: 1,
      paddingVertical: s(22),
      paddingHorizontal: s(16),
      borderRadius: s(12),
      borderWidth: 2,
      alignItems: 'center',
      gap: s(6),
    },
    btnShared: {
      backgroundColor: '#f0fdf4',
      borderColor: '#10b981',
    },
    btnSplit: {
      backgroundColor: '#fef3c7',
      borderColor: '#f59e0b',
    },
    btnLabel: {
      fontSize: s(20),
      fontWeight: '800',
    },
    btnLabelShared: { color: '#047857' },
    btnLabelSplit: { color: '#b45309' },
    btnHint: {
      fontSize: s(12),
      color: '#6b7280',
      fontWeight: '500',
    },
    cancel: {
      marginTop: s(18),
      paddingVertical: s(12),
      alignItems: 'center',
    },
    cancelLabel: {
      fontSize: s(14),
      color: '#9ca3af',
    },
  });
}
