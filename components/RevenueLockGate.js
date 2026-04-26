// 수익현황 화면 게이트 — 매장 공유 PIN 으로 검증.
// PIN 미설정이면 자동 unlock (대표가 아직 설정 안 함 → 모든 멤버 열람 가능).
// PIN 설정됐으면 PinEntry 표시, 일치 시 자식 렌더.
//
// 기존 LockGate(기기 PIN) 와 별개. PIN 정책:
//   - 기기 잠금 PIN: 각 기기에서 LockContext 로 관리 (자동잠금)
//   - 수익 PIN: 매장 공유, stores/{sid}.revenuePinHash. 대표만 설정/변경.

import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import PinEntry from './PinEntry';
import { useStore } from '../utils/StoreContext';
import { hasRevenuePin, verifyRevenuePin } from '../utils/revenuePin';

export default function RevenueLockGate({ children, length = 4 }) {
  const { storeInfo } = useStore();
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // PIN 미설정 → 게이트 통과.
  if (!hasRevenuePin(storeInfo)) return children;
  if (unlocked) return children;

  const onSubmit = async (pin) => {
    if (busy) return;
    setBusy(true);
    setError('');
    const ok = await verifyRevenuePin(storeInfo, pin);
    setBusy(false);
    if (ok) {
      setUnlocked(true);
    } else {
      setError('PIN 이 일치하지 않습니다.');
    }
  };

  return (
    <View style={styles.gateRoot}>
      <Text style={styles.lockIcon}>🔒</Text>
      <PinEntry
        title="수익 현황 잠금"
        subtitle={`매장 공유 PIN ${length}자리를 입력하세요`}
        errorMessage={error}
        length={length}
        onSubmit={onSubmit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  gateRoot: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 16,
    backgroundColor: '#fff',
  },
  lockIcon: { fontSize: 28, marginBottom: 4 },
});
