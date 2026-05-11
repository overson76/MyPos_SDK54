// 1.0.37: 단체(group, 묶음) 테이블 결제 모달 — 합산 vs 테이블별 분리 선택.
// 분리 선택 시 손님별 PaymentMethodPicker 가 순차로 띄워짐.
//
// props:
//   open: boolean
//   members: string[] — 단체 멤버 tableId 목록
//   subtotalsBySource: { [sourceTableId]: total } — sourceTable 별 합계
//   onChooseCombined(): 합산 결제 진행 (기존 흐름)
//   onChooseSplit(): 분리 결제 시작 — onChooseSplit 호출 후 부모가 손님별
//     PaymentMethodPicker 를 순차로 띄움
//   onClose(): 취소
//
// iOS new architecture 호환 — absolute overlay 패턴.

import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { resolveAnyTable } from '../utils/tableData';
import { useResponsive } from '../utils/useResponsive';

export default function GroupPaymentSplitPicker({
  open,
  members,
  subtotalsBySource,
  onChooseCombined,
  onChooseSplit,
  onClose,
}) {
  const { scale } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);

  if (!open) return null;

  const tableLabel = (tid) => resolveAnyTable(tid)?.label || tid;
  const totalSum = (members || []).reduce(
    (s, tid) => s + (subtotalsBySource?.[tid] || 0),
    0
  );

  return (
    <View style={styles.backdrop} pointerEvents="auto">
      <Pressable style={styles.dim} onPress={onClose} />
      <View style={styles.panel}>
        <Text style={styles.title}>결제 방식 선택</Text>
        <Text style={styles.sub}>단체로 묶인 손님입니다. 어떻게 결제할까요?</Text>

        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
          {(members || []).map((tid) => {
            const sub = subtotalsBySource?.[tid] || 0;
            return (
              <View key={tid} style={styles.row}>
                <Text style={styles.rowLabel}>{tableLabel(tid)}</Text>
                <Text style={styles.rowAmount}>
                  {sub.toLocaleString()}원
                </Text>
              </View>
            );
          })}
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.rowLabelTotal}>합계</Text>
            <Text style={styles.rowAmountTotal}>
              {totalSum.toLocaleString()}원
            </Text>
          </View>
        </ScrollView>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionCombined]}
            onPress={onChooseCombined}
          >
            <Text style={styles.actionLabel}>전체 합산 결제</Text>
            <Text style={styles.actionSubLabel}>한 번에 한 결제수단으로</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionSplit]}
            onPress={onChooseSplit}
          >
            <Text style={styles.actionLabel}>테이블별 분리 결제</Text>
            <Text style={styles.actionSubLabel}>손님 한 명씩 차례로</Text>
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
      width: '92%',
      maxWidth: s(560),
      maxHeight: '90%',
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
      marginBottom: s(14),
    },
    list: {
      maxHeight: s(180),
      marginBottom: s(14),
    },
    listContent: {
      paddingHorizontal: s(4),
    },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: s(8),
    },
    rowLabel: {
      fontSize: s(16),
      color: '#374151',
    },
    rowAmount: {
      fontSize: s(16),
      color: '#111827',
      fontWeight: '600',
    },
    rowLabelTotal: {
      fontSize: s(17),
      color: '#111827',
      fontWeight: '700',
    },
    rowAmountTotal: {
      fontSize: s(17),
      color: '#111827',
      fontWeight: '700',
    },
    divider: {
      height: 1,
      backgroundColor: '#e5e7eb',
      marginVertical: s(4),
    },
    actions: {
      flexDirection: 'row',
      gap: s(10),
    },
    actionBtn: {
      flex: 1,
      paddingVertical: s(16),
      paddingHorizontal: s(12),
      borderRadius: s(10),
      alignItems: 'center',
      borderWidth: 2,
    },
    actionCombined: {
      backgroundColor: '#dbeafe',
      borderColor: '#3b82f6',
    },
    actionSplit: {
      backgroundColor: '#fef3c7',
      borderColor: '#f59e0b',
    },
    actionLabel: {
      fontSize: s(16),
      fontWeight: '700',
      color: '#111827',
    },
    actionSubLabel: {
      fontSize: s(12),
      color: '#6b7280',
      marginTop: s(4),
    },
    cancel: {
      marginTop: s(16),
      paddingVertical: s(10),
      alignItems: 'center',
    },
    cancelLabel: {
      fontSize: s(14),
      color: '#9ca3af',
    },
  });
}
