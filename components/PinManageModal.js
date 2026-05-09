// PIN 설정 / 변경 / 해제 모달.
// 1.0.24: AdminScreen 의 inner component 였던 것을 별도 파일로 추출
// (AdminScreen + AdminSettingsView 양쪽에서 사용 가능하도록).
//
// mode: 'set' (신규) | 'change' (변경 — old + new) | 'clear' (해제 — old 검증)
// RN <Modal> 대신 absolute 오버레이 — iOS new arch + nested Pressable 호환성 이슈 우회.

import { useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import PinEntry from './PinEntry';
import { useResponsive } from '../utils/useResponsive';
import { clearPin, setPin as savePin, verifyPin } from '../utils/pinLock';

export const PIN_LENGTH = 4;

export default function PinManageModal({ mode, onClose, onDone }) {
  const { scale } = useResponsive();
  const pinStyles = useMemo(() => makePinStyles(scale), [scale]);
  const [step, setStep] = useState(mode === 'change' || mode === 'clear' ? 'old' : 'new');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [firstNew, setFirstNew] = useState('');

  const titleByStep =
    step === 'old'
      ? mode === 'change'
        ? '기존 PIN 입력'
        : 'PIN 잠금 해제 — 현재 PIN 입력'
      : step === 'new'
      ? '새 PIN 입력 (4자리)'
      : '새 PIN 한 번 더 입력';

  const subtitleByStep =
    step === 'old'
      ? '확인을 위해 기존 PIN 을 입력하세요'
      : step === 'new'
      ? '메뉴 가격 / 매출 보호용 PIN'
      : '확인을 위해 다시 입력하세요';

  const onSubmit = async (pin) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (step === 'old') {
        const ok = await verifyPin(pin);
        if (!ok) {
          setError('PIN 이 일치하지 않습니다.');
        } else if (mode === 'clear') {
          await clearPin();
          onDone?.('cleared');
        } else {
          setStep('new');
        }
      } else if (step === 'new') {
        setFirstNew(pin);
        setStep('confirm');
      } else {
        if (pin !== firstNew) {
          setError('두 번 입력한 PIN 이 다릅니다. 다시 시작하세요.');
          setFirstNew('');
          setStep('new');
        } else {
          await savePin(pin);
          onDone?.(mode === 'set' ? 'set' : 'changed');
        }
      }
    } catch (e) {
      setError(e?.message || 'PIN 처리 중 오류');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={pinStyles.overlay} pointerEvents="auto">
      <Pressable style={pinStyles.backdrop} onPress={onClose}>
        <Pressable style={pinStyles.card} onPress={() => {}}>
          <View style={pinStyles.header}>
            <Text style={pinStyles.headerTitle}>{titleByStep}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Text style={pinStyles.close}>✕</Text>
            </TouchableOpacity>
          </View>
          <PinEntry
            title=""
            subtitle={subtitleByStep}
            errorMessage={error}
            length={PIN_LENGTH}
            onSubmit={onSubmit}
          />
        </Pressable>
      </Pressable>
    </View>
  );
}

function makePinStyles(scale = 1) {
  const fp = (n) => Math.round(n * scale);
  return StyleSheet.create({
    overlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 9999,
      elevation: 9999,
    },
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 16,
    },
    card: {
      width: '100%',
      maxWidth: 380,
      backgroundColor: '#fff',
      borderRadius: 12,
      overflow: 'hidden',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: '#e5e7eb',
    },
    headerTitle: { fontSize: fp(14), fontWeight: '800', color: '#111827' },
    close: { fontSize: fp(18), color: '#6b7280', paddingHorizontal: 4 },
  });
}
