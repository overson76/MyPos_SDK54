// 잠긴 영역(예: 수익 현황) 을 자식으로 감싸 PIN 진입 게이트로 사용.
// PIN 미설정이거나 unlocked 상태면 자식 렌더, 잠긴 상태면 PinEntry 표시.
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import PinEntry from './PinEntry';
import { useLock } from '../utils/LockContext';

export default function LockGate({ children, title, subtitle, length = 4 }) {
  const { ready, isUnlocked, unlock } = useLock();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  if (isUnlocked) return children;

  const onSubmit = async (pin) => {
    if (busy) return;
    setBusy(true);
    setError('');
    const ok = await unlock(pin);
    setBusy(false);
    if (!ok) setError('PIN 이 일치하지 않습니다.');
  };

  return (
    <View style={styles.gateRoot}>
      <Text style={styles.lockIcon}>🔒</Text>
      <PinEntry
        title={title || '관리자 잠금'}
        subtitle={subtitle || `PIN ${length}자리를 입력하세요`}
        errorMessage={error}
        length={length}
        onSubmit={onSubmit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  gateRoot: { flex: 1, alignItems: 'center', paddingTop: 16, backgroundColor: '#fff' },
  lockIcon: { fontSize: 28, marginBottom: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
