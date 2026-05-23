// iOS 알람 스타일 시간 휠 모달.
// AM/PM + 시(1-12) + 분(0-55, 5분 간격) 3개 휠. 위/아래로 쓸면 항목이 회전.
//
// 저장 형식은 기존 그대로: order.deliveryTime = "420"/"1220" + order.deliveryTimeIsPM = boolean.
// utils/timeUtil.js 의 parseDeliveryTime 이 호출부에서 그대로 동작.
//
// 모달 패턴: <Modal> 안 씀. absolute overlay (project_modal_native_crash 메모리 처방).

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';

const ITEM_HEIGHT = 40;
const VISIBLE_COUNT = 5;
const WHEEL_HEIGHT = ITEM_HEIGHT * VISIBLE_COUNT;
const CENTER_PADDING = (WHEEL_HEIGHT - ITEM_HEIGHT) / 2;

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const AMPMS = ['오전', '오후'];

function toParsed(text, isPM) {
  const fallback = { h: 12, m: 0, period: isPM ? 'PM' : 'AM' };
  if (text == null) return fallback;
  const digits = String(text).replace(/\D/g, '');
  if (digits.length < 3 || digits.length > 4) return fallback;
  let h, m;
  if (digits.length === 3) {
    h = parseInt(digits.slice(0, 1), 10);
    m = parseInt(digits.slice(1), 10);
  } else {
    h = parseInt(digits.slice(0, 2), 10);
    m = parseInt(digits.slice(2), 10);
  }
  if (isNaN(h) || h < 1 || h > 12) h = 12;
  if (isNaN(m) || m < 0 || m > 59) m = 0;
  // 5분 단위 스냅 — 휠이 5분 간격이므로 가장 가까운 값으로
  m = Math.round(m / 5) * 5;
  if (m >= 60) m = 55;
  return { h, m, period: isPM ? 'PM' : 'AM' };
}

function toTimeString(h, m) {
  return `${h}${String(m).padStart(2, '0')}`;
}

function WheelColumn({ data, value, onChange, formatter, width }) {
  const ref = useRef(null);
  const initialIndex = Math.max(0, data.indexOf(value));

  useEffect(() => {
    const idx = data.indexOf(value);
    if (idx < 0 || !ref.current) return;
    ref.current.scrollToOffset({ offset: idx * ITEM_HEIGHT, animated: false });
  }, [value, data]);

  const getItemLayout = (_, index) => ({
    length: ITEM_HEIGHT,
    offset: ITEM_HEIGHT * index,
    index,
  });

  const handleMomentumEnd = (e) => {
    const y = e.nativeEvent.contentOffset.y;
    const idx = Math.round(y / ITEM_HEIGHT);
    const clamped = Math.max(0, Math.min(data.length - 1, idx));
    if (data[clamped] !== value) onChange(data[clamped]);
  };

  return (
    <View style={[styles.wheelCol, { width }]}>
      <FlatList
        ref={ref}
        data={data}
        keyExtractor={(item) => String(item)}
        getItemLayout={getItemLayout}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        onMomentumScrollEnd={handleMomentumEnd}
        contentContainerStyle={{ paddingVertical: CENTER_PADDING }}
        initialScrollIndex={initialIndex}
        renderItem={({ item }) => {
          const active = item === value;
          return (
            <View style={styles.wheelItem}>
              <Text style={[styles.wheelText, active && styles.wheelTextActive]}>
                {formatter ? formatter(item) : String(item)}
              </Text>
            </View>
          );
        }}
      />
      <View pointerEvents="none" style={styles.wheelCenterMask} />
    </View>
  );
}

export default function TimeWheelPicker({
  visible,
  initialText,
  initialIsPM,
  onConfirm,
  onCancel,
}) {
  const seed = useMemo(
    () => toParsed(initialText, initialIsPM ?? true),
    // 매번 visible 변할 때 새로 계산
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible],
  );
  const [period, setPeriod] = useState(seed.period);
  const [hour, setHour] = useState(seed.h);
  const [minute, setMinute] = useState(seed.m);

  useEffect(() => {
    if (!visible) return;
    const p = toParsed(initialText, initialIsPM ?? true);
    setPeriod(p.period);
    setHour(p.h);
    setMinute(p.m);
  }, [visible, initialText, initialIsPM]);

  if (!visible) return null;

  const handleConfirm = () => {
    onConfirm?.({
      text: toTimeString(hour, minute),
      isPM: period === 'PM',
      h: hour,
      m: minute,
    });
  };

  return (
    <View style={styles.overlay} pointerEvents="auto">
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onCancel}
      />
      <View style={styles.modal}>
        <Text style={styles.title}>시간 선택</Text>
        <View style={styles.wheelRow}>
          <WheelColumn
            data={AMPMS}
            value={period === 'PM' ? '오후' : '오전'}
            onChange={(v) => setPeriod(v === '오후' ? 'PM' : 'AM')}
            width={80}
          />
          <WheelColumn
            data={HOURS}
            value={hour}
            onChange={setHour}
            width={64}
          />
          <Text style={styles.colon}>:</Text>
          <WheelColumn
            data={MINUTES}
            value={minute}
            onChange={setMinute}
            formatter={(m) => String(m).padStart(2, '0')}
            width={70}
          />
        </View>
        <View style={styles.btnRow}>
          <TouchableOpacity
            style={[styles.btn, styles.btnCancel]}
            onPress={onCancel}
            activeOpacity={0.85}
          >
            <Text style={styles.btnCancelText}>취소</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnConfirm]}
            onPress={handleConfirm}
            activeOpacity={0.85}
          >
            <Text style={styles.btnConfirmText}>확인</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
    elevation: 9999,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modal: {
    width: 360,
    maxWidth: '92%',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
  },
  wheelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: WHEEL_HEIGHT,
    marginBottom: 14,
  },
  wheelCol: {
    height: WHEEL_HEIGHT,
    position: 'relative',
  },
  wheelItem: {
    height: ITEM_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  wheelText: {
    fontSize: 18,
    color: '#9ca3af',
    fontWeight: '500',
  },
  wheelTextActive: {
    color: '#111827',
    fontSize: 22,
    fontWeight: '800',
  },
  wheelCenterMask: {
    position: 'absolute',
    top: CENTER_PADDING,
    height: ITEM_HEIGHT,
    left: 4,
    right: 4,
    backgroundColor: 'rgba(220, 38, 38, 0.08)',
    borderRadius: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(220, 38, 38, 0.35)',
  },
  colon: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111827',
    paddingHorizontal: 4,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
  },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnCancel: { backgroundColor: '#f3f4f6' },
  btnCancelText: { fontSize: 15, fontWeight: '700', color: '#374151' },
  btnConfirm: { backgroundColor: '#dc2626' },
  btnConfirmText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
