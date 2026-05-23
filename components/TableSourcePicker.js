// 단체(group) 묶음 후 메뉴 추가 시 — 어느 손님 테이블 메뉴인지 선택받는 모달.
// 1.0.36: 단체 묶기 후에도 1인/테이블별 결제 분리 가능하게 sourceTableId 추적.
// 2026-05-21: "🔗 통합" 옵션 추가 (사장님 룰: 5 [통합] 6 형식, 통합은 메뉴/금액 분리 X).
//   통합 선택 → sourceTableId = leaderId 로 박힘 → leader 슬롯에 표시, 결제 시 묶임.
//
// props:
//   open: boolean — 표시 여부
//   members: string[] — 단체 멤버 tableId 목록 (groups 의 memberIds)
//   leaderId: string — 그룹 대표 tableId — "통합" 선택 시 박힐 sourceTableId
//   lastSourceId: string|null — 이 group 의 마지막 선택 (★ 강조 + 자동 적용 옵션)
//   onSelect(sourceTableId): 선택 콜백
//   onClose(): 취소 (메뉴 추가 자체 취소)
//
// iOS new architecture 의 <Modal> 호환 회피 — absolute 오버레이 패턴.

import { Fragment, useMemo } from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { resolveAnyTable } from '../utils/tableData';
import { useResponsive } from '../utils/useResponsive';

export default function TableSourcePicker({
  open,
  members,
  leaderId,
  lastSourceId,
  onSelect,
  onClose,
}) {
  const { scale } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);

  if (!open) return null;
  if (!members || members.length === 0) return null;

  const tableLabel = (tid) => {
    const t = resolveAnyTable(tid);
    return t?.label || tid;
  };

  // "통합" 버튼은 첫 멤버 다음에 끼움 — 사장님 의도 "5 [통합] 6" 형식.
  // leaderId 가 없으면 통합 옵션 표시 안 함 (legacy 호출 안전).
  const sharedSourceId = leaderId || members[0];
  const isSharedSelected = lastSourceId === sharedSourceId;

  return (
    <View style={styles.backdrop} pointerEvents="auto">
      <Pressable style={styles.dim} onPress={onClose} />
      <View style={styles.panel}>
        <Text style={styles.title}>어느 손님 메뉴인가요?</Text>
        <Text style={styles.sub}>
          단체로 묶은 테이블입니다. "🔗 통합" 선택 시 메뉴/결제 분리 없이 한 묶음.
        </Text>
        <View style={styles.btnRow}>
          {members.map((tid, idx) => {
            const isLast = tid === lastSourceId && tid !== sharedSourceId;
            return (
              <Fragment key={tid}>
                <TouchableOpacity
                  style={[styles.btn, isLast && styles.btnLast]}
                  onPress={() => onSelect(tid)}
                >
                  <Text style={[styles.btnLabel, isLast && styles.btnLabelLast]}>
                    {isLast ? '★ ' : ''}
                    {tableLabel(tid)}
                  </Text>
                </TouchableOpacity>
                {idx === 0 && leaderId && (
                  <TouchableOpacity
                    key="__shared__"
                    style={[styles.btn, styles.btnShared, isSharedSelected && styles.btnLast]}
                    onPress={() => onSelect(sharedSourceId)}
                  >
                    <Text
                      style={[
                        styles.btnLabel,
                        styles.btnLabelShared,
                        isSharedSelected && styles.btnLabelLast,
                      ]}
                    >
                      {isSharedSelected ? '★ ' : ''}🔗 통합
                    </Text>
                  </TouchableOpacity>
                )}
              </Fragment>
            );
          })}
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
      maxWidth: s(560),
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
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: s(10),
    },
    btn: {
      minWidth: s(120),
      paddingVertical: s(16),
      paddingHorizontal: s(20),
      borderRadius: s(10),
      backgroundColor: '#f3f4f6',
      borderWidth: 2,
      borderColor: '#e5e7eb',
      alignItems: 'center',
    },
    btnLast: {
      backgroundColor: '#dbeafe',
      borderColor: '#3b82f6',
    },
    // 통합 옵션 — 보라/녹색 계열로 멤버 버튼과 구분
    btnShared: {
      backgroundColor: '#f0fdf4',
      borderColor: '#10b981',
    },
    btnLabel: {
      fontSize: s(18),
      fontWeight: '700',
      color: '#111827',
    },
    btnLabelLast: {
      color: '#1d4ed8',
    },
    btnLabelShared: {
      color: '#047857',
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
