// 숫자 키패드 PIN 입력 컴포넌트.
// onSubmit(pin: string) 이 호출되면 부모가 검증하고 결과 전달.
// length: PIN 자릿수 (기본 4)
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useResponsive } from '../utils/useResponsive';

const KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', '⌫'],
];

export default function PinEntry({
  title = 'PIN 입력',
  subtitle = '',
  errorMessage = '',
  length = 4,
  onSubmit,
  autoSubmit = true,
}) {
  const { scale } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);
  const [pin, setPin] = useState('');
  // 동일 pin 값에 대해 한 번만 submit. 부모가 onSubmit 을 매 렌더 새로 만들어
  // 이펙트가 재발화 되더라도 같은 입력으로 두 번 처리되지 않도록 방어.
  const lastSubmittedRef = useRef('');

  // 길이 도달시 자동 submit + 즉시 시각 초기화
  useEffect(() => {
    if (
      autoSubmit &&
      pin.length === length &&
      lastSubmittedRef.current !== pin
    ) {
      const submitted = pin;
      lastSubmittedRef.current = submitted;
      setPin(''); // 다음 입력 위해 즉시 초기화 — useEffect 재발화도 차단
      onSubmit?.(submitted);
    }
  }, [pin, length, autoSubmit, onSubmit]);

  // pin 이 비면 ref 도 리셋 — 다음 입력 사이클에 다시 submit 가능
  useEffect(() => {
    if (pin === '') lastSubmittedRef.current = '';
  }, [pin]);

  // errorMessage 가 새로 들어오면 입력 클리어
  useEffect(() => {
    if (errorMessage) setPin('');
  }, [errorMessage]);

  const press = (k) => {
    if (k === '') return;
    if (k === '⌫') {
      setPin((p) => p.slice(0, -1));
      return;
    }
    setPin((p) => (p.length < length ? p + k : p));
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      <View style={styles.dots}>
        {Array.from({ length }).map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i < pin.length && styles.dotFilled]}
          />
        ))}
      </View>
      {errorMessage ? (
        <Text style={styles.error}>{errorMessage}</Text>
      ) : (
        <View style={styles.errorPlaceholder} />
      )}
      <View style={styles.pad}>
        {KEYS.map((row, ri) => (
          <View key={ri} style={styles.padRow}>
            {row.map((k, ki) => (
              <TouchableOpacity
                key={`${ri}-${ki}`}
                style={[styles.key, !k && styles.keyEmpty]}
                onPress={() => press(k)}
                activeOpacity={k ? 0.6 : 1}
                disabled={!k}
                accessibilityLabel={
                  k === '⌫' ? '지우기' : k ? `${k}번` : ''
                }
              >
                <Text
                  style={[
                    styles.keyText,
                    k === '⌫' && styles.keyTextDelete,
                  ]}
                >
                  {k}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

// scale: useResponsive() 의 폰트 배율(lg=1.3, 그 외 1.0).
// 1.0.22: 사장님이 "PIN 4자리 숫자가 너무 작다" — 박스/폰트 크게.
// 1.0.29: 폰(landscape) 에서 한 화면에 안 들어오는 문제 — Dimensions 로 판별 후 작은 박스.
function makeStyles(scale = 1) {
  const fp = (n) => Math.round(n * scale);
  // 폰(landscape) 판별 — height < 500 이면 폰 가로. 키 박스 작게.
  const { Dimensions } = require('react-native');
  const { width: W, height: H } = Dimensions.get('window');
  const isCompact = H < 500 || W < 700;
  const KEY = isCompact ? 44 : 64;
  const KEY_FONT = isCompact ? 18 : 26;
  const KEY_DEL_FONT = isCompact ? 16 : 22;
  const DOT = isCompact ? 12 : 16;
  const DOT_GAP = isCompact ? 12 : 18;
  const PAD_GAP = isCompact ? 6 : 10;
  return StyleSheet.create({
  root: {
    padding: isCompact ? 10 : 18,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  title: {
    fontSize: fp(isCompact ? 14 : 18),
    fontWeight: '800',
    color: '#111827',
    marginBottom: 2,
  },
  subtitle: {
    fontSize: fp(isCompact ? 11 : 14),
    color: '#6b7280',
    marginBottom: isCompact ? 6 : 12,
    textAlign: 'center',
  },
  dots: {
    flexDirection: 'row',
    gap: DOT_GAP,
    marginVertical: isCompact ? 4 : 10,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 2,
    borderColor: '#9ca3af',
    backgroundColor: 'transparent',
  },
  dotFilled: {
    backgroundColor: '#111827',
    borderColor: '#111827',
  },
  error: {
    fontSize: fp(isCompact ? 11 : 13),
    color: '#dc2626',
    marginTop: isCompact ? 2 : 6,
    marginBottom: isCompact ? 2 : 4,
    fontWeight: '600',
    minHeight: isCompact ? 14 : 18,
  },
  errorPlaceholder: { minHeight: isCompact ? 14 : 18, marginTop: isCompact ? 2 : 6, marginBottom: isCompact ? 2 : 4 },
  pad: { marginTop: isCompact ? 4 : 10, gap: PAD_GAP },
  padRow: { flexDirection: 'row', gap: PAD_GAP },
  key: {
    width: KEY,
    height: KEY,
    borderRadius: KEY / 2,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyEmpty: { backgroundColor: 'transparent' },
  keyText: {
    fontSize: fp(KEY_FONT),
    color: '#111827',
    fontWeight: '700',
  },
  keyTextDelete: { fontSize: fp(KEY_DEL_FONT), color: '#6b7280' },
  });
}
