import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useOrders } from '../utils/OrderContext';

function formatDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

function ymKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function ymLabel(key) {
  const [y, m] = key.split('-');
  return `${y}년 ${parseInt(m, 10)}월`;
}

export default function RevenueScreen() {
  const { revenue } = useOrders();
  const history = revenue?.history || [];

  const now = new Date();
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  const monthStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    1
  ).getTime();
  const thisMonthKey = ymKey(Date.now());

  const todayOrders = history.filter((h) => h.clearedAt >= todayStart);
  const thisMonthOrders = history.filter((h) => h.clearedAt >= monthStart);
  const todayTotal = todayOrders.reduce((s, h) => s + h.total, 0);
  const monthTotal = thisMonthOrders.reduce((s, h) => s + h.total, 0);

  const byMonth = {};
  history.forEach((h) => {
    const key = ymKey(h.clearedAt);
    if (!byMonth[key]) byMonth[key] = { total: 0, count: 0 };
    byMonth[key].total += h.total;
    byMonth[key].count += 1;
  });
  const monthlyList = Object.entries(byMonth)
    .map(([key, val]) => ({ key, ...val }))
    .sort((a, b) => b.key.localeCompare(a.key));

  return (
    <ScrollView style={styles.container}>
      <View style={styles.summaryRow}>
        <View style={[styles.summaryCard, styles.cardToday]}>
          <Text style={styles.summaryLabel}>오늘 수익</Text>
          <Text style={styles.summaryValue}>
            {todayTotal.toLocaleString()}원
          </Text>
          <Text style={styles.summarySub}>
            {todayOrders.length}건 · {now.getMonth() + 1}/{now.getDate()}
          </Text>
        </View>
        <View style={[styles.summaryCard, styles.cardMonth]}>
          <Text style={styles.summaryLabel}>이번 달 누적</Text>
          <Text style={styles.summaryValue}>
            {monthTotal.toLocaleString()}원
          </Text>
          <Text style={styles.summarySub}>
            {thisMonthOrders.length}건 · 매월 1일 자동 리셋
          </Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>📅 매월 수익</Text>

      {monthlyList.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>수익 기록이 없습니다</Text>
          <Text style={styles.emptyHint}>
            테이블 비우기 · 후불 · 선불 완료 시 자동 집계됩니다
          </Text>
        </View>
      ) : (
        monthlyList.map((m) => {
          const isCurrent = m.key === thisMonthKey;
          return (
            <View
              key={m.key}
              style={[styles.monthRow, isCurrent && styles.monthRowCurrent]}
            >
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.monthLabel,
                    isCurrent && styles.monthLabelCurrent,
                  ]}
                >
                  {ymLabel(m.key)}
                  {isCurrent && (
                    <Text style={styles.monthTag}> 이번 달</Text>
                  )}
                </Text>
                <Text style={styles.monthCount}>{m.count}건 완료</Text>
              </View>
              <Text
                style={[
                  styles.monthTotal,
                  isCurrent && styles.monthTotalCurrent,
                ]}
              >
                {m.total.toLocaleString()}원
              </Text>
            </View>
          );
        })
      )}

      <Text style={styles.sectionTitle}>🧾 최근 주문 이력</Text>
      {history.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyHint}>아직 완료된 주문이 없습니다</Text>
        </View>
      ) : (
        history
          .slice()
          .reverse()
          .slice(0, 30)
          .map((h) => (
            <View key={h.id} style={styles.historyRow}>
              <View style={styles.historyHeader}>
                <Text style={styles.historyTable}>{h.tableId}</Text>
                <Text style={styles.historyTime}>
                  {formatDateTime(h.clearedAt)}
                </Text>
                <Text
                  style={[
                    styles.historyPay,
                    h.paymentStatus === 'paid' && styles.historyPayPaid,
                  ]}
                >
                  {h.paymentStatus === 'paid' ? '선불' : '후불'}
                </Text>
              </View>
              <View style={styles.historyItems}>
                {h.items.map((i) => (
                  <Text key={i.id} style={styles.historyItem}>
                    {i.name}
                    {(i.largeQty || 0) > 0 &&
                      ` (대${
                        i.largeQty === i.qty ? '' : ` ${i.largeQty}`
                      })`}{' '}
                    ×{i.qty}
                  </Text>
                ))}
              </View>
              {h.deliveryAddress ? (
                <Text style={styles.historyAddr}>📍 {h.deliveryAddress}</Text>
              ) : null}
              <Text style={styles.historyTotal}>
                {h.total.toLocaleString()}원
              </Text>
            </View>
          ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  summaryRow: { flexDirection: 'row', gap: 12, padding: 16 },
  summaryCard: {
    flex: 1,
    borderRadius: 12,
    padding: 18,
    gap: 4,
  },
  cardToday: { backgroundColor: '#2563eb' },
  cardMonth: { backgroundColor: '#7c3aed' },
  summaryLabel: { fontSize: 12, color: 'rgba(255,255,255,0.8)', fontWeight: '600' },
  summaryValue: {
    fontSize: 26,
    color: '#fff',
    fontWeight: '800',
    marginTop: 4,
  },
  summarySub: { fontSize: 11, color: 'rgba(255,255,255,0.7)' },

  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 6,
  },

  empty: { alignItems: 'center', padding: 40, gap: 8 },
  emptyText: { fontSize: 14, color: '#6b7280', fontWeight: '600' },
  emptyHint: { fontSize: 12, color: '#9ca3af', textAlign: 'center' },

  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginBottom: 6,
    padding: 14,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  monthRowCurrent: {
    borderColor: '#7c3aed',
    backgroundColor: '#faf5ff',
    borderWidth: 2,
  },
  monthLabel: { fontSize: 15, color: '#111827', fontWeight: '700' },
  monthLabelCurrent: { color: '#5b21b6' },
  monthTag: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '800',
    backgroundColor: '#7c3aed',
  },
  monthCount: { fontSize: 11, color: '#6b7280', marginTop: 2 },
  monthTotal: { fontSize: 17, color: '#111827', fontWeight: '800' },
  monthTotalCurrent: { color: '#5b21b6' },

  historyRow: {
    marginHorizontal: 12,
    marginBottom: 6,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    gap: 4,
  },
  historyHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  historyTable: {
    fontSize: 13,
    fontWeight: '800',
    color: '#111827',
    backgroundColor: '#eef2ff',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  historyTime: { fontSize: 11, color: '#6b7280', flex: 1 },
  historyPay: {
    fontSize: 10,
    fontWeight: '700',
    color: '#374151',
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  historyPayPaid: { color: '#fff', backgroundColor: '#2563eb' },
  historyItems: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  historyItem: { fontSize: 11, color: '#374151' },
  historyAddr: { fontSize: 10, color: '#dc2626', fontWeight: '600' },
  historyTotal: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'right',
  },
});
