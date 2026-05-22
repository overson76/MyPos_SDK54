// 웹용 시간 선택 모달. RN Web 의 FlatList snapToInterval 은 모바일 브라우저 휠 느낌이 부자연스러워서
// 브라우저 native <input type="time"> 으로 갈음. iOS Safari/Chrome 모바일은 자동으로 휠 picker.
// PC Chrome/Edge 는 숫자 스피너 — PC 카운터(.exe) 환경에 자연스러움.
// 호출부는 네이티브와 동일 시그니처.

import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

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
  return { h, m, period: isPM ? 'PM' : 'AM' };
}

function parseHtmlTime(value) {
  const [hh, mm] = String(value || '').split(':');
  const h24 = parseInt(hh, 10);
  const m = parseInt(mm, 10);
  if (isNaN(h24) || isNaN(m)) return null;
  const period = h24 >= 12 ? 'PM' : 'AM';
  let h = h24 % 12;
  if (h === 0) h = 12;
  return { h, m, period };
}

function toHtmlTime(h, m, period) {
  let h24 = h;
  if (period === 'PM' && h !== 12) h24 = h + 12;
  if (period === 'AM' && h === 12) h24 = 0;
  return `${String(h24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function toTimeString(h, m) {
  return `${h}${String(m).padStart(2, '0')}`;
}

export default function TimeWheelPicker({
  visible,
  initialText,
  initialIsPM,
  onConfirm,
  onCancel,
}) {
  const [parsed, setParsed] = useState(() => toParsed(initialText, initialIsPM ?? true));

  useEffect(() => {
    if (visible) setParsed(toParsed(initialText, initialIsPM ?? true));
  }, [visible, initialText, initialIsPM]);

  if (!visible) return null;

  const htmlValue = toHtmlTime(parsed.h, parsed.m, parsed.period);

  const handleChange = (e) => {
    const next = parseHtmlTime(e?.target?.value);
    if (next) setParsed(next);
  };

  const handleConfirm = () => {
    onConfirm?.({
      text: toTimeString(parsed.h, parsed.m),
      isPM: parsed.period === 'PM',
      h: parsed.h,
      m: parsed.m,
    });
  };

  const periodLabel = parsed.period === 'PM' ? '오후' : '오전';

  return (
    <View style={styles.overlay} pointerEvents="auto">
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onCancel}
      />
      <View style={styles.modal}>
        <Text style={styles.title}>시간 선택</Text>
        <Text style={styles.preview}>
          {periodLabel} {parsed.h}시 {String(parsed.m).padStart(2, '0')}분
        </Text>
        <input
          type="time"
          value={htmlValue}
          onChange={handleChange}
          step={300}
          style={inputStyle}
        />
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

const inputStyle = {
  fontSize: 22,
  fontWeight: 700,
  textAlign: 'center',
  border: '2px solid #e5e7eb',
  borderRadius: 10,
  padding: '10px 16px',
  marginBottom: 16,
  color: '#111827',
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
  outline: 'none',
};

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
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  preview: {
    fontSize: 22,
    fontWeight: '800',
    color: '#dc2626',
    marginBottom: 12,
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
