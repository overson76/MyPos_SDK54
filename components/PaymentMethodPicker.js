// 결제수단 선택 모달 — 선불 / 후불 / 결제하기 버튼이 누르면 띄움.
// 4개 큰 버튼 (현금/카드/계좌이체/지역화폐) + 미분류 (기록만, 결제수단 추후 결정).
// 사용자가 선택하면 onSelect(code, autoPrint) 콜백. 취소 누르면 onClose.
//
// 자동 출력 옵션 (Electron 환경에서만 보임):
//   체크박스 — 결제 후 영수증 자동 출력. 사장님 선호 AsyncStorage 영속.
//   체크 시 호출자가 markPaid/clearTable 직후 printReceipt 자동 호출.
//
// iOS new architecture 의 <Modal> + 중첩 Pressable 호환 이슈 회피 — absolute 오버레이.

import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { PAYMENT_METHODS, PAYMENT_METHOD_LIST, PAYMENT_METHOD_UNSPECIFIED } from '../utils/payment';
import { isPrinterAvailable } from '../utils/printReceipt';
import { loadJSON, saveJSON } from '../utils/persistence';
import { useResponsive } from '../utils/useResponsive';

const AUTOPRINT_KEY = 'printer.autoPrint';

export default function PaymentMethodPicker({ onSelect, onClose, total, title = '결제수단 선택' }) {
  const { scale } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);
  const printerSupported = isPrinterAvailable();
  // autoPrint 사장님 선호 — AsyncStorage 영속. mount 시 로드, 토글 즉시 저장.
  const [autoPrint, setAutoPrint] = useState(false);

  useEffect(() => {
    if (!printerSupported) return;
    loadJSON(AUTOPRINT_KEY, false).then((v) => setAutoPrint(!!v));
  }, [printerSupported]);

  const toggleAutoPrint = (next) => {
    setAutoPrint(next);
    saveJSON(AUTOPRINT_KEY, next);
  };

  const handleSelect = (code) => {
    onSelect(code, printerSupported && autoPrint);
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
              >
                <Text style={styles.methodText}>{PAYMENT_METHODS[code]}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* 자동 출력 토글 — Electron(.exe) 환경에서만 보임. 일반 브라우저/폰은 숨김. */}
          {printerSupported ? (
            <View style={styles.autoPrintRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.autoPrintLabel}>결제 후 영수증 자동 출력</Text>
                <Text style={styles.autoPrintHelper}>
                  체크 시 결제 직후 프린터로 영수증 발행. 매장 흐름 자연스러움.
                </Text>
              </View>
              <Switch value={autoPrint} onValueChange={toggleAutoPrint} />
            </View>
          ) : null}

          {/* 미분류 — 결제수단 모를 때 (옛 흐름 호환). 작게. */}
          <TouchableOpacity
            style={styles.unspecBtn}
            onPress={() => handleSelect(PAYMENT_METHOD_UNSPECIFIED)}
          >
            <Text style={styles.unspecText}>나중에 분류 (미분류로 기록)</Text>
          </TouchableOpacity>
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
    autoPrintRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
      paddingHorizontal: 4,
      borderTopWidth: 1,
      borderTopColor: '#e5e7eb',
      marginTop: 4,
    },
    autoPrintLabel: { fontSize: fp(13), fontWeight: '700', color: '#111827' },
    autoPrintHelper: { fontSize: fp(11), color: '#6b7280', marginTop: 2 },
    unspecBtn: {
      paddingVertical: 10,
      alignItems: 'center',
    },
    unspecText: { color: '#6b7280', fontSize: fp(12), textDecorationLine: 'underline' },
  });
}
