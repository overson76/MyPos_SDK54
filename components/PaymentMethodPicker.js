// 결제수단 선택 모달 — 선불 / 후불 / 결제하기 버튼이 누르면 띄움.
// 4개 큰 버튼 (현금/카드/계좌이체/지역화폐) + 미분류 (기록만, 결제수단 추후 결정).
//
// onSelect(code, opts) 콜백 — opts = { autoPrint, kisApproval? }.
//   - autoPrint: 영수증 자동 출력 (Electron 만)
//   - kisApproval: KIS 카드 단말기 승인 결과 (카드 선택 + 단말기 사용 토글 ON 시)
//
// 자동 출력 옵션 (Electron 환경에서만 보임): 결제 후 영수증 자동 출력.
// KIS 단말기 옵션 (Electron + KIS 가능 시만 보임): 카드 선택 시 자동으로 단말기 호출.
//
// iOS new architecture 의 <Modal> + 중첩 Pressable 호환 이슈 회피 — absolute 오버레이.

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { PAYMENT_METHODS, PAYMENT_METHOD_LIST, PAYMENT_METHOD_UNSPECIFIED } from '../utils/payment';
import { isPrinterAvailable } from '../utils/printReceipt';
import { isKisPaymentAvailable, kisPay } from '../utils/kisPayment';
import { loadJSON, saveJSON } from '../utils/persistence';
import { useResponsive } from '../utils/useResponsive';

const AUTOPRINT_KEY = 'printer.autoPrint';
const KIS_AUTO_KEY = 'kis.autoTerminal';

export default function PaymentMethodPicker({ onSelect, onClose, total, title = '결제수단 선택' }) {
  const { scale } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);
  const printerSupported = isPrinterAvailable();
  const kisSupported = isKisPaymentAvailable();

  // autoPrint 사장님 선호 — AsyncStorage 영속. mount 시 로드, 토글 즉시 저장.
  const [autoPrint, setAutoPrint] = useState(false);
  // KIS 단말기 자동 호출 — 카드 선택 시 단말기로 보낼지 여부.
  const [kisAuto, setKisAuto] = useState(false);
  // 카드 단말기 진행 상태 — null | 'paying' | 'failed'.
  const [terminalState, setTerminalState] = useState(null);
  const [terminalError, setTerminalError] = useState('');

  useEffect(() => {
    if (printerSupported) loadJSON(AUTOPRINT_KEY, false).then((v) => setAutoPrint(!!v));
    if (kisSupported) loadJSON(KIS_AUTO_KEY, true).then((v) => setKisAuto(v !== false));
  }, [printerSupported, kisSupported]);

  const toggleAutoPrint = (next) => {
    setAutoPrint(next);
    saveJSON(AUTOPRINT_KEY, next);
  };
  const toggleKisAuto = (next) => {
    setKisAuto(next);
    saveJSON(KIS_AUTO_KEY, next);
  };

  const finalize = (code, kisApproval = null) => {
    onSelect(code, { autoPrint: printerSupported && autoPrint, kisApproval });
  };

  const handleSelect = async (code) => {
    // 카드 + KIS 가능 + 토글 ON → 단말기 결제 시도. 그 외엔 즉시 onSelect.
    const useTerminal = code === 'card' && kisSupported && kisAuto && Number(total) > 0;
    if (!useTerminal) {
      finalize(code);
      return;
    }

    setTerminalState('paying');
    setTerminalError('');
    const result = await kisPay({
      tradeType: 'D1',
      amount: Math.round(Number(total) || 0),
    });

    if (result?.ok && result?.data?.ok) {
      // 승인 성공 — 카드 결제 + 승인 데이터 전달.
      setTerminalState(null);
      finalize('card', result.data);
      return;
    }

    // 실패: 진행 모달에 사유 표시. 사용자가 재시도 / 다른 결제수단 선택 가능.
    const msg =
      result?.data?.replyMsg1
      || result?.error
      || result?.message
      || '카드 결제 실패';
    setTerminalError(msg);
    setTerminalState('failed');
  };

  const cancelTerminal = () => {
    setTerminalState(null);
    setTerminalError('');
  };

  return (
    <View style={styles.overlay} pointerEvents="auto">
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>
          {typeof total === 'number' && total > 0 ? (
            <Text style={styles.totalText}>합계 {total.toLocaleString('ko-KR')}원</Text>
          ) : null}

          <View style={styles.grid}>
            {PAYMENT_METHOD_LIST.map((code) => (
              <TouchableOpacity
                key={code}
                style={styles.methodBtn}
                onPress={() => handleSelect(code)}
                activeOpacity={0.8}
                disabled={terminalState === 'paying'}
              >
                <Text style={styles.methodText}>{PAYMENT_METHODS[code]}</Text>
                {code === 'card' && kisSupported && kisAuto ? (
                  <Text style={styles.terminalHint}>🏧 단말기 호출</Text>
                ) : null}
              </TouchableOpacity>
            ))}
          </View>

          {/* KIS 카드 단말기 자동 호출 토글 — Electron + KIS 가능 시만. */}
          {kisSupported ? (
            <View style={styles.optionRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.optionLabel}>카드 선택 시 단말기 자동 호출</Text>
                <Text style={styles.optionHelper}>
                  체크 시 카드 버튼 누르면 KIS-NAGT 로 결제 진행. 미체크 시 결제수단 기록만.
                </Text>
              </View>
              <Switch value={kisAuto} onValueChange={toggleKisAuto} />
            </View>
          ) : null}

          {/* 자동 출력 토글 — Electron(.exe) 환경에서만. */}
          {printerSupported ? (
            <View style={styles.optionRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.optionLabel}>결제 후 영수증 자동 출력</Text>
                <Text style={styles.optionHelper}>
                  체크 시 결제 직후 프린터로 영수증 발행. 매장 흐름 자연스러움.
                </Text>
              </View>
              <Switch value={autoPrint} onValueChange={toggleAutoPrint} />
            </View>
          ) : null}

          <TouchableOpacity
            style={styles.unspecBtn}
            onPress={() => finalize(PAYMENT_METHOD_UNSPECIFIED)}
            disabled={terminalState === 'paying'}
          >
            <Text style={styles.unspecText}>나중에 분류 (미분류로 기록)</Text>
          </TouchableOpacity>

          {/* 카드 단말기 진행 모달 — 같은 카드 위에 absolute 로 오버레이. */}
          {terminalState ? (
            <View style={styles.terminalOverlay}>
              {terminalState === 'paying' ? (
                <>
                  <ActivityIndicator size="large" color="#1F2937" />
                  <Text style={styles.terminalTitle}>카드 단말기 결제 진행 중…</Text>
                  <Text style={styles.terminalSub}>
                    카드를 단말기에 꽂거나 대주세요.{'\n'}
                    완료 시 자동으로 닫힙니다.
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.terminalErrIcon}>⚠️</Text>
                  <Text style={styles.terminalTitle}>카드 결제 실패</Text>
                  <Text style={styles.terminalErr}>{terminalError}</Text>
                  <View style={styles.terminalActions}>
                    <TouchableOpacity style={styles.terminalRetry} onPress={() => handleSelect('card')}>
                      <Text style={styles.terminalRetryText}>다시 시도</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.terminalCancel} onPress={cancelTerminal}>
                      <Text style={styles.terminalCancelText}>다른 결제수단 선택</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </View>
  );
}

function makeStyles(scale = 1) {
  const fp = (n) => Math.round(n * scale);
  return StyleSheet.create({
    overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 200 },
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    card: {
      width: 380,
      backgroundColor: '#fff',
      borderRadius: 16,
      padding: 20,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    title: { fontSize: fp(17), fontWeight: '800', color: '#111827' },
    close: { fontSize: fp(20), color: '#6b7280', paddingHorizontal: 8 },
    totalText: {
      fontSize: fp(15),
      color: '#374151',
      fontWeight: '700',
      marginBottom: 16,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      marginBottom: 12,
    },
    methodBtn: {
      flexBasis: '48%',
      paddingVertical: 22,
      borderRadius: 12,
      backgroundColor: '#1F2937',
      alignItems: 'center',
    },
    methodText: { color: '#fff', fontSize: fp(16), fontWeight: '800' },
    terminalHint: { color: '#a7f3d0', fontSize: fp(10), marginTop: 4, fontWeight: '600' },
    optionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
      paddingHorizontal: 4,
      borderTopWidth: 1,
      borderTopColor: '#e5e7eb',
      marginTop: 4,
    },
    optionLabel: { fontSize: fp(13), fontWeight: '700', color: '#111827' },
    optionHelper: { fontSize: fp(11), color: '#6b7280', marginTop: 2 },
    unspecBtn: { paddingVertical: 10, alignItems: 'center' },
    unspecText: { color: '#6b7280', fontSize: fp(12), textDecorationLine: 'underline' },

    terminalOverlay: {
      position: 'absolute',
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(255,255,255,0.97)',
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      gap: 10,
    },
    terminalTitle: { fontSize: fp(16), fontWeight: '800', color: '#111827', marginTop: 8 },
    terminalSub: { fontSize: fp(13), color: '#374151', textAlign: 'center', lineHeight: 20 },
    terminalErrIcon: { fontSize: fp(36) },
    terminalErr: {
      fontSize: fp(13),
      color: '#b91c1c',
      textAlign: 'center',
      backgroundColor: '#fee2e2',
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 8,
      marginTop: 4,
    },
    terminalActions: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 16,
      width: '100%',
    },
    terminalRetry: {
      flex: 1,
      paddingVertical: 12,
      backgroundColor: '#1F2937',
      borderRadius: 8,
      alignItems: 'center',
    },
    terminalRetryText: { color: '#fff', fontWeight: '800', fontSize: fp(13) },
    terminalCancel: {
      flex: 1,
      paddingVertical: 12,
      backgroundColor: '#e5e7eb',
      borderRadius: 8,
      alignItems: 'center',
    },
    terminalCancelText: { color: '#374151', fontWeight: '700', fontSize: fp(13) },
  });
}
