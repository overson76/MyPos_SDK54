// 예약 빠른 등록 모달 — 메뉴 없이 인원 + 시간만으로 예약 슬롯을 잡는다.
// 2026-06-04 사장님 요청: "예약은 메뉴를 정하지 않고 시간·인원만 정하는 경우가 많다.
//   예약 표에서 메뉴를 담지 않아도 예약1번부터 채울 수 있게."
//
// 빈 예약 슬롯(예약1 등)을 탭하면 이 모달이 뜬다.
//   - 인원: − / + 버튼 (텍스트 입력 X → PC 타이핑/키보드 가림 사고와 무관)
//   - 시간: TimeWheelPicker 중첩 (기존 예약 시간 입력 재사용)
//   - [예약 등록]  : 메뉴 없이 슬롯 점유 → 슬롯이 "예약됨" 으로 보임
//   - [메뉴 담기]  : 예약 정보 저장 후 주문 화면으로 (손님이 와서 주문할 때)
//
// 모달 패턴: <Modal> 안 씀. absolute overlay (project_modal_native_crash 메모리 처방).

import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useResponsive } from '../utils/useResponsive';
import { parseDeliveryTime, formatShort12h } from '../utils/timeUtil';
import TimeWheelPicker from './TimeWheelPicker';

export default function ReservationQuickModal({
  visible,
  tableLabel = '',
  initialPartySize = 0,
  initialTime = '',
  initialIsPM = true,
  hasMenu = false,
  onSubmit,
  onCancel,
}) {
  const { scale } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);

  const [party, setParty] = useState(initialPartySize || 0);
  const [time, setTime] = useState(initialTime || '');
  const [isPM, setIsPM] = useState(initialIsPM ?? true);
  const [wheelOpen, setWheelOpen] = useState(false);

  useEffect(() => {
    if (visible) {
      setParty(initialPartySize || 0);
      setTime(initialTime || '');
      setIsPM(initialIsPM ?? true);
      setWheelOpen(false);
    }
  }, [visible, initialPartySize, initialTime, initialIsPM]);

  if (!visible) return null;

  const dec = () => setParty((p) => Math.max(0, p - 1));
  const inc = () => setParty((p) => Math.min(99, p + 1));

  const timeLabel = (() => {
    if (!time) return '미정';
    const parsed = parseDeliveryTime(time, isPM);
    return parsed ? formatShort12h(parsed) : '미정';
  })();

  const submit = (alsoMenu) => {
    onSubmit?.({ partySize: party, time: time || null, isPM, alsoMenu });
  };

  return (
    <View style={styles.overlay} pointerEvents="auto">
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title}>
              📅 예약{tableLabel ? ` — ${tableLabel}` : ''}
            </Text>
            <TouchableOpacity onPress={onCancel} hitSlop={8}>
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.hint}>
            메뉴 없이 인원·시간만 먼저 잡아둘 수 있어요. 손님이 오면 이 자리에서
            메뉴를 담으세요.
          </Text>

          {/* 인원 — 큰 −/+ 버튼 (오타 없이 1명씩) */}
          <Text style={styles.label}>인원</Text>
          <View style={styles.partyRow}>
            <TouchableOpacity style={styles.stepBtn} onPress={dec} activeOpacity={0.7}>
              <Text style={styles.stepBtnText}>−</Text>
            </TouchableOpacity>
            <View style={styles.partyValueWrap}>
              <Text style={styles.partyValue}>
                {party > 0 ? `${party}명` : '미정'}
              </Text>
            </View>
            <TouchableOpacity style={styles.stepBtn} onPress={inc} activeOpacity={0.7}>
              <Text style={styles.stepBtnText}>＋</Text>
            </TouchableOpacity>
          </View>

          {/* 시간 — 탭하면 시간 휠 */}
          <Text style={styles.label}>시간</Text>
          <TouchableOpacity
            style={styles.timeBtn}
            onPress={() => setWheelOpen(true)}
            activeOpacity={0.8}
          >
            <Text style={styles.timeBtnText}>🕐 {timeLabel}</Text>
            <Text style={styles.timeBtnHint}>탭하여 선택</Text>
          </TouchableOpacity>

          {/* 액션 */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => submit(false)}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryText}>예약 등록</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => submit(true)}
              activeOpacity={0.85}
            >
              <Text style={styles.secondaryText}>
                {hasMenu ? '메뉴 보기' : '메뉴 담기'}
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>

      {/* 시간 휠 — 이 모달 위에 겹쳐 뜸 (zIndex 9999) */}
      <TimeWheelPicker
        visible={wheelOpen}
        initialText={time}
        initialIsPM={isPM}
        onConfirm={({ text, isPM: pm }) => {
          setTime(text);
          setIsPM(pm);
          setWheelOpen(false);
        }}
        onCancel={() => setWheelOpen(false)}
      />
    </View>
  );
}

function makeStyles(scale = 1) {
  const fp = (n) => Math.round(n * scale);
  const sp = (n) => Math.round(n * scale);
  return StyleSheet.create({
    overlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 300,
    },
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
    },
    card: {
      width: sp(400),
      maxWidth: '100%',
      backgroundColor: '#fff',
      borderRadius: 16,
      padding: sp(20),
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    title: { fontSize: fp(18), fontWeight: '800', color: '#b45309' },
    close: { fontSize: fp(20), color: '#6b7280', paddingHorizontal: 8 },
    hint: {
      fontSize: fp(13),
      color: '#6b7280',
      lineHeight: fp(19),
      marginBottom: 16,
    },
    label: {
      fontSize: fp(13),
      fontWeight: '700',
      color: '#374151',
      marginBottom: 8,
    },
    partyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: sp(12),
      marginBottom: 18,
    },
    stepBtn: {
      width: sp(64),
      height: sp(64),
      borderRadius: 12,
      borderWidth: 2,
      borderColor: '#f59e0b',
      backgroundColor: '#fffbeb',
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepBtnText: { fontSize: fp(30), fontWeight: '900', color: '#b45309' },
    partyValueWrap: {
      minWidth: sp(120),
      alignItems: 'center',
    },
    partyValue: { fontSize: fp(28), fontWeight: '900', color: '#111827' },
    timeBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderWidth: 2,
      borderColor: '#f59e0b',
      backgroundColor: '#fffbeb',
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: sp(16),
      marginBottom: 20,
    },
    timeBtnText: { fontSize: fp(20), fontWeight: '800', color: '#111827' },
    timeBtnHint: { fontSize: fp(12), color: '#9ca3af', fontWeight: '600' },
    actions: { flexDirection: 'row', gap: 10 },
    primaryBtn: {
      flex: 1.4,
      backgroundColor: '#f59e0b',
      paddingVertical: sp(15),
      borderRadius: 12,
      alignItems: 'center',
    },
    primaryText: { color: '#fff', fontSize: fp(16), fontWeight: '800' },
    secondaryBtn: {
      flex: 1,
      borderWidth: 1.5,
      borderColor: '#9ca3af',
      paddingVertical: sp(15),
      borderRadius: 12,
      alignItems: 'center',
    },
    secondaryText: { color: '#374151', fontSize: fp(15), fontWeight: '700' },
  });
}
