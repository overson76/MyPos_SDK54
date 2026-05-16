// 배달 회수 — 그릇 회수 차수별 관리 화면.
//
// 의도:
//   - 배달 완료 후 그릇 회수가 잊혀지기 쉬움 → 출력물 들고 회수
//   - 회수 후 또 배달이 발생할 수 있음 → 차수(round) 디렉토리로 누적
//   - 멀리부터 가는 게 라이더 동선 효율 (먼 곳 → 가까운 곳 순회)
//
// 화면 구조:
//   1) 차수 목록 (진행중 + 마감된 차수들, 최신순)
//   2) 각 차수 row: 헤더 클릭 시 expand → 상세
//   3) 헤더 옆 인라인 액션 [📍 근거리] [🛵 원거리] [🖨️ 출력] [🗺️ 지도]
//      — expand 안 해도 모두 작동
//
// 데이터 흐름:
//   - 진행중 차수 = 마지막 차수 createdAt 이후 결제완료 배달 (실시간 계산)
//   - 출력 누르면 → useDeliveryRounds.finalizeRound() = Firestore 영구 저장
//   - 마감 차수 = Firestore stores/{storeId}/returnRounds
//
// 거리:
//   - addressBook entry.drivingM (카카오 모빌리티 도로 실거리) 우선
//   - 캐시 없으면 lazy fetch (백그라운드) — 다음 렌더에 자동 실거리 갱신
//   - fallback = 직선거리 + UI 에 "*" 표시

import { useEffect, useMemo, useRef, useState } from 'react';
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
import {
  computeDeliveryReturns,
  resortRanked,
  getLastRoundCreatedAt,
  getNextRoundNo,
} from '../utils/deliveryReturns';
import { buildDeliveryReturnText } from '../utils/escposBuilder';
import { printReceipt, isPrinterAvailable } from '../utils/printReceipt';
import { useDeliveryRounds, getRoundReturnProgress } from '../utils/useDeliveryRounds';
import { getDrivingDistance, isNaviAvailable } from '../utils/geocode';
import { localDateString } from '../utils/orderHelpers';
import DeliveryMapModal from '../components/DeliveryMapModal';
import { reportError } from '../utils/sentry';

export default function DeliveryReturnScreen() {
  const { scale } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);
  const { revenue, addressBook, setAddressBook, getReadyDeliveries } = useOrders();
  const { storeInfo } = useStore();
  const {
    rounds,
    finalizeRound,
    markEntryReturned,
    markRoundAllReturned,
    clearRoundReturned,
  } = useDeliveryRounds();

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

  const [sortByRound, setSortByRound] = useState({});
  const [expanded, setExpanded] = useState({});
  const [mapInfo, setMapInfo] = useState(null);

  const setSort = (rid, mode) =>
    setSortByRound((p) => ({ ...p, [rid]: mode }));
  const getSort = (rid, fallback = 'far') => sortByRound[rid] || fallback;
  const toggleExpand = (rid) => setExpanded((p) => ({ ...p, [rid]: !p[rid] }));

  // 카카오 모빌리티 도로 실거리 lazy fetch — entry.drivingM 캐시 채움.
  // 매장 좌표 일치 시만 캐시 유효. 매장 좌표 바뀌면 재계산.
  // AddressBookPanel 의 패턴 동일 — entry 한 번 fetch → 영구 캐시 (Firestore 동기화).
  const inFlightRef = useRef(new Set());
  const failedRef = useRef(new Set());
  useEffect(() => {
    if (!storeCoord || !isNaviAvailable()) return;
    const fromLat = storeCoord.lat;
    const fromLng = storeCoord.lng;
    for (const entry of Object.values(addressBook?.entries || {})) {
      if (typeof entry.lat !== 'number' || typeof entry.lng !== 'number') continue;
      if (
        typeof entry.drivingM === 'number' &&
        entry.drivingFromLat === fromLat &&
        entry.drivingFromLng === fromLng
      )
        continue;
      if (inFlightRef.current.has(entry.key)) continue;
      if (failedRef.current.has(entry.key)) continue;
      inFlightRef.current.add(entry.key);
      getDrivingDistance(
        { lat: fromLat, lng: fromLng },
        { lat: entry.lat, lng: entry.lng }
      )
        .then((result) => {
          inFlightRef.current.delete(entry.key);
          if (!result) {
            failedRef.current.add(entry.key);
            return;
          }
          if (typeof setAddressBook !== 'function') return;
          setAddressBook((prev) => {
            const ex = prev.entries[entry.key];
            if (!ex) return prev;
            return {
              ...prev,
              entries: {
                ...prev.entries,
                [entry.key]: {
                  ...ex,
                  drivingM: result.distanceM,
                  drivingDurationSec: result.durationSec,
                  drivingFromLat: fromLat,
                  drivingFromLng: fromLng,
                },
              },
            };
          });
        })
        .catch((e) => {
          inFlightRef.current.delete(entry.key);
          try {
            reportError(e, { ctx: 'returns.driving' });
          } catch (_) {}
        });
    }
  }, [addressBook?.entries, storeCoord, setAddressBook]);

  useEffect(() => {
    inFlightRef.current.clear();
    failedRef.current.clear();
  }, [storeCoord?.lat, storeCoord?.lng]);

  const today = localDateString();
  const lastCreatedAt = useMemo(
    () => getLastRoundCreatedAt(rounds, today),
    [rounds, today]
  );

  // 회수 후보 = 결제완료(history) + 조리완료(아직 paid 안 된 ready 배달).
  // 사장님 의도: 후불 배달처럼 결제가 늦어도 조리완료 시점부터 회수 차수에 진입.
  const readyDeliveries = useMemo(
    () => (typeof getReadyDeliveries === 'function' ? getReadyDeliveries() : []),
    // orders 객체는 OrderContext 안에 들어있고 매 렌더마다 다시 함수 호출 — 안전하게
    // revenue 변화(결제 시점) + rounds 변화(차수 마감 시점) 시 재평가.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revenue, rounds]
  );
  const combinedHistory = useMemo(
    () => [...readyDeliveries, ...(revenue?.history || [])],
    [readyDeliveries, revenue?.history]
  );

  // 진행중 차수 — 마지막 차수 이후 결제완료/조리완료 배달.
  const pending = useMemo(
    () =>
      computeDeliveryReturns({
        history: combinedHistory,
        addressBook,
        storeCoord,
        sortMode: 'far',
        sinceMs: lastCreatedAt,
      }),
    [combinedHistory, addressBook, storeCoord, lastCreatedAt]
  );

  // 화면 표시용 — 차수별 sortMode 적용 (snapshot/계산 결과 자체는 보존).
  const pendingDisplay = useMemo(() => {
    const mode = getSort('pending', 'far');
    const sorted = resortRanked(pending.ranked, mode);
    return { ranked: sorted, unknown: pending.unknown, sortMode: mode };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, sortByRound.pending]);

  const pendingTotal = pending.ranked.length + pending.unknown.length;
  const hasPending = pendingTotal > 0;
  const pendingRoundNo = getNextRoundNo(rounds, today);

  // 마감 차수들 — 최신순.
  const finalizedRounds = useMemo(
    () =>
      Object.values(rounds || {})
        .filter((r) => r && r.createdAt && r.snapshot)
        .sort((a, b) => b.createdAt - a.createdAt),
    [rounds]
  );

  const getRoundDisplay = (round) => {
    const mode = getSort(round.id, round.sortMode || 'far');
    const sorted = resortRanked(round.snapshot.ranked, mode);
    return {
      ranked: sorted,
      unknown: round.snapshot.unknown || [],
      sortMode: mode,
    };
  };

  const printerOk = isPrinterAvailable();

  const previewAlert = (text) => {
    const msg =
      'PC 영수증 프린터에서만 직접 출력됩니다.\n매장 PC 에서 출력하세요.\n\n' +
      text;
    if (
      Platform.OS === 'web' &&
      typeof window !== 'undefined' &&
      window.alert
    ) {
      window.alert(msg);
    } else {
      Alert.alert('회수 목록 미리보기', msg, [{ text: '확인' }]);
    }
  };

  const handlePrintPending = () => {
    if (!hasPending) return;
    const mode = pendingDisplay.sortMode;
    const snapshot = {
      ranked: pendingDisplay.ranked,
      unknown: pendingDisplay.unknown,
    };
    const text = buildDeliveryReturnText(
      { ...snapshot, sortMode: mode },
      { printedAt: Date.now() }
    );
    // 마감 + 영구 저장 — 다음 결제 배달은 다음 차수에 누적.
    finalizeRound(snapshot, mode, today);
    if (printerOk) {
      printReceipt({ rawText: text }).catch((e) =>
        Alert.alert('출력 실패', String(e?.message || e))
      );
    } else {
      previewAlert(text);
    }
  };

  const handlePrintRound = (round) => {
    const display = getRoundDisplay(round);
    const text = buildDeliveryReturnText(
      { ranked: display.ranked, unknown: display.unknown, sortMode: display.sortMode },
      { printedAt: Date.now() }
    );
    if (printerOk) {
      printReceipt({ rawText: text }).catch((e) =>
        Alert.alert('출력 실패', String(e?.message || e))
      );
    } else {
      previewAlert(text);
    }
  };

  const openMap = (ranked, unknown) => {
    if (!storeCoord) {
      Alert.alert(
        '매장 좌표 미설정',
        '관리자 → 시스템 → 매장 주소 에서 매장 좌표를 먼저 설정하세요.'
      );
      return;
    }
    const deliveries = (ranked || [])
      .filter((it) => it.coord)
      .map((it) => ({
        coord: it.coord,
        addr: it.address,
        label: it.label,
        distanceLabel:
          typeof it.distanceM === 'number' ? formatDist(it.distanceM) : null,
      }));
    if (deliveries.length === 0) {
      Alert.alert(
        '지도 표시 불가',
        '좌표 있는 회수지가 없습니다 (모두 주소불명).'
      );
      return;
    }
    setMapInfo({ storeCoord, deliveries });
  };

  // roundId 가 null 이면 진행중 차수(pending) — 체크박스 없음 (마감 전이라 의미 X).
  const renderRoundDetail = (ranked, unknown, sortMode, roundId) => {
    const canCheck = !!roundId;
    const onToggle = (entryKey) => {
      if (!canCheck) return;
      markEntryReturned(roundId, entryKey);
    };
    return (
      <View style={styles.detail}>
        {unknown.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, styles.sectionTitleUnknown]}>
              ⚠️ 주소불명 ({unknown.length}건)
            </Text>
            {unknown.map((u) => {
              const done = !!u.returnedAt;
              return (
                <View
                  key={u.key}
                  style={[
                    styles.row,
                    styles.rowUnknown,
                    done && styles.rowDone,
                  ]}
                >
                  {canCheck && (
                    <TouchableOpacity
                      onPress={() => onToggle(u.key)}
                      style={styles.checkBox}
                      accessibilityLabel={done ? '회수 해제' : '회수 완료'}
                    >
                      <Text style={styles.checkBoxText}>{done ? '✓' : ''}</Text>
                    </TouchableOpacity>
                  )}
                  <Text style={[styles.rank, done && styles.textDone]}>0</Text>
                  <View style={styles.rowMain}>
                    <Text
                      style={[styles.rowLabel, done && styles.textDone]}
                      numberOfLines={1}
                    >
                      {u.label}
                    </Text>
                    <Text
                      style={[styles.rowMenu, done && styles.textDone]}
                      numberOfLines={2}
                    >
                      {u.menuSummary
                        .map((m) => `${m.name} ${m.qty}`)
                        .join(', ')}
                    </Text>
                    {u.totalDishes > 1 && (
                      <Text style={[styles.rowTotal, done && styles.textDone]}>
                        총 {u.totalDishes} 그릇
                      </Text>
                    )}
                    {done && (
                      <Text style={styles.returnedTag}>
                        ✓ 회수 {formatTime(u.returnedAt)}
                      </Text>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}
        {ranked.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {sortMode === 'near' ? '📍 근거리 순' : '🛵 원거리 순'} (
              {ranked.length}건)
            </Text>
            {ranked.map((it) => {
              const done = !!it.returnedAt;
              return (
                <View
                  key={it.key}
                  style={[styles.row, done && styles.rowDone]}
                >
                  {canCheck && (
                    <TouchableOpacity
                      onPress={() => onToggle(it.key)}
                      style={styles.checkBox}
                      accessibilityLabel={done ? '회수 해제' : '회수 완료'}
                    >
                      <Text style={styles.checkBoxText}>{done ? '✓' : ''}</Text>
                    </TouchableOpacity>
                  )}
                  <Text style={[styles.rank, done && styles.textDone]}>
                    {it.rank}
                  </Text>
                  <View style={styles.rowMain}>
                    <View style={styles.rowTitleLine}>
                      <Text
                        style={[styles.rowLabel, done && styles.textDone]}
                        numberOfLines={1}
                      >
                        {it.label}
                      </Text>
                      {typeof it.distanceM === 'number' && (
                        <Text style={[styles.rowDist, done && styles.textDone]}>
                          {formatDist(it.distanceM)}
                          {it.isDrivingDistance ? '' : '*'}
                        </Text>
                      )}
                    </View>
                    <Text
                      style={[styles.rowMenu, done && styles.textDone]}
                      numberOfLines={2}
                    >
                      {it.menuSummary
                        .map((m) => `${m.name} ${m.qty}`)
                        .join(', ')}
                    </Text>
                    <Text style={[styles.rowTotal, done && styles.textDone]}>
                      총 {it.totalDishes} 그릇
                    </Text>
                    {done && (
                      <Text style={styles.returnedTag}>
                        ✓ 회수 {formatTime(it.returnedAt)}
                      </Text>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}
        {ranked.some((it) => !it.isDrivingDistance) && (
          <Text style={styles.fineNote}>
            * 표시: 직선거리(임시) — 카카오 도로 실거리 계산 후 자동 갱신
          </Text>
        )}
      </View>
    );
  };

  const renderRoundCard = ({
    id,
    roundId,
    title,
    subtitle,
    totalCount,
    sortMode,
    ranked,
    unknown,
    onSort,
    onPrint,
    onMap,
    isPending,
    progress,
    onMarkAll,
    onClearAll,
  }) => {
    const expand = !!expanded[id];
    const showProgress = !isPending && progress && progress.total > 0;
    return (
      <View
        key={id}
        style={[
          styles.roundCard,
          isPending && styles.roundCardPending,
          showProgress && progress.complete && styles.roundCardComplete,
        ]}
      >
        <View style={styles.roundHeader}>
          <TouchableOpacity
            style={styles.roundHeaderMain}
            activeOpacity={0.7}
            onPress={() => toggleExpand(id)}
          >
            <View style={styles.roundTitleLine}>
              <Text
                style={[
                  styles.roundTitle,
                  isPending && styles.roundTitlePending,
                  showProgress && progress.complete && styles.roundTitleComplete,
                ]}
              >
                {isPending ? '🟢' : showProgress && progress.complete ? '✅' : '✓'}{' '}
                {title}
              </Text>
              <Text style={styles.expandIcon}>{expand ? '▾' : '▸'}</Text>
            </View>
            <Text style={styles.roundSubtitle}>
              {subtitle}
              {showProgress &&
                ` · 회수 ${progress.done}/${progress.total}${
                  progress.complete ? ' ✅' : ''
                }`}
            </Text>
          </TouchableOpacity>
          <View style={styles.roundActions}>
            <TouchableOpacity
              style={[styles.sortBtn, sortMode === 'near' && styles.sortBtnActive]}
              onPress={() => onSort('near')}
              accessibilityLabel="근거리 순 정렬"
            >
              <Text
                style={[
                  styles.sortBtnText,
                  sortMode === 'near' && styles.sortBtnTextActive,
                ]}
              >
                📍
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sortBtn, sortMode === 'far' && styles.sortBtnActive]}
              onPress={() => onSort('far')}
              accessibilityLabel="원거리 순 정렬"
            >
              <Text
                style={[
                  styles.sortBtnText,
                  sortMode === 'far' && styles.sortBtnTextActive,
                ]}
              >
                🛵
              </Text>
            </TouchableOpacity>
            {!isPending && showProgress && !progress.complete && (
              <TouchableOpacity
                style={styles.actionBtnSecondary}
                onPress={onMarkAll}
                accessibilityLabel="모두 회수 처리"
              >
                <Text style={styles.actionBtnSecondaryText}>✓모두</Text>
              </TouchableOpacity>
            )}
            {!isPending && showProgress && progress.done > 0 && (
              <TouchableOpacity
                style={styles.actionBtnGhost}
                onPress={onClearAll}
                accessibilityLabel="회수 상태 해제"
              >
                <Text style={styles.actionBtnGhostText}>↩</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[
                styles.actionBtn,
                totalCount === 0 && styles.actionBtnDisabled,
              ]}
              onPress={onPrint}
              disabled={totalCount === 0}
              accessibilityLabel={isPending ? '출력 + 차수 마감' : '재출력'}
            >
              <Text style={styles.actionBtnText}>🖨️</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.actionBtn,
                totalCount === 0 && styles.actionBtnDisabled,
              ]}
              onPress={onMap}
              disabled={totalCount === 0}
              accessibilityLabel="지도 보기"
            >
              <Text style={styles.actionBtnText}>🗺️</Text>
            </TouchableOpacity>
          </View>
        </View>
        {expand && renderRoundDetail(ranked, unknown, sortMode, roundId)}
      </View>
    );
  };

  const totalRoundsCount = (hasPending ? 1 : 0) + finalizedRounds.length;

  return (
    <View style={styles.container}>
      <View style={styles.headerBar}>
        <Text style={styles.title}>🍱 배달 회수 차수 목록</Text>
        <Text style={styles.subtitle}>
          {totalRoundsCount === 0
            ? '회수 차수가 없습니다 — 결제완료 배달이 발생하면 진행중 차수가 자동 표시'
            : `${totalRoundsCount}건 · 🖨️ 출력 시 마감되어 다음 배달은 다음 차수에 누적`}
        </Text>
        {!storeCoord && (
          <Text style={styles.warn}>
            ⚠ 매장 좌표 미설정 — 거리 정렬 OFF (모두 주소불명 처리)
          </Text>
        )}
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {hasPending &&
          renderRoundCard({
            id: 'pending',
            roundId: null,
            title: `${today} · ${pendingRoundNo}차 (진행 중)`,
            subtitle: `${pendingTotal}건 — 🖨️ 누르면 마감, 다음 배달은 다음 차수로`,
            totalCount: pendingTotal,
            sortMode: pendingDisplay.sortMode,
            ranked: pendingDisplay.ranked,
            unknown: pendingDisplay.unknown,
            onSort: (m) => setSort('pending', m),
            onPrint: handlePrintPending,
            onMap: () => openMap(pendingDisplay.ranked, pendingDisplay.unknown),
            isPending: true,
            progress: null,
            onMarkAll: null,
            onClearAll: null,
          })}

        {finalizedRounds.map((round) => {
          const display = getRoundDisplay(round);
          const total = display.ranked.length + display.unknown.length;
          const progress = getRoundReturnProgress(round);
          return renderRoundCard({
            id: round.id,
            roundId: round.id,
            title: `${round.date} · ${round.roundNo}차`,
            subtitle: `${total}건 · ${formatTime(round.createdAt)} 출력`,
            totalCount: total,
            sortMode: display.sortMode,
            ranked: display.ranked,
            unknown: display.unknown,
            onSort: (m) => setSort(round.id, m),
            onPrint: () => handlePrintRound(round),
            onMap: () => openMap(display.ranked, display.unknown),
            isPending: false,
            progress,
            onMarkAll: () => markRoundAllReturned(round.id),
            onClearAll: () => clearRoundReturned(round.id),
          });
        })}

        {totalRoundsCount === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>차수 없음</Text>
            <Text style={styles.emptyHint}>
              결제완료된 배달이 발생하면 진행중 차수가 자동 생성됩니다
            </Text>
          </View>
        )}
      </ScrollView>

      <DeliveryMapModal
        visible={!!mapInfo}
        onClose={() => setMapInfo(null)}
        storeCoord={mapInfo?.storeCoord}
        deliveries={mapInfo?.deliveries || []}
        mode="sequential"
      />
    </View>
  );
}

function formatDist(m) {
  const v = Number(m) || 0;
  if (v < 1000) return `${v}m`;
  const km = v / 1000;
  return km < 10 ? `${km.toFixed(1)}km` : `${Math.round(km)}km`;
}

function formatTime(ts) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function makeStyles(scale = 1) {
  const fp = (n) => Math.round(n * scale);
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff' },
    headerBar: {
      paddingHorizontal: 14,
      paddingVertical: 12,
      backgroundColor: '#f9fafb',
      borderBottomWidth: 1,
      borderBottomColor: '#e5e7eb',
    },
    title: { fontSize: fp(16), fontWeight: '900', color: '#111827' },
    subtitle: { fontSize: fp(12), color: '#6b7280', marginTop: 4 },
    warn: { fontSize: fp(12), color: '#dc2626', fontWeight: '700', marginTop: 4 },

    list: { flex: 1 },
    listContent: { padding: 10, gap: 8 },

    empty: { padding: 40, alignItems: 'center', gap: 6 },
    emptyText: { fontSize: fp(14), color: '#6b7280', fontWeight: '700' },
    emptyHint: { fontSize: fp(11), color: '#9ca3af', textAlign: 'center' },

    roundCard: {
      backgroundColor: '#fff',
      borderWidth: 1,
      borderColor: '#e5e7eb',
      borderRadius: 10,
      marginBottom: 8,
      overflow: 'hidden',
    },
    roundCardPending: {
      borderColor: '#16a34a',
      borderWidth: 2,
      backgroundColor: '#f0fdf4',
    },
    roundCardComplete: {
      borderColor: '#9ca3af',
      backgroundColor: '#f9fafb',
    },
    roundTitleComplete: { color: '#6b7280' },
    roundHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 8,
    },
    roundHeaderMain: { flex: 1, minWidth: 0 },
    roundTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    roundTitle: {
      fontSize: fp(14),
      fontWeight: '800',
      color: '#111827',
      flexShrink: 1,
    },
    roundTitlePending: { color: '#15803d' },
    roundSubtitle: { fontSize: fp(11), color: '#6b7280', marginTop: 2 },
    expandIcon: { fontSize: fp(14), color: '#6b7280', fontWeight: '900' },

    roundActions: { flexDirection: 'row', gap: 4 },
    sortBtn: {
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: 6,
      backgroundColor: '#fff',
      borderWidth: 1,
      borderColor: '#d1d5db',
      minWidth: 32,
      alignItems: 'center',
    },
    sortBtnActive: { backgroundColor: '#2563eb', borderColor: '#1d4ed8' },
    sortBtnText: { fontSize: fp(13), color: '#374151' },
    sortBtnTextActive: { color: '#fff' },
    actionBtn: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 6,
      backgroundColor: '#16a34a',
      minWidth: 36,
      alignItems: 'center',
    },
    actionBtnDisabled: { backgroundColor: '#d1d5db' },
    actionBtnText: { color: '#fff', fontSize: fp(13), fontWeight: '700' },
    actionBtnSecondary: {
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: 6,
      backgroundColor: '#0ea5e9',
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionBtnSecondaryText: {
      color: '#fff',
      fontSize: fp(11),
      fontWeight: '800',
    },
    actionBtnGhost: {
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: 6,
      backgroundColor: '#fff',
      borderWidth: 1,
      borderColor: '#9ca3af',
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionBtnGhostText: { color: '#4b5563', fontSize: fp(13), fontWeight: '800' },

    detail: {
      paddingHorizontal: 4,
      paddingBottom: 8,
      borderTopWidth: 1,
      borderTopColor: '#f3f4f6',
    },

    section: { marginTop: 8 },
    sectionTitle: {
      fontSize: fp(12),
      fontWeight: '800',
      color: '#1d4ed8',
      paddingHorizontal: 8,
      paddingVertical: 6,
      backgroundColor: '#eff6ff',
      borderRadius: 4,
    },
    sectionTitleUnknown: {
      color: '#92400e',
      backgroundColor: '#fef3c7',
    },

    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: '#f3f4f6',
      gap: 10,
    },
    rowUnknown: { backgroundColor: '#fffbeb' },
    rowDone: { backgroundColor: '#f3f4f6', opacity: 0.7 },
    textDone: {
      color: '#9ca3af',
      textDecorationLine: 'line-through',
    },
    checkBox: {
      width: 28,
      height: 28,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: '#16a34a',
      backgroundColor: '#fff',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 2,
    },
    checkBoxText: {
      fontSize: fp(16),
      fontWeight: '900',
      color: '#16a34a',
    },
    returnedTag: {
      fontSize: fp(10),
      fontWeight: '700',
      color: '#16a34a',
      marginTop: 2,
    },
    rank: {
      fontSize: fp(18),
      fontWeight: '900',
      color: '#1d4ed8',
      width: 26,
      textAlign: 'center',
      paddingTop: 2,
    },
    rowMain: { flex: 1, minWidth: 0, gap: 3 },
    rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    rowLabel: {
      fontSize: fp(13),
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
    rowMenu: { fontSize: fp(12), color: '#374151', lineHeight: fp(17) },
    rowTotal: { fontSize: fp(11), fontWeight: '700', color: '#dc2626' },
    fineNote: {
      fontSize: fp(10),
      color: '#9ca3af',
      paddingHorizontal: 12,
      paddingTop: 6,
      fontStyle: 'italic',
    },
  });
}
