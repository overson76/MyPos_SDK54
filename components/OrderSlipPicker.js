// 주문지 출력 옵션 피커 — KitchenScreen 의 각 주문 카드에서 호출.
// 체크박스: 배달(배달 주소 포함) / 추가(새 항목만) / 변경(변경 항목만) / 모두(전체)
// 추가·변경 체크 시 "모두" 해제, "모두" 체크 시 추가·변경 해제 (상호 배타).
// 배달은 독립 — isDelivery=true 일 때만 노출.
//
// Props:
//   visible: boolean
//   onClose: () => void
//   onPrint: (kinds: string[]) => void
//   isDelivery: boolean
//   isFresh: boolean  — 신규 주문이면 "모두" 기본 선택, 아니면 "추가+변경" 기본 선택

import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useResponsive } from '../utils/useResponsive';

const CHECK_OPTIONS = [
  { key: 'all',      label: '모두',   desc: '전체 항목 출력' },
  { key: 'added',    label: '추가',   desc: '새로 추가된 항목만' },
  { key: 'changed',  label: '변경',   desc: '수량·옵션 변경 항목 + 취소' },
  { key: 'delivery', label: '배달',   desc: '배달 주소 섹션 포함' },
];

export default function OrderSlipPicker({ visible, onClose, onPrint, isDelivery = false, isFresh = false }) {
  const { scale } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);

  const makeDefault = () => {
    const s = new Set(isFresh ? ['all'] : ['added', 'changed']);
    if (isDelivery) s.add('delivery');
    return s;
  };

  const [kinds, setKinds] = useState(makeDefault);

  // visible 열릴 때마다 기본값 초기화
  useEffect(() => {
    if (visible) setKinds(makeDefault());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const toggle = (key) => {
    setKinds((prev) => {
      const next = new Set(prev);
      if (key === 'delivery') {
        if (next.has('delivery')) next.delete('delivery');
        else next.add('delivery');
        return next;
      }
      if (key === 'all') {
        if (next.has('all')) {
          next.delete('all');
        } else {
          next.add('all');
          next.delete('added');
          next.delete('changed');
        }
      } else {
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
          next.delete('all');
        }
      }
      return next;
    });
  };

  const canPrint = kinds.has('all') || kinds.has('added') || kinds.has('changed');

  if (!visible) return null;

  return (
    <View style={styles.overlay} pointerEvents="auto">
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title}>주문지 출력</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.checkList}>
            {CHECK_OPTIONS.map(({ key, label, desc }) => {
              const isChecked = kinds.has(key);
              const isDeliveryKey = key === 'delivery';
              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.checkRow, isDeliveryKey && styles.checkRowDelivery]}
                  onPress={() => toggle(key)}
                  activeOpacity={0.7}
                >
                  <View style={[
                    styles.checkbox,
                    isChecked && (isDeliveryKey ? styles.checkboxDelivery : styles.checkboxChecked),
                  ]}>
                    {isChecked && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                  <View style={styles.checkTextWrap}>
                    <Text style={styles.checkLabel}>{label}</Text>
                    <Text style={styles.checkDesc}>{desc}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.7}>
              <Text style={styles.cancelText}>취소</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.printBtn, !canPrint && styles.printBtnDisabled]}
              disabled={!canPrint}
              onPress={() => onPrint([...kinds])}
              activeOpacity={0.8}
            >
              <Text style={styles.printText}>🖨️ 출력</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </View>
  );
}

function makeStyles(scale) {
  const fp = (n) => Math.round(n * scale);
  return StyleSheet.create({
    overlay: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 9000,
      justifyContent: 'center', alignItems: 'center',
    },
    backdrop: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'center', alignItems: 'center',
    },
    card: {
      backgroundColor: '#1f2937',
      borderRadius: 14,
      padding: 20,
      width: 300,
      shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 10,
      elevation: 10,
    },
    header: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      marginBottom: 16,
    },
    title: { fontSize: fp(15), fontWeight: '700', color: '#f9fafb' },
    close: { fontSize: fp(16), color: '#9ca3af', fontWeight: '700' },

    checkList: { gap: 8, marginBottom: 20 },
    checkRow: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: '#374151', borderRadius: 10,
      paddingVertical: 10, paddingHorizontal: 14, gap: 12,
    },
    checkRowDelivery: { borderWidth: 1, borderColor: '#3b82f6' },
    checkbox: {
      width: 24, height: 24, borderRadius: 6,
      borderWidth: 2, borderColor: '#6b7280',
      justifyContent: 'center', alignItems: 'center',
    },
    checkboxChecked: { backgroundColor: '#10b981', borderColor: '#10b981' },
    checkboxDelivery: { backgroundColor: '#3b82f6', borderColor: '#3b82f6' },
    checkmark: { fontSize: fp(12), color: '#fff', fontWeight: '800' },
    checkTextWrap: { flex: 1 },
    checkLabel: { fontSize: fp(13), fontWeight: '700', color: '#f3f4f6' },
    checkDesc: { fontSize: fp(10), color: '#9ca3af', marginTop: 1 },

    footer: { flexDirection: 'row', gap: 10 },
    cancelBtn: {
      flex: 1, paddingVertical: 12, borderRadius: 10,
      backgroundColor: '#374151', alignItems: 'center',
    },
    cancelText: { fontSize: fp(13), color: '#9ca3af', fontWeight: '600' },
    printBtn: {
      flex: 2, paddingVertical: 12, borderRadius: 10,
      backgroundColor: '#2563eb', alignItems: 'center',
    },
    printBtnDisabled: { backgroundColor: '#374151' },
    printText: { fontSize: fp(13), color: '#fff', fontWeight: '700' },
  });
}
