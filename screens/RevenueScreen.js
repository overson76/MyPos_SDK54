import { useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useOrders } from '../utils/OrderContext';
import { useMenu } from '../utils/MenuContext';
import { useStore } from '../utils/StoreContext';
import { useResponsive } from '../utils/useResponsive';
import { resolveAnyTable } from '../utils/tableData';
import {
  PAYMENT_METHOD_LIST,
  PAYMENT_METHODS,
  PAYMENT_METHOD_UNSPECIFIED,
  paymentMethodLabel,
  splitVatIncluded,
  summarizeByPaymentMethod,
  summarizeDaily,
  summarizeMonthly,
  historyToCsv,
} from '../utils/payment';
import { downloadCsv } from '../utils/csvDownload';
import { printReceipt, isPrinterAvailable } from '../utils/printReceipt';

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
  const { scale } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);
  const { revenue } = useOrders();
  const { optionsList: OPTIONS_CATALOG } = useMenu();
  const { storeInfo } = useStore();
  const history = revenue?.history || [];

  // 부가세 분리 표시 토글 — ON 시 카드/이력에 공급가액/부가세 분리. OFF 시 합계만.
  const [showVat, setShowVat] = useState(false);
  // Electron(PC 카운터 .exe) 환경에서만 영수증 출력 가능. 일반 브라우저는 버튼 숨김.
  const printerAvailable = isPrinterAvailable();
  const [printingId, setPrintingId] = useState(null);

  // history row 의 "🖨️ 재출력" 버튼 핸들러.
  // 1.0.31: 옵션 라벨 resolve + tableLabel + 매장 정보 추가
  const handleReprint = async (entry) => {
    if (!printerAvailable || printingId) return;
    setPrintingId(entry.id);
    try {
      const itemsWithLabels = (entry.items || []).map((it) => ({
        ...it,
        optionLabels: (it.options || [])
          .map((oid) => OPTIONS_CATALOG.find((opt) => opt.id === oid)?.label)
          .filter(Boolean),
      }));
      const tbl = resolveAnyTable(entry.tableId);
      const result = await printReceipt({
        storeName: storeInfo?.name || 'MyPos',
        storePhone: storeInfo?.phone || '',
        storeAddress: storeInfo?.address || '',
        businessNumber: storeInfo?.businessNumber || '',
        receiptFooter: storeInfo?.receiptFooter || '',
        tableId: entry.tableId,
        tableLabel: tbl?.label || entry.tableId,
        items: itemsWithLabels,
        total: entry.total,
        paymentMethod: entry.paymentMethod,
        paymentStatus: entry.paymentStatus,
        deliveryAddress: entry.deliveryAddress,
        printedAt: Date.now(),
      });
      if (!result.ok && typeof window !== 'undefined') {
        // 브라우저 alert — 매장에서 빠르게 식별
        // eslint-disable-next-line no-alert
        window?.alert?.(`출력 실패: ${result.error || result.message || '알 수 없는 오류'}`);
      }
    } finally {
      setPrintingId(null);
    }
  };

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

  // 되돌린(reverted) entry 는 매출 합계/카운트에서 제외 — 실수 보정.
  // history 목록에는 그대로 두고 "되돌림" 라벨로 표시.
  const isCounted = (h) => !h.reverted;
  const todayOrders = history.filter((h) => h.clearedAt >= todayStart && isCounted(h));
  const thisMonthOrders = history.filter((h) => h.clearedAt >= monthStart && isCounted(h));
  const todayTotal = todayOrders.reduce((s, h) => s + h.total, 0);
  const monthTotal = thisMonthOrders.reduce((s, h) => s + h.total, 0);

  // 결제수단별 합계 + 일계 — 오늘 기준
  const todayByPayment = useMemo(() => summarizeByPaymentMethod(todayOrders), [todayOrders]);
  const todayDaily = useMemo(() => summarizeDaily(todayOrders), [todayOrders]);
  const todayVat = useMemo(() => splitVatIncluded(todayTotal), [todayTotal]);
  const monthVat = useMemo(() => splitVatIncluded(monthTotal), [monthTotal]);
  // 월계 — 이번 달 메뉴/요일/영업일 분석
  const monthlyReport = useMemo(() => summarizeMonthly(thisMonthOrders), [thisMonthOrders]);
  const monthAvgPerDay = monthlyReport.totalDays > 0
    ? Math.round(monthTotal / monthlyReport.totalDays)
    : 0;

  // CSV 익스포트 — 다운로드 시 파일명에 날짜 포함.
  const exportCsv = (filterFn, suffix) => {
    const filtered = filterFn ? history.filter(filterFn) : history;
    if (filtered.length === 0) return;
    const csv = historyToCsv(filtered);
    const today = new Date();
    const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    downloadCsv(csv, `mypos-${suffix}-${dateStr}.csv`);
  };

  const byMonth = {};
  history.forEach((h) => {
    if (!isCounted(h)) return;
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
          {showVat && todayTotal > 0 ? (
            <Text style={styles.summaryVat}>
              공급가액 {todayVat.supply.toLocaleString()}원 · 부가세 {todayVat.vat.toLocaleString()}원
            </Text>
          ) : null}
          <Text style={styles.summarySub}>
            {todayOrders.length}건 · {now.getMonth() + 1}/{now.getDate()}
          </Text>
        </View>
        <View style={[styles.summaryCard, styles.cardMonth]}>
          <Text style={styles.summaryLabel}>이번 달 누적</Text>
          <Text style={styles.summaryValue}>
            {monthTotal.toLocaleString()}원
          </Text>
          {showVat && monthTotal > 0 ? (
            <Text style={styles.summaryVat}>
              공급가액 {monthVat.supply.toLocaleString()}원 · 부가세 {monthVat.vat.toLocaleString()}원
            </Text>
          ) : null}
          <Text style={styles.summarySub}>
            {thisMonthOrders.length}건 · 매월 1일 자동 리셋
          </Text>
        </View>
      </View>

      {/* 부가세 표시 토글 + CSV 익스포트 버튼 — 회계 / 분기 신고 대비 */}
      <View style={styles.toolBar}>
        <TouchableOpacity
          style={[styles.toolBtn, showVat && styles.toolBtnActive]}
          onPress={() => setShowVat((v) => !v)}
          activeOpacity={0.7}
        >
          <Text style={[styles.toolBtnText, showVat && styles.toolBtnTextActive]}>
            {showVat ? '✓ 부가세 분리 표시 (10%)' : '부가세 분리 표시 (10%)'}
          </Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <Text style={styles.csvLabel}>CSV 익스포트:</Text>
        <TouchableOpacity
          style={styles.csvBtn}
          onPress={() => exportCsv((h) => h.clearedAt >= todayStart, 'today')}
        >
          <Text style={styles.csvBtnText}>오늘</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.csvBtn}
          onPress={() => exportCsv((h) => h.clearedAt >= monthStart, 'month')}
        >
          <Text style={styles.csvBtnText}>이번 달</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.csvBtn}
          onPress={() => exportCsv(null, 'all')}
        >
          <Text style={styles.csvBtnText}>전체</Text>
        </TouchableOpacity>
      </View>

      {/* 오늘 결제수단별 합계 — 일계 정산 즉시 보임 */}
      <Text style={styles.sectionTitle}>💳 오늘 결제수단별</Text>
      <View style={styles.payMethodRow}>
        {[...PAYMENT_METHOD_LIST, PAYMENT_METHOD_UNSPECIFIED].map((code) => {
          const bucket = todayByPayment[code] || { count: 0, total: 0 };
          const isUnspec = code === PAYMENT_METHOD_UNSPECIFIED;
          return (
            <View
              key={code}
              style={[styles.payMethodCard, isUnspec && styles.payMethodCardMuted]}
            >
              <Text style={styles.payMethodLabel}>
                {isUnspec ? '미분류' : PAYMENT_METHODS[code]}
              </Text>
              <Text style={styles.payMethodValue}>
                {bucket.total.toLocaleString()}원
              </Text>
              <Text style={styles.payMethodCount}>{bucket.count}건</Text>
            </View>
          );
        })}
      </View>

      {/* 일계 보고서 — 메뉴 TOP / 시간대 TOP */}
      {todayOrders.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>📊 오늘 일계 보고서</Text>
          <View style={styles.dailyRow}>
            <View style={styles.dailyBox}>
              <Text style={styles.dailyBoxTitle}>메뉴 TOP 5 (매출)</Text>
              {todayDaily.byMenu.slice(0, 5).map((m) => (
                <View key={m.name} style={styles.dailyItem}>
                  <Text style={styles.dailyItemName} numberOfLines={1}>
                    {m.name}
                  </Text>
                  <Text style={styles.dailyItemQty}>{m.qty}개</Text>
                  <Text style={styles.dailyItemTotal}>
                    {m.total.toLocaleString()}원
                  </Text>
                </View>
              ))}
              {todayDaily.byMenu.length === 0 ? (
                <Text style={styles.emptyHint}>오늘 판매 내역 없음</Text>
              ) : null}
            </View>
            <View style={styles.dailyBox}>
              <Text style={styles.dailyBoxTitle}>시간대 TOP 5 (매출)</Text>
              {todayDaily.byHour
                .filter((h) => h.count > 0)
                .sort((a, b) => b.total - a.total)
                .slice(0, 5)
                .map((h) => (
                  <View key={h.hour} style={styles.dailyItem}>
                    <Text style={styles.dailyItemName}>{h.hour}시</Text>
                    <Text style={styles.dailyItemQty}>{h.count}건</Text>
                    <Text style={styles.dailyItemTotal}>
                      {h.total.toLocaleString()}원
                    </Text>
                  </View>
                ))}
              {todayDaily.byHour.every((h) => h.count === 0) ? (
                <Text style={styles.emptyHint}>오늘 판매 내역 없음</Text>
              ) : null}
            </View>
          </View>
        </>
      ) : null}

      {/* 이번 달 보고서 — 일계와 동일 패턴, 요일별 + 영업일 통계 추가 */}
      {thisMonthOrders.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>
            📈 이번 달 보고서 ({monthlyReport.totalDays}일 영업 · 일평균{' '}
            {monthAvgPerDay.toLocaleString()}원)
          </Text>
          <View style={styles.dailyRow}>
            <View style={styles.dailyBox}>
              <Text style={styles.dailyBoxTitle}>이번 달 메뉴 TOP 5 (매출)</Text>
              {monthlyReport.byMenu.slice(0, 5).map((m) => (
                <View key={m.name} style={styles.dailyItem}>
                  <Text style={styles.dailyItemName} numberOfLines={1}>
                    {m.name}
                  </Text>
                  <Text style={styles.dailyItemQty}>{m.qty}개</Text>
                  <Text style={styles.dailyItemTotal}>
                    {m.total.toLocaleString()}원
                  </Text>
                </View>
              ))}
            </View>
            <View style={styles.dailyBox}>
              <Text style={styles.dailyBoxTitle}>요일별 매출</Text>
              {monthlyReport.byDayOfWeek.map((d) => (
                <View key={d.day} style={styles.dailyItem}>
                  <Text style={styles.dailyItemName}>{d.label}요일</Text>
                  <Text style={styles.dailyItemQty}>{d.count}건</Text>
                  <Text style={styles.dailyItemTotal}>
                    {d.total.toLocaleString()}원
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </>
      ) : null}

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
            <View
              key={h.id}
              style={[styles.historyRow, h.reverted && styles.historyRowReverted]}
            >
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
                <Text style={styles.historyMethod}>
                  {paymentMethodLabel(h.paymentMethod)}
                </Text>
                {h.reverted && (
                  <Text style={styles.historyRevertedTag}>↶ 되돌림</Text>
                )}
              </View>
              <View style={styles.historyItems}>
                {h.items.map((i) => (
                  <Text
                    key={i.id}
                    style={[styles.historyItem, h.reverted && styles.historyItemReverted]}
                  >
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
              <View style={styles.historyTotalRow}>
                {showVat && h.total > 0 && !h.reverted ? (
                  <Text style={styles.historyVat}>
                    공급 {splitVatIncluded(h.total).supply.toLocaleString()} ·
                    VAT {splitVatIncluded(h.total).vat.toLocaleString()}
                  </Text>
                ) : null}
                {printerAvailable ? (
                  <TouchableOpacity
                    style={[
                      styles.historyPrintBtn,
                      printingId === h.id && styles.historyPrintBtnBusy,
                    ]}
                    disabled={printingId === h.id}
                    onPress={() => handleReprint(h)}
                  >
                    <Text style={styles.historyPrintBtnText}>
                      {printingId === h.id ? '출력 중…' : '🖨️ 출력'}
                    </Text>
                  </TouchableOpacity>
                ) : null}
                <Text
                  style={[
                    styles.historyTotal,
                    h.reverted && styles.historyTotalReverted,
                  ]}
                >
                  {h.total.toLocaleString()}원
                </Text>
              </View>
            </View>
          ))
      )}
    </ScrollView>
  );
}

// scale: useResponsive() 의 폰트 배율(lg=1.3, 그 외 1.0). RevenueScreen 에서 useMemo 로 호출.
function makeStyles(scale = 1) {
  const fp = (n) => Math.round(n * scale);
  return StyleSheet.create({
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
  summaryLabel: { fontSize: fp(12), color: 'rgba(255,255,255,0.8)', fontWeight: '600' },
  summaryValue: {
    fontSize: fp(26),
    color: '#fff',
    fontWeight: '800',
    marginTop: 4,
  },
  summarySub: { fontSize: fp(11), color: 'rgba(255,255,255,0.7)' },
  summaryVat: {
    fontSize: fp(11),
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '600',
    marginTop: 2,
  },

  toolBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6,
    flexWrap: 'wrap',
  },
  toolBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
  },
  toolBtnActive: { backgroundColor: '#1F2937', borderColor: '#1F2937' },
  toolBtnText: { fontSize: fp(11), color: '#374151', fontWeight: '600' },
  toolBtnTextActive: { color: '#fff' },
  csvLabel: { fontSize: fp(11), color: '#6b7280', fontWeight: '600' },
  csvBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#10b981',
  },
  csvBtnText: { fontSize: fp(11), color: '#fff', fontWeight: '700' },

  payMethodRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  payMethodCard: {
    flex: 1,
    minWidth: 100,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    gap: 2,
  },
  payMethodCardMuted: { backgroundColor: '#f3f4f6', opacity: 0.85 },
  payMethodLabel: { fontSize: fp(11), color: '#6b7280', fontWeight: '700' },
  payMethodValue: { fontSize: fp(15), color: '#111827', fontWeight: '800' },
  payMethodCount: { fontSize: fp(10), color: '#9ca3af' },

  dailyRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 12,
    flexWrap: 'wrap',
  },
  dailyBox: {
    flex: 1,
    minWidth: 240,
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  dailyBoxTitle: {
    fontSize: fp(13),
    fontWeight: '800',
    color: '#111827',
    marginBottom: 8,
  },
  dailyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    gap: 6,
  },
  dailyItemName: { flex: 1, fontSize: fp(12), color: '#374151' },
  dailyItemQty: { fontSize: fp(11), color: '#6b7280', minWidth: 36, textAlign: 'right' },
  dailyItemTotal: {
    fontSize: fp(12),
    color: '#111827',
    fontWeight: '700',
    minWidth: 80,
    textAlign: 'right',
  },

  sectionTitle: {
    fontSize: fp(15),
    fontWeight: '800',
    color: '#111827',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 6,
  },

  empty: { alignItems: 'center', padding: 40, gap: 8 },
  emptyText: { fontSize: fp(14), color: '#6b7280', fontWeight: '600' },
  emptyHint: { fontSize: fp(12), color: '#9ca3af', textAlign: 'center' },

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
  monthLabel: { fontSize: fp(15), color: '#111827', fontWeight: '700' },
  monthLabelCurrent: { color: '#5b21b6' },
  monthTag: {
    fontSize: fp(11),
    color: '#fff',
    fontWeight: '800',
    backgroundColor: '#7c3aed',
  },
  monthCount: { fontSize: fp(11), color: '#6b7280', marginTop: 2 },
  monthTotal: { fontSize: fp(17), color: '#111827', fontWeight: '800' },
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
    fontSize: fp(13),
    fontWeight: '800',
    color: '#111827',
    backgroundColor: '#eef2ff',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  historyTime: { fontSize: fp(11), color: '#6b7280', flex: 1 },
  historyPay: {
    fontSize: fp(10),
    fontWeight: '700',
    color: '#374151',
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  historyPayPaid: { color: '#fff', backgroundColor: '#2563eb' },
  historyMethod: {
    fontSize: fp(10),
    fontWeight: '700',
    color: '#1F2937',
    backgroundColor: '#e5e7eb',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  historyItems: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  historyItem: { fontSize: fp(11), color: '#374151' },
  historyAddr: { fontSize: fp(10), color: '#dc2626', fontWeight: '600' },
  historyTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  historyVat: { fontSize: fp(10), color: '#6b7280' },
  historyPrintBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#1F2937',
    borderRadius: 4,
  },
  historyPrintBtnBusy: { opacity: 0.5 },
  historyPrintBtnText: { color: '#fff', fontSize: fp(11), fontWeight: '700' },
  historyTotal: {
    fontSize: fp(14),
    fontWeight: '800',
    color: '#111827',
  },
  // 되돌린 entry — 회색 배경 + 취소선으로 한 눈에 식별
  historyRowReverted: {
    backgroundColor: '#f9fafb',
    borderColor: '#d1d5db',
    opacity: 0.75,
  },
  historyRevertedTag: {
    fontSize: fp(10),
    fontWeight: '800',
    color: '#fff',
    backgroundColor: '#dc2626',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  historyItemReverted: {
    color: '#9ca3af',
    textDecorationLine: 'line-through',
  },
  historyTotalReverted: {
    color: '#9ca3af',
    textDecorationLine: 'line-through',
  },
  });
}
