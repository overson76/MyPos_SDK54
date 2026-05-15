// 배달 회수 — 그릇 회수 출력물 화면.
//
// 의도: 배달 완료 후 그릇 회수가 잊혀지기 쉬움. 출력물 들고 라이더가 회수.
// 멀리부터 가는 게 효율적 — 한 번 멀리 간 김에 가까운 곳들 들름.
//
// 데이터:
//   - revenue.history (오늘 결제완료 배달, 24시간 윈도우)
//   - addressBook (좌표 + 별칭)
//   - storeInfo (매장 좌표)
//
// 정렬:
//   - 원거리 우선 (기본) / 근거리 우선
//   - 주소불명 항목은 무조건 최상단 별도 섹션
//
// 출력:
//   - Electron(.exe): 영수증 프린터 직접 출력 (printReceipt)
//   - 그 외: 미리보기 Alert (PC 카운터에서 출력 권장 안내)

import { useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useOrders } from '../utils/OrderContext';
import { useStore } from '../utils/StoreContext';
import { useResponsive } from '../utils/useResponsive';
import { computeDeliveryReturns } from '../utils/deliveryReturns';
import { buildDeliveryReturnText } from '../utils/escposBuilder';
import { printReceipt, isPrinterAvailable } from '../utils/printReceipt';

export default function DeliveryReturnScreen() {
  const { scale } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);
  const { revenue, addressBook } = useOrders();
  const { storeInfo } = useStore();
  const [sortMode, setSortMode] = useState('far'); // 원거리 우선 기본 — 라이더 동선 효율

  const storeCoord = useMemo(() => {
    if (
      storeInfo &&
      typeof storeInfo.lat === 'number' &&
      typeof storeInfo.lng === 'number'
    ) {
      return { lat: storeInfo.lat, lng: storeInfo.lng };
    }
    return null;
  }, [storeInfo]);

  const result = useMemo(
    () =>
      computeDeliveryReturns({
        history: revenue?.history || [],
        addressBook,
        storeCoord,
        sortMode,
      }),
    [revenue, addressBook, storeCoord, sortMode]
  );

  const totalCount = result.ranked.length + result.unknown.length;
  const printerOk = isPrinterAvailable();

  const handlePrint = () => {
    const text = buildDeliveryReturnText(result, { printedAt: Date.now() });
    if (printerOk) {
      printReceipt({ rawText: text }).catch((e) => {
        Alert.alert('출력 실패', String(e?.message || e));
      });
      return;
    }
    // PC 영수증 프린터 없음 — 안내 + 미리보기 (Alert 로 텍스트 노출).
    const msg =
      'PC 영수증 프린터에서만 직접 출력됩니다.\n' +
      '아래 미리보기를 확인하고 매장 PC 카운터에서 출력하세요.\n\n' +
      text;
    if (Platform.OS === 'web') {
      // 웹은 prompt 로 복사 편의 — 사용자가 Ctrl+A → Ctrl+C 로 복사 가능.
      if (typeof window !== 'undefined' && window.alert) {
        window.alert(msg);
      }
    } else {
      Alert.alert('회수 목록 미리보기', msg, [{ text: '확인' }]);
    }
  };

  return (
    <View style={styles.container}>
      {/* ── 툴바 ──────────────────────────────────── */}
      <View style={styles.toolbar}>
        <View style={styles.sortGroup}>
          <TouchableOpacity
            style={[styles.sortBtn, sortMode === 'near' && styles.sortBtnActive]}
            onPress={() => setSortMode('near')}
          >
            <Text
              style={[
                styles.sortBtnText,
                sortMode === 'near' && styles.sortBtnTextActive,
              ]}
            >
              📍 근거리 순
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sortBtn, sortMode === 'far' && styles.sortBtnActive]}
            onPress={() => setSortMode('far')}
          >
            <Text
              style={[
                styles.sortBtnText,
                sortMode === 'far' && styles.sortBtnTextActive,
              ]}
            >
              🛵 원거리 순
            </Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[styles.printBtn, totalCount === 0 && styles.printBtnDisabled]}
          onPress={handlePrint}
          disabled={totalCount === 0}
        >
          <Text style={styles.printBtnText}>🖨️ 출력</Text>
        </TouchableOpacity>
      </View>

      {/* ── 상태 표시줄 ───────────────────────────── */}
      <View style={styles.statusBar}>
        <Text style={styles.statusText}>
          오늘 회수 대상 <Text style={styles.statusNum}>{totalCount}</Text>건
          {result.unknown.length > 0 && (
            <>
              {'  ·  '}
              <Text style={styles.statusUnknown}>
                주소불명 {result.unknown.length}건
              </Text>
            </>
          )}
          {!result.storeHasCoord && (
            <>
              {'  ·  '}
              <Text style={styles.statusWarn}>
                매장 좌표 미설정 → 거리 정렬 OFF (모두 주소불명 처리)
              </Text>
            </>
          )}
        </Text>
      </View>

      {totalCount === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>회수할 그릇이 없습니다</Text>
          <Text style={styles.emptyHint}>
            오늘 결제완료된 배달 주문이 자동으로 나타납니다 (24시간 윈도우)
          </Text>
        </View>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {/* 주소불명 섹션 (최상단) */}
          {result.unknown.length > 0 && (
            <View style={styles.section}>
              <View style={[styles.sectionHeader, styles.sectionHeaderUnknown]}>
                <Text style={styles.sectionTitleUnknown}>
                  ⚠️ 주소불명 ({result.unknown.length}건)
                </Text>
                <Text style={styles.sectionSubtitle}>
                  좌표 정보가 없어 거리 정렬 불가 — 먼저 확인 필요
                </Text>
              </View>
              {result.unknown.map((u) => (
                <View key={u.key} style={[styles.row, styles.rowUnknown]}>
                  <Text style={styles.rank}>0</Text>
                  <View style={styles.rowMain}>
                    <Text style={styles.rowLabel} numberOfLines={1}>
                      {u.label}
                    </Text>
                    <Text style={styles.rowMenu} numberOfLines={2}>
                      {u.menuSummary
                        .map((m) => `${m.name} ${m.qty}`)
                        .join(', ')}
                    </Text>
                    {u.totalDishes > 1 && (
                      <Text style={styles.rowTotal}>총 {u.totalDishes} 그릇</Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* 거리 정렬 섹션 */}
          {result.ranked.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>
                  {sortMode === 'near' ? '📍 근거리 순' : '🛵 원거리 순'} (
                  {result.ranked.length}건)
                </Text>
                {sortMode === 'far' && (
                  <Text style={styles.sectionSubtitle}>
                    멀리부터 회수 → 가까이로 — 라이더 동선 효율
                  </Text>
                )}
              </View>
              {result.ranked.map((it) => (
                <View key={it.key} style={styles.row}>
                  <Text style={styles.rank}>{it.rank}</Text>
                  <View style={styles.rowMain}>
                    <View style={styles.rowTitleLine}>
                      <Text style={styles.rowLabel} numberOfLines={1}>
                        {it.label}
                      </Text>
                      <Text style={styles.rowDist}>
                        {formatDist(it.distanceM)}
                      </Text>
                    </View>
                    <Text style={styles.rowMenu} numberOfLines={2}>
                      {it.menuSummary.map((m) => `${m.name} ${m.qty}`).join(', ')}
                    </Text>
                    <Text style={styles.rowTotal}>총 {it.totalDishes} 그릇</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function formatDist(m) {
  const v = Number(m) || 0;
  if (v < 1000) return `${v}m`;
  const km = v / 1000;
  return km < 10 ? `${km.toFixed(1)}km` : `${Math.round(km)}km`;
}

function makeStyles(scale = 1) {
  const fp = (n) => Math.round(n * scale);
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff' },
    toolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: '#f9fafb',
      borderBottomWidth: 1,
      borderBottomColor: '#e5e7eb',
    },
    sortGroup: { flexDirection: 'row', gap: 6 },
    sortBtn: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: '#fff',
      borderWidth: 1,
      borderColor: '#d1d5db',
    },
    sortBtnActive: {
      backgroundColor: '#2563eb',
      borderColor: '#1d4ed8',
    },
    sortBtnText: {
      fontSize: fp(13),
      fontWeight: '700',
      color: '#374151',
    },
    sortBtnTextActive: { color: '#fff' },
    printBtn: {
      marginLeft: 'auto',
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: '#16a34a',
    },
    printBtnDisabled: { backgroundColor: '#d1d5db' },
    printBtnText: { color: '#fff', fontSize: fp(13), fontWeight: '800' },

    statusBar: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: '#fff',
      borderBottomWidth: 1,
      borderBottomColor: '#f3f4f6',
    },
    statusText: { fontSize: fp(12), color: '#6b7280' },
    statusNum: { color: '#111827', fontWeight: '800' },
    statusUnknown: { color: '#d97706', fontWeight: '800' },
    statusWarn: { color: '#dc2626', fontWeight: '700' },

    empty: { padding: 40, alignItems: 'center', gap: 8 },
    emptyText: { fontSize: fp(14), color: '#6b7280', fontWeight: '700' },
    emptyHint: { fontSize: fp(11), color: '#9ca3af', textAlign: 'center' },

    list: { flex: 1 },
    listContent: { paddingBottom: 24 },

    section: { marginBottom: 16 },
    sectionHeader: {
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: '#eff6ff',
      borderBottomWidth: 1,
      borderBottomColor: '#dbeafe',
    },
    sectionHeaderUnknown: {
      backgroundColor: '#fef3c7',
      borderBottomColor: '#fcd34d',
    },
    sectionTitle: {
      fontSize: fp(13),
      fontWeight: '800',
      color: '#1d4ed8',
    },
    sectionTitleUnknown: {
      fontSize: fp(13),
      fontWeight: '800',
      color: '#92400e',
    },
    sectionSubtitle: {
      fontSize: fp(11),
      color: '#6b7280',
      marginTop: 2,
    },

    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: '#f3f4f6',
      gap: 12,
    },
    rowUnknown: { backgroundColor: '#fffbeb' },
    rank: {
      fontSize: fp(20),
      fontWeight: '900',
      color: '#1d4ed8',
      width: 28,
      textAlign: 'center',
      paddingTop: 2,
    },
    rowMain: { flex: 1, minWidth: 0, gap: 3 },
    rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    rowLabel: {
      fontSize: fp(14),
      fontWeight: '800',
      color: '#111827',
      flexShrink: 1,
    },
    rowDist: {
      fontSize: fp(11),
      fontWeight: '700',
      color: '#2563eb',
      flexShrink: 0,
    },
    rowMenu: {
      fontSize: fp(12),
      color: '#374151',
      lineHeight: fp(17),
    },
    rowTotal: {
      fontSize: fp(11),
      fontWeight: '700',
      color: '#dc2626',
    },
  });
}
