import { useEffect, useMemo, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useOrders } from '../utils/OrderContext';
import { useResponsive } from '../utils/useResponsive';
import { resolveAnyTable, tableTypeColors } from '../utils/tableData';
import { paymentMethodLabel } from '../utils/payment';

const TAB_PAID = 'paid';
const TAB_READY = 'ready';

function formatDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatElapsed(ts, now) {
  if (!ts) return '';
  const mins = Math.max(0, Math.floor((now - ts) / 60000));
  if (mins === 0) return '방금';
  if (mins < 60) return `${mins}분 경과`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest === 0 ? `${hours}시간 경과` : `${hours}시간 ${rest}분 경과`;
}

function resolveTable(tableId) {
  if (!tableId) return null;
  if (tableId.includes('#')) {
    const [parentId, partIdx] = tableId.split('#');
    const parent = resolveAnyTable(parentId);
    if (!parent) return null;
    return { ...parent, id: tableId, label: `${parent.label}-${partIdx}`, parentId };
  }
  return resolveAnyTable(tableId);
}

function confirmAndProceed({ title, msg, proceed }) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    if (window?.confirm?.(msg)) proceed();
  } else {
    Alert.alert(title, msg, [
      { text: '취소', style: 'cancel' },
      { text: '되돌리기', style: 'destructive', onPress: proceed },
    ]);
  }
}

function alertFail(text) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window?.alert?.(text);
  } else {
    Alert.alert('되돌리기 실패', text);
  }
}

export default function UndoScreen() {
  const { scale } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);
  const { orders, revenue, undoMarkReady, revertHistoryEntry } = useOrders();
  const [tab, setTab] = useState(TAB_PAID);

  // 조리완료 카드의 경과 분 표시 — 30초마다 리렌더
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  // 결제완료 목록 — reverted 제외, clearedAt 최신순
  const paidEntries = useMemo(() => {
    const list = (revenue?.history || []).filter((h) => !h.reverted);
    return list.slice().sort((a, b) => (b.clearedAt || 0) - (a.clearedAt || 0));
  }, [revenue]);

  // 조리완료 목록 — status==='ready' 인 살아있는 테이블, readyAt 최신순
  const readyOrders = useMemo(() => {
    return Object.entries(orders)
      .map(([tableId, o]) => ({ tableId, table: resolveTable(tableId), ...o }))
      .filter((o) => o.table && o.status === 'ready' && o.readyAt)
      .sort((a, b) => (b.readyAt || 0) - (a.readyAt || 0));
  }, [orders]);

  const handleRevertPaid = (entry) => {
    const itemNames = (entry.items || []).map((i) => i.name).join(', ');
    const msg = `테이블 ${entry.tableId} 의 결제 기록을 되돌립니다.\n\n· 주문 항목 (${itemNames}) 이 다시 살아납니다\n· 매출 합계에서 제외되며 "되돌림" 으로 표시됩니다\n· 같은 테이블에 새 주문이 있으면 거부됩니다\n\n진행할까요?`;
    confirmAndProceed({
      title: '결제 되돌리기',
      msg,
      proceed: () => {
        const result = revertHistoryEntry(entry.id);
        if (result.ok) return;
        const reasonMap = {
          notFound: '이력에서 해당 항목을 찾지 못했습니다.',
          occupied: `테이블 ${entry.tableId} 에 이미 새 주문이 있습니다. 먼저 그 테이블을 정리해야 합니다.`,
          alreadyReverted: '이미 되돌린 항목입니다.',
        };
        alertFail(reasonMap[result.reason] || '되돌리기에 실패했습니다.');
      },
    });
  };

  const handleRevertReady = (o) => {
    const msg = `${o.table?.label || o.tableId} 의 조리완료를 되돌립니다.\n\n· 주문이 다시 "조리중" 상태로 돌아갑니다\n· 주문현황 메인 목록에 다시 나타납니다\n\n진행할까요?`;
    confirmAndProceed({
      title: '조리완료 되돌리기',
      msg,
      proceed: () => {
        const ok = undoMarkReady(o.tableId);
        if (!ok) alertFail('이미 처리된 항목입니다.');
      },
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === TAB_PAID && styles.tabBtnActive]}
          onPress={() => setTab(TAB_PAID)}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabText, tab === TAB_PAID && styles.tabTextActive]}>
            결제완료 되돌리기 ({paidEntries.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === TAB_READY && styles.tabBtnActive]}
          onPress={() => setTab(TAB_READY)}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabText, tab === TAB_READY && styles.tabTextActive]}>
            조리완료 되돌리기 ({readyOrders.length})
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.hint}>
        {tab === TAB_PAID
          ? '결제완료 / 테이블비우기 실수 보정 — 최신순. 같은 테이블에 새 주문이 없을 때만 되돌릴 수 있습니다.'
          : '조리완료 실수 보정 — 최신순. "조리중" 상태로 되돌려 주문현황에 다시 나타납니다.'}
      </Text>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator
      >
        {tab === TAB_PAID && paidEntries.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>되돌릴 결제 이력이 없습니다.</Text>
          </View>
        )}
        {tab === TAB_READY && readyOrders.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>되돌릴 조리완료 주문이 없습니다.</Text>
          </View>
        )}

        {tab === TAB_PAID &&
          paidEntries.map((h) => {
            const t = resolveTable(h.tableId);
            const color = (t && tableTypeColors[t.type]) || '#6b7280';
            const qty = (h.items || []).reduce((s, i) => s + (i.qty || 0), 0);
            return (
              <View key={h.id} style={[styles.row, { borderLeftColor: color }]}>
                <View style={styles.rowHead}>
                  <Text style={styles.rowLabel}>{t?.label || h.tableId}</Text>
                  <Text style={styles.rowTime}>{formatDateTime(h.clearedAt)}</Text>
                  <Text
                    style={[
                      styles.rowPay,
                      h.paymentStatus === 'paid' && styles.rowPayPaid,
                    ]}
                  >
                    {h.paymentStatus === 'paid' ? '선불' : '후불'}
                  </Text>
                  <Text style={styles.rowMethod}>{paymentMethodLabel(h.paymentMethod)}</Text>
                </View>
                <View style={styles.rowItems}>
                  {(h.items || []).map((i) => (
                    <Text key={i.id} style={styles.rowItem} numberOfLines={1}>
                      {i.name}
                      {(i.largeQty || 0) > 0 &&
                        ` (대${i.largeQty === i.qty ? '' : ` ${i.largeQty}`})`}{' '}
                      ×{i.qty}
                    </Text>
                  ))}
                </View>
                {h.deliveryAddress ? (
                  <Text style={styles.rowAddr} numberOfLines={1}>📍 {h.deliveryAddress}</Text>
                ) : null}
                <View style={styles.rowFooter}>
                  <Text style={styles.rowMeta}>합계 {qty}개</Text>
                  <Text style={styles.rowTotal}>{Number(h.total || 0).toLocaleString()}원</Text>
                  <TouchableOpacity
                    style={styles.undoBtn}
                    onPress={() => handleRevertPaid(h)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.undoBtnText}>↶ 되돌리기</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}

        {tab === TAB_READY &&
          readyOrders.map((o) => {
            const color = tableTypeColors[o.table.type] || '#6b7280';
            const qty = (o.items || []).reduce((s, i) => s + (i.qty || 0), 0);
            return (
              <View key={o.tableId} style={[styles.row, { borderLeftColor: color }]}>
                <View style={styles.rowHead}>
                  <Text style={styles.rowLabel}>{o.table.label}</Text>
                  <Text style={styles.rowTime}>
                    {formatDateTime(o.readyAt)} · {formatElapsed(o.readyAt, nowTick)}
                  </Text>
                </View>
                <View style={styles.rowItems}>
                  {(o.items || []).map((i) => (
                    <Text key={i.slotId || i.id} style={styles.rowItem} numberOfLines={1}>
                      {i.name}
                      {(i.largeQty || 0) > 0 &&
                        ` (대${i.largeQty === i.qty ? '' : ` ${i.largeQty}`})`}{' '}
                      ×{i.qty}
                    </Text>
                  ))}
                </View>
                {o.deliveryAddress ? (
                  <Text style={styles.rowAddr} numberOfLines={1}>📍 {o.deliveryAddress}</Text>
                ) : null}
                <View style={styles.rowFooter}>
                  <Text style={styles.rowMeta}>합계 {qty}개</Text>
                  <TouchableOpacity
                    style={styles.undoBtn}
                    onPress={() => handleRevertReady(o)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.undoBtnText}>↶ 되돌리기</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
      </ScrollView>
    </View>
  );
}

function makeStyles(scale = 1) {
  const fp = (n) => Math.round(n * scale);
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f9fafb' },
    tabRow: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 8,
    },
    tabBtn: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: '#e5e7eb',
      alignItems: 'center',
      justifyContent: 'center',
    },
    tabBtnActive: { backgroundColor: '#111827' },
    tabText: { fontSize: fp(14), fontWeight: '700', color: '#374151' },
    tabTextActive: { color: '#fff' },
    hint: {
      fontSize: fp(12),
      color: '#6b7280',
      paddingHorizontal: 16,
      paddingBottom: 8,
    },
    scroll: { flex: 1 },
    scrollContent: { paddingHorizontal: 16, paddingBottom: 24 },
    empty: {
      paddingVertical: 48,
      alignItems: 'center',
    },
    emptyText: { fontSize: fp(13), color: '#9ca3af' },
    row: {
      backgroundColor: '#fff',
      borderRadius: 10,
      borderLeftWidth: 4,
      paddingVertical: 10,
      paddingHorizontal: 12,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: '#e5e7eb',
    },
    rowHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 6,
    },
    rowLabel: { fontSize: fp(14), fontWeight: '800', color: '#111827' },
    rowTime: { fontSize: fp(11), color: '#6b7280' },
    rowPay: {
      fontSize: fp(11),
      color: '#6b7280',
      fontWeight: '600',
      backgroundColor: '#f3f4f6',
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
    },
    rowPayPaid: { color: '#fff', backgroundColor: '#16a34a' },
    rowMethod: { fontSize: fp(11), color: '#374151', fontWeight: '600' },
    rowItems: { gap: 2, marginBottom: 4 },
    rowItem: { fontSize: fp(12), color: '#374151' },
    rowAddr: { fontSize: fp(11), color: '#6b7280', marginBottom: 4 },
    rowFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 4,
    },
    rowMeta: { fontSize: fp(11), color: '#6b7280' },
    rowTotal: {
      fontSize: fp(14),
      fontWeight: '800',
      color: '#111827',
      flex: 1,
      textAlign: 'right',
    },
    undoBtn: {
      backgroundColor: '#dc2626',
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 8,
      marginLeft: 'auto',
    },
    undoBtnText: { color: '#fff', fontSize: fp(12), fontWeight: '700' },
  });
}
