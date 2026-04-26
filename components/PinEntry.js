// 숫자 키패드 PIN 입력 컴포넌트.
// onSubmit(pin: string) 이 호출되면 부모가 검증하고 결과 전달.
// length: PIN 자릿수 (기본 4)
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

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

const styles = StyleSheet.create({
  root: {
    padding: 12,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 11,
    color: '#6b7280',
    marginBottom: 8,
    textAlign: 'center',
  },
  dots: {
    flexDirection: 'row',
    gap: 12,
    marginVertical: 6,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#9ca3af',
    backgroundColor: 'transparent',
  },
  dotFilled: {
    backgroundColor: '#111827',
    borderColor: '#111827',
  },
  error: {
    fontSize: 11,
    color: '#dc2626',
    marginTop: 4,
    marginBottom: 2,
    fontWeight: '600',
    minHeight: 14,
  },
  errorPlaceholder: { minHeight: 14, marginTop: 4, marginBottom: 2 },
  pad: { marginTop: 6, gap: 6 },
  padRow: { flexDirection: 'row', gap: 6 },
  key: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyEmpty: { backgroundColor: 'transparent' },
  keyText: {
    fontSize: 18,
    color: '#111827',
    fontWeight: '600',
  },
  keyTextDelete: { fontSize: 16, color: '#6b7280' },
});
