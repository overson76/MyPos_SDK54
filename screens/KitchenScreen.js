import { useEffect, useMemo, useRef, useState } from 'react';
// (useRef 는 dragRef/cleanupRef 용으로 유지)
import {
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import makeStyles from './KitchenScreen.styles';
import { useResponsive } from '../utils/useResponsive';
import { tables, tableTypeColors, resolveAnyTable } from '../utils/tableData';
import { useOrders } from '../utils/OrderContext';
import { useMenu } from '../utils/MenuContext';
import { useStore } from '../utils/StoreContext';
import {
  playReadySound,
  speakFullReady,
  speakPartialReady,
  speakReady,
} from '../utils/notify';
import { computeDiffRows } from '../utils/orderDiff';
import { computeItemsTotal } from '../utils/orderHelpers';
import { buildReceiptText } from '../utils/escposBuilder';
import { printReceipt, isPrinterAvailable } from '../utils/printReceipt';

const typeLabels = {
  regular: '매장',
  reservation: '예약',
  takeout: '포장',
  delivery: '배달',
};

function formatElapsed(ts, now) {
  if (!ts) return '';
  const mins = Math.max(0, Math.floor((now - ts) / 60000));
  if (mins === 0) return '방금';
  return `${mins}분 경과`;
}

export default function KitchenScreen() {
  const { orders, markReady, cycleItemCookState, cycleItemCookStatePortion } =
    useOrders();
  const { items: menuItems, optionsList: OPTIONS_CATALOG } = useMenu();
  const { storeInfo } = useStore();
  // 사이드바 메뉴 클릭 시 해당 메뉴를 가진 테이블 카드를 하이라이트
  const [highlightMenuId, setHighlightMenuId] = useState(null);
  const printerAvailable = isPrinterAvailable();

  // 🖨️ 버튼 — 1.0.32 부터 모든 출력 영수증 빌더(buildReceiptText) 통일.
  // 사장님 의도: "모든 곳에서 같은 출력물" — 메뉴 / 수량 / 가격 / 옵션 / 메모 / 합계 모두.
  const handlePrintSlip = async (o) => {
    if (!o) return;
    const itemsWithLabels = (o.items || []).map((it) => ({
      ...it,
      optionLabels: (it.options || [])
        .map((oid) => OPTIONS_CATALOG.find((opt) => opt.id === oid)?.label)
        .filter(Boolean),
    }));
    const receiptText = buildReceiptText({
      storeName: storeInfo?.name || 'MyPos',
      storePhone: storeInfo?.phone || '',
      storeAddress: storeInfo?.address || '',
      businessNumber: storeInfo?.businessNumber || '',
      receiptFooter: storeInfo?.receiptFooter || '',
      tableId: o.tableId,
      tableLabel: o.table?.label || o.tableId,
      items: itemsWithLabels,
      total: computeItemsTotal(o.items),
      paymentMethod: o.paymentMethod || null,
      paymentStatus: o.paymentStatus || 'pending',
      deliveryAddress: o.table?.type === 'delivery' ? o.deliveryAddress : '',
      printedAt: Date.now(),
    });
    printReceipt({ rawText: receiptText }).catch(() => {});
  };

  // 주문 경과 분수 표시 — 15초마다 리렌더
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);

  // 메인 카드 영역 — 웹에서 마우스로 위/아래 드래그하여 스와이프 가능.
  // 모바일/태블릿 터치는 RN ScrollView 기본 동작.
  // 스크롤바는 기본 표시 (showsVerticalScrollIndicator 기본 true).
  // ※ KitchenScreen 은 activeOrders 가 0 일 때 early return → ScrollView 가 늦게 마운트되므로
  //    useEffect([]) 로는 ref 가 안 잡힘. callback ref 로 마운트/언마운트마다 핸들러 갱신.
  const dragRef = useRef({ down: false, startY: 0, startScroll: 0, moved: 0 });
  const cleanupRef = useRef(null);
  const mainScrollRef = (sv) => {
    if (Platform.OS !== 'web') return;
    // 이전 ref 의 listener teardown
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    if (!sv) return;
    const node =
      typeof sv.getScrollableNode === 'function'
        ? sv.getScrollableNode()
        : sv;
    if (!node || !node.addEventListener) return;
    const onDown = (e) => {
      dragRef.current = {
        down: true,
        startY: e.pageY,
        startScroll: node.scrollTop,
        moved: 0,
      };
      node.style.cursor = 'grabbing';
    };
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d.down) return;
      const dy = e.pageY - d.startY;
      d.moved = Math.abs(dy);
      if (d.moved > 5) {
        node.scrollTop = d.startScroll - dy;
        e.preventDefault();
      }
    };
    const onUp = () => {
      dragRef.current.down = false;
      node.style.cursor = '';
    };
    node.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    cleanupRef.current = () => {
      node.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  };
  const { width, height, isXS, isSM, isMD, scale } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);
  const isCompact = width < 1200 || height < 700;
  const isPhone = isCompact;
  // 그리드 컨테이너 padding/gap — 스타일과 동일 값. 카드 폭 계산이 어긋나면 wrap 됨.
  const gridPadH = isCompact ? 6 : 16;
  const gridGap = isCompact ? 6 : 12;
  // 우측에 조리 대기 합계 사이드바(라운드 카드)를 두고, 그 만큼 줄어든 영역에 카드 그리드를 배치.
  const sidebarWidth = isCompact ? 150 : 200;
  const sidebarMargin = 6;
  // RN-web ScrollView 의 세로 스크롤바 폭(~16px) 만큼 카드 영역에서 추가로 빼야 wrap 안 됨.
  const scrollbarReserve = Platform.OS === 'web' ? 16 : 0;
  const cardsAreaWidth = Math.max(
    200,
    width - sidebarWidth - sidebarMargin * 2 - scrollbarReserve
  );
  // 컴팩트(아이폰 가로 등) 에서 사이드바 옆에 카드 3장이 들어가도록 폭 계산.
  const cardCols = isCompact ? 3 : isMD ? 3 : 4;
  const cardWidth = Math.floor(
    (cardsAreaWidth - gridPadH * 2 - gridGap * (cardCols - 1)) / cardCols
  );

  const resolveTable = (tableId) => {
    if (tableId.includes('#')) {
      const [parentId, partIdx] = tableId.split('#');
      const parent = resolveAnyTable(parentId);
      if (!parent) return null;
      return {
        ...parent,
        id: tableId,
        label: `${parent.label}-${partIdx}`,
        parentId,
      };
    }
    return resolveAnyTable(tableId);
  };

  const allOrders = Object.entries(orders)
    .map(([tableId, order]) => ({
      tableId,
      table: resolveTable(tableId),
      ...order,
    }))
    .filter(
      (o) =>
        o.table &&
        o.items.length > 0 &&
        (o.confirmedItems || []).length > 0 // 주문 버튼 눌린 것만 표시
    );

  const activeOrders = allOrders
    .filter((o) => o.status !== 'ready') // 조리완료된 주문은 주문현황 메인에서 제거
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  // 조리해야 하는(=pending) 항목을 메뉴+옵션 조합별로 집계 — cooking/cooked 는 제외.
  // 같은 메뉴라도 옵션이 다르면 별도 행으로 표기 (예: 칼국수 / 칼국수 안맵게).
  // 사이즈 옵션(opt1,opt2)은 보통/대 포션으로 별도 처리하므로 그룹 키에서 제외.
  const pendingByMenu = (() => {
    const map = new Map();
    for (const o of activeOrders) {
      for (const item of (o.items || [])) {
        const lq = item.largeQty || 0;
        const nq = item.qty - lq;
        const baseCs = item.cookState || 'pending';
        const hasBoth = lq > 0 && nq > 0;
        const userOpts = [...(item.options || [])]
          .filter((oid) => {
            const def = OPTIONS_CATALOG.find((o) => o.id === oid);
            return def && !def.sizeGroup;
          })
          .sort();
        const groupKey = `${item.id}#${userOpts.join(',')}`;
        const ensureGroup = () =>
          map.get(groupKey) || {
            key: groupKey,
            id: item.id,
            name: item.name,
            options: userOpts,
            normal: 0,
            large: 0,
          };
        // 보통 포션
        if (nq > 0) {
          const cs = hasBoth ? (item.cookStateNormal || baseCs) : baseCs;
          if (cs === 'pending') {
            const cur = ensureGroup();
            cur.normal += nq;
            map.set(groupKey, cur);
          }
        }
        // 대 포션
        if (lq > 0) {
          const cs = hasBoth ? (item.cookStateLarge || baseCs) : baseCs;
          if (cs === 'pending') {
            const cur = ensureGroup();
            cur.large += lq;
            map.set(groupKey, cur);
          }
        }
      }
    }
    // 메뉴 그룹 단위로 합쳐 많은 순서대로, 같은 메뉴 안에서는 옵션 순.
    const groups = Array.from(map.values()).filter(
      (v) => v.normal + v.large > 0
    );
    const menuTotals = new Map();
    const menuHasLarge = new Map();
    for (const v of groups) {
      menuTotals.set(v.id, (menuTotals.get(v.id) || 0) + v.normal + v.large);
      if (v.large > 0) menuHasLarge.set(v.id, true);
    }
    // 한 그룹을 보통/대 entry 두 개로 분리 — 사이드바에서 각각 별도 row 로.
    // showNormalLabel: 같은 메뉴 id 에 대 entry 가 있을 때만 보통 entry 에 '보통' 라벨.
    // (대 없는 메뉴는 그냥 메뉴명만 → 사용자가 보통으로 자동 인지)
    const entries = [];
    for (const v of groups) {
      if (v.normal > 0) {
        entries.push({
          key: `${v.key}#normal`,
          id: v.id,
          name: v.name,
          options: v.options,
          qty: v.normal,
          portion: 'normal',
          showNormalLabel: !!menuHasLarge.get(v.id),
        });
      }
      if (v.large > 0) {
        entries.push({
          key: `${v.key}#large`,
          id: v.id,
          name: v.name,
          options: v.options,
          qty: v.large,
          portion: 'large',
          showNormalLabel: false,
        });
      }
    }
    // 정렬: 메뉴 total desc → 같은 메뉴 안에서는 보통 먼저, 대 다음 → 옵션 순
    return entries.sort((a, b) => {
      const ta = menuTotals.get(a.id) || 0;
      const tb = menuTotals.get(b.id) || 0;
      if (ta !== tb) return tb - ta;
      if (a.id !== b.id) return a.id - b.id;
      if (a.portion !== b.portion) return a.portion === 'normal' ? -1 : 1;
      if (a.options.length !== b.options.length)
        return a.options.length - b.options.length;
      return a.options.join(',').localeCompare(b.options.join(','));
    });
  })();
  const pendingTotalQty = pendingByMenu.reduce((s, v) => s + v.qty, 0);

  // 메뉴 id → 메뉴 정의 매핑 (color 추출용)
  const menuById = Object.fromEntries(menuItems.map((m) => [m.id, m]));
  // 표기용 메뉴명에서 괄호와 그 안의 내용 제거 — shortName fallback 용
  const stripParens = (s) => (s || '').replace(/\s*\([^)]*\)\s*/g, '').trim();
  // 주문현황 + 조리대기 표시용 단축명 — 메뉴 정의의 shortName 우선,
  // 없으면 괄호 제거된 이름으로 fallback. 매장 화면 가독성 + TTS 와 동일한 규칙.
  const shortMenuName = (item) => {
    const def = menuById[item?.id];
    return def?.shortName || stripParens(item?.name) || item?.name || '';
  };

  const renderSidebar = () => (
    <View style={[styles.sidebar, { width: sidebarWidth }]}>
      <View style={styles.sidebarHeader}>
        <Text style={styles.sidebarHeaderIcon}>🔥</Text>
        <Text style={styles.sidebarTitle} numberOfLines={1}>조리 대기</Text>
        <Text style={styles.sidebarTotalQty}>{pendingTotalQty}개</Text>
      </View>
      <ScrollView style={styles.sidebarList}>
        {pendingByMenu.length === 0 ? (
          <Text style={styles.sidebarEmpty}>대기 항목 없음</Text>
        ) : (
          pendingByMenu.map((v) => {
            const def = menuById[v.id];
            const color = def?.color || '#6b7280';
            const cleanName = shortMenuName(v);
            const optLabels = v.options
              .map((oid) => OPTIONS_CATALOG.find((o) => o.id === oid)?.label)
              .filter(Boolean);
            const hasOpts = optLabels.length > 0;
            const isActive = highlightMenuId === v.id;
            const isLarge = v.portion === 'large';
            return (
              <TouchableOpacity
                key={`pm-${v.key}`}
                activeOpacity={0.7}
                onPress={() =>
                  setHighlightMenuId((cur) => (cur === v.id ? null : v.id))
                }
                style={[
                  styles.sidebarRow,
                  {
                    borderLeftColor: color,
                    backgroundColor: color + (isActive ? '55' : '22'),
                  },
                  isActive && styles.sidebarRowActive,
                ]}
              >
                <View style={[styles.sidebarColorDot, { backgroundColor: color }]} />
                <View style={styles.sidebarRowTextWrap}>
                  {/* 메뉴명 + 사이즈 라벨 inline.
                      - 대: 항상 ' 대' 표시 (빨강 강조)
                      - 보통: 같은 메뉴에 대 entry 가 함께 있을 때만 ' 보통' (회색)
                      - 대 없는 메뉴는 라벨 X — 자동 보통으로 인지 */}
                  <Text style={styles.sidebarRowName}>
                    {cleanName}
                    {isLarge && (
                      <Text style={styles.largeTag}> 대</Text>
                    )}
                    {!isLarge && v.showNormalLabel && (
                      <Text style={styles.normalTag}> 보통</Text>
                    )}
                  </Text>
                  {hasOpts && (
                    <Text style={styles.sidebarRowOpts}>
                      {optLabels.join(' · ')}
                    </Text>
                  )}
                </View>
                <View style={styles.sidebarRowQtyWrap}>
                  <Text style={styles.sidebarRowQty}>×{v.qty}</Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );

  if (activeOrders.length === 0) {
    return (
      <View style={[styles.bodyRow, { flex: 1 }]}>
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>주문현황</Text>
          <Text style={styles.emptyText}>대기 중인 주문이 없습니다</Text>
          <Text style={styles.versionMark}>v3 · 변경감지 활성</Text>
        </View>
        {renderSidebar()}
      </View>
    );
  }

  return (
    <View style={styles.bodyRow}>
      <ScrollView
        ref={mainScrollRef}
        style={[
          { flex: 1 },
          Platform.OS === 'web' ? styles.scrollWeb : null,
        ]}
        contentContainerStyle={[styles.grid, isPhone && styles.gridPhone]}
        showsVerticalScrollIndicator
      >
        <View style={styles.versionBar}>
          <Text style={styles.versionText}>v3 · 변경감지 활성</Text>
        </View>
      {activeOrders.map((o, idx) => {
        const color = tableTypeColors[o.table.type] || '#6b7280';
        const total = computeItemsTotal(o.items);
        const qty = o.items.reduce((s, i) => s + i.qty, 0);
        const isReady = o.status === 'ready';
        const confirmed = o.confirmedItems || [];
        const isFresh = confirmed.length === 0;
        const rows = computeDiffRows(o.items, confirmed);
        const hasChanges = rows.some((r) => r.kind !== 'unchanged');
        // 사이드바에서 메뉴를 선택했고, 이 테이블이 그 메뉴를 가지고 있는지
        const cardHasHighlight =
          highlightMenuId != null &&
          o.items.some((i) => i.id === highlightMenuId);
        const cardDimmed =
          highlightMenuId != null && !cardHasHighlight;
        return (
          <View
            key={o.tableId}
            style={[
              styles.card,
              { borderColor: color, width: cardWidth },
              isReady && styles.cardReady,
              hasChanges && styles.cardChanged,
              cardHasHighlight && styles.cardHighlighted,
              cardDimmed && styles.cardDimmed,
            ]}
          >
            <View style={[styles.cardHeader, isPhone && styles.cardHeaderPhone, { backgroundColor: color }]}>
              <View style={styles.headerLeft}>
                <Text style={styles.seqBadge}>#{idx + 1}</Text>
                <Text
                  style={[styles.cardLabel, isPhone && styles.cardLabelPhone]}
                  numberOfLines={1}
                >
                  {o.table.label}
                </Text>
                <Text style={styles.cardType}>
                  {typeLabels[o.table.type] || ''}
                </Text>
                {hasChanges &&
                  (isFresh ? (
                    <Text style={styles.freshBadge}>신규</Text>
                  ) : (
                    <Text style={styles.changedBadge}>변경됨</Text>
                  ))}
                {cardHasHighlight && (() => {
                  const cnt = o.items
                    .filter((i) => i.id === highlightMenuId)
                    .reduce((s, i) => s + (i.qty || 0), 0);
                  return (
                    <Text style={styles.highlightBadge} numberOfLines={1}>
                      ★{cnt}
                    </Text>
                  );
                })()}
              </View>
              <Text style={styles.cardTime}>
                {formatElapsed(o.createdAt, nowTick)}
              </Text>
            </View>

            {o.table.type === 'delivery' && o.deliveryAddress ? (
              <View style={styles.deliveryBar}>
                <Text style={styles.deliveryBarLabel}>📍 배달지</Text>
                <Text style={styles.deliveryBarText}>
                  {o.deliveryAddress}
                </Text>
              </View>
            ) : null}

            {hasChanges && (() => {
              const addedRows = rows.filter((r) => r.kind === 'added');
              const changedRows = rows.filter((r) => r.kind === 'changed');
              const removedRows = rows.filter((r) => r.kind === 'removed');
              return (
                <View style={[styles.changeBox, isFresh && styles.freshBox]}>
                  <Text style={[styles.changeBoxTitle, isFresh && styles.freshBoxTitle]}>
                    {isFresh ? '🆕 신규 접수' : '📣 변경 사항'} {addedRows.length + changedRows.length + removedRows.length}건
                  </Text>
                  {addedRows.map((r) => (
                    <View key={`ca-${r.item.slotId || r.item.id}`} style={styles.changeLine}>
                      <Text style={[styles.changeTag, styles.tagAdded]}>추가</Text>
                      {/* 변경사항은 매장 운영의 핵심 정보 — 메뉴명/대 표기/수량이 잘리지 않도록 줄바꿈 허용 */}
                      <Text style={styles.changeName}>
                        {shortMenuName(r.item)}
                        {(r.item.largeQty || 0) > 0 && (
                          <Text style={styles.largeTag}>
                            {(r.item.largeQty || 0) === r.item.qty
                              ? ' (대)'
                              : ` (대${r.item.largeQty})`}
                          </Text>
                        )}
                      </Text>
                      <Text style={styles.changeValue}>×{r.item.qty}</Text>
                    </View>
                  ))}
                  {changedRows.map((r) => {
                    const prev = r.prev || {};
                    const cur = r.item;
                    const parts = [];
                    if ((prev.qty || 0) !== (cur.qty || 0)) {
                      parts.push(`×${prev.qty || 0}→×${cur.qty || 0}`);
                    }
                    const prevLq = prev.largeQty || 0;
                    const curLq = cur.largeQty || 0;
                    if (prevLq !== curLq) {
                      const prevNq = (prev.qty || 0) - prevLq;
                      const curNq = (cur.qty || 0) - curLq;
                      // 수량 차이 없이 대/보통만 바뀐 단순 케이스
                      if (prev.qty === cur.qty && prevLq === 0 && curLq === cur.qty) {
                        parts.push('보통→대');
                      } else if (prev.qty === cur.qty && curLq === 0 && prevLq === prev.qty) {
                        parts.push('대→보통');
                      } else {
                        parts.push(`대 ${prevLq}→${curLq}`);
                        if (prevNq !== curNq) parts.push(`보통 ${prevNq}→${curNq}`);
                      }
                    }
                    const prevOpts = new Set(prev.options || []);
                    const curOpts = new Set(cur.options || []);
                    const addedOpts = [...curOpts].filter((o) => !prevOpts.has(o));
                    const removedOpts = [...prevOpts].filter((o) => !curOpts.has(o));
                    const labelOf = (oid) =>
                      OPTIONS_CATALOG.find((o) => o.id === oid)?.label || oid;
                    addedOpts.forEach((oid) => parts.push(`+${labelOf(oid)}`));
                    removedOpts.forEach((oid) => parts.push(`−${labelOf(oid)}`));
                    const detail = parts.join(' · ');
                    return (
                      <View key={`cc-${r.item.slotId || r.item.id}`} style={styles.changeLine}>
                        <Text style={[styles.changeTag, styles.tagChanged]}>변경</Text>
                        {/* 변경 detail (수량/대보통/옵션 +/-) 가 길어도 잘리지 않도록 줄바꿈 허용 */}
                        <Text
                          style={[styles.changeName, styles.changeNameInline]}
                        >
                          {shortMenuName(r.item)}
                          {detail.length > 0 && (
                            <Text style={styles.changeDetailInline}>
                              {' · '}
                              {detail}
                            </Text>
                          )}
                        </Text>
                      </View>
                    );
                  })}
                  {removedRows.map((r) => (
                    <View key={`cr-${r.item.slotId || r.item.id}`} style={styles.changeLine}>
                      <Text style={[styles.changeTag, styles.tagRemoved]}>취소</Text>
                      <Text
                        style={[styles.changeName, styles.text_removed]}
                      >
                        {shortMenuName(r.item)}
                      </Text>
                      <Text style={[styles.changeValue, styles.text_removed]}>
                        ×{r.previousQty ?? (r.item.qty || 1)}
                      </Text>
                    </View>
                  ))}
                </View>
              );
            })()}

            <View style={[styles.cardBody, isPhone && styles.cardBodyPhone]}>
              {hasChanges && (
                <Text style={styles.sectionLabel}>현재 주문 전체</Text>
              )}
              {rows
                .filter((r) => r.kind !== 'removed')
                .flatMap((r) => {
                  const lq = r.item.largeQty || 0;
                  const nq = r.item.qty - lq;
                  const kitchenHasLarge = o.items.some(
                    (it) => it.id === r.item.id && (it.largeQty || 0) > 0
                  );
                  const out = [];
                  // 사이즈 옵션(opt1,opt2)은 별도 대/보통으로 표시되므로 제외
                  const optLabels = (r.item.options || [])
                    .map((oid) => OPTIONS_CATALOG.find((o) => o.id === oid))
                    .filter((o) => o && !o.sizeGroup)
                    .map((o) => o.label);
                  const baseCs = r.item.cookState || 'pending';
                  const hasBothPortions = lq > 0 && nq > 0;
                  // 포션별 cookState: dual일 때는 cookStateNormal/Large, 아니면 공통
                  const portionState = (suffix, _sizeLabel) => {
                    if (!hasBothPortions) return baseCs;
                    if (suffix === 'n') return r.item.cookStateNormal || baseCs;
                    if (suffix === 'l') return r.item.cookStateLarge || baseCs;
                    return baseCs;
                  };
                  const makeRow = (suffix, portionQty, sizeLabel) => {
                    const cs = portionState(suffix, sizeLabel);
                    const isCooking = cs === 'cooking';
                    const isCooked = cs === 'cooked';
                    const isHighlightMatch =
                      highlightMenuId != null && r.item.id === highlightMenuId;
                    return (
                    <TouchableOpacity
                      key={`${r.kind}-${r.item.slotId || r.item.id}-${suffix}`}
                      style={[
                        styles.itemRow,
                        styles[`row_${r.kind}`],
                        isCooking && styles.row_cooking,
                        isCooked && styles.row_cooked,
                        isHighlightMatch && styles.row_highlight,
                      ]}
                      activeOpacity={0.6}
                      onPress={() => {
                        const targetSid =
                          r.item.slotId || r.item.id;
                        const currentState = cs;
                        const nextState =
                          currentState === 'pending'
                            ? 'cooking'
                            : currentState === 'cooking'
                            ? 'cooked'
                            : 'pending';
                        const isLargePortion = sizeLabel === '대';
                        if (hasBothPortions) {
                          cycleItemCookStatePortion(
                            o.tableId,
                            targetSid,
                            isLargePortion
                          );
                        } else {
                          cycleItemCookState(o.tableId, targetSid);
                        }
                        // 새 상태가 cooked일 때만 음성 안내
                        if (nextState === 'cooked') {
                          // 이 아이템 cooked 처리 후 모든 아이템이 cooked인지 확인
                          const allOthersCooked = o.items.every((it) => {
                            const tid = it.slotId || it.id;
                            if (tid === targetSid) return true;
                            const itLq = it.largeQty || 0;
                            const itNq = it.qty - itLq;
                            const itBoth = itLq > 0 && itNq > 0;
                            if (itBoth) {
                              const n = it.cookStateNormal || it.cookState || 'pending';
                              const l = it.cookStateLarge || it.cookState || 'pending';
                              return n === 'cooked' && l === 'cooked';
                            }
                            return (it.cookState || 'pending') === 'cooked';
                          });
                          playReadySound();
                          if (allOthersCooked && !hasBothPortions) {
                            speakFullReady({ table: o.table });
                          } else {
                            // 음성 안내도 화면 표시와 동일한 shortMenuName 규칙
                            speakPartialReady({
                              table: o.table,
                              itemName: shortMenuName(r.item),
                            });
                          }
                        }
                      }}
                    >
                      {isCooked ? (
                        <Text style={[styles.inlineTag, styles.tagCooked]}>
                          ✓
                        </Text>
                      ) : isCooking ? (
                        <Text style={[styles.inlineTag, styles.tagCooking]}>
                          🔥
                        </Text>
                      ) : r.kind === 'added' ? (
                        <Text style={[styles.inlineTag, styles.tagAdded]}>
                          추가
                        </Text>
                      ) : r.kind === 'changed' ? (
                        <Text style={[styles.inlineTag, styles.tagChanged]}>
                          변경
                        </Text>
                      ) : null}
                      <View style={styles.itemNameWrap}>
                        <Text
                          style={[
                            styles.itemName,
                            isPhone && styles.itemNamePhone,
                            styles[`text_${r.kind}`],
                            isCooking && styles.text_cooking,
                            isCooked && styles.text_cooked,
                          ]}
                          numberOfLines={1}
                        >
                          {shortMenuName(r.item)}
                          {sizeLabel && (
                            <Text
                              style={
                                sizeLabel === '대'
                                  ? styles.largeTag
                                  : styles.normalTag
                              }
                            >
                              {' '}
                              {sizeLabel}
                            </Text>
                          )}
                        </Text>
                        {/* 옵션은 매장 주문 정확도 핵심 — 잘리지 않도록 줄바꿈 허용 */}
                        {optLabels.length > 0 && (
                          <Text
                            style={[
                              styles.itemOptLine,
                              isPhone && styles.itemOptLinePhone,
                              isCooked && styles.text_cooked,
                            ]}
                          >
                            {optLabels.join(' · ')}
                          </Text>
                        )}
                      </View>
                      <Text
                        style={[
                          styles.itemQty,
                          isPhone && styles.itemQtyPhone,
                          styles[`text_${r.kind}`],
                          isCooking && styles.text_cooking,
                          isCooked && styles.text_cooked,
                        ]}
                      >
                        ×{portionQty}
                      </Text>
                      <Text
                        style={[
                          styles.itemSubtotal,
                          isPhone && styles.itemSubtotalPhone,
                          styles[`text_${r.kind}`],
                          isCooking && styles.text_cooking,
                          isCooked && styles.text_cooked,
                        ]}
                      >
                        {(
                          r.item.price * portionQty +
                          (sizeLabel === '대'
                            ? (r.item.sizeUpcharge || 0) * portionQty
                            : 0)
                        ).toLocaleString()}
                      </Text>
                    </TouchableOpacity>
                    );
                  };
                  // 메모는 같은 항목 묶음 최상단에 한 번만 표시.
                  // 매장 운영의 핵심 정보 — 잘리지 않도록 줄바꿈 허용 (numberOfLines 제거).
                  if (r.item.memo) {
                    out.push(
                      <View
                        key={`memo-${r.item.slotId || r.item.id}`}
                        style={styles.itemMemoLine}
                      >
                        <Text
                          style={[styles.itemMemoText, isPhone && styles.itemMemoTextPhone]}
                        >
                          📝 {r.item.memo}
                        </Text>
                      </View>
                    );
                  }
                  if (lq === 0) {
                    out.push(
                      makeRow(
                        'solo',
                        r.item.qty,
                        kitchenHasLarge ? '보통' : null
                      )
                    );
                  } else if (nq === 0) {
                    out.push(makeRow('l', lq, '대'));
                  } else {
                    out.push(makeRow('n', nq, '보통'));
                    out.push(makeRow('l', lq, '대'));
                  }
                  return out;
                })}
              {rows
                .filter((r) => r.kind === 'removed')
                .map((r) => (
                  <View
                    key={`rem-${r.item.slotId || r.item.id}`}
                    style={[styles.itemRow, styles.row_removed]}
                  >
                    <Text style={[styles.inlineTag, styles.tagRemoved]}>취소</Text>
                    <Text
                      style={[styles.itemName, styles.text_removed]}
                      numberOfLines={1}
                    >
                      {shortMenuName(r.item)}
                    </Text>
                    <Text style={[styles.itemQty, styles.text_removed]}>
                      ×{r.previousQty ?? (r.item.qty || 1)}
                    </Text>
                    <Text style={[styles.itemSubtotal, styles.text_removed]}>
                      -
                    </Text>
                  </View>
                ))}
            </View>

            <View style={[styles.cardFooter, isPhone && styles.cardFooterPhone]}>
              <View style={styles.totalWrap}>
                <Text style={styles.totalLabel}>합계 {qty}개</Text>
                <Text style={[styles.totalValue, isPhone && styles.totalValuePhone]}>
                  {total.toLocaleString()}원
                </Text>
              </View>
              {printerAvailable && (
                <TouchableOpacity
                  style={[styles.printSlipBtn, isPhone && styles.doneBtnPhone]}
                  onPress={() => handlePrintSlip(o)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.printSlipBtnText, isPhone && styles.doneBtnTextPhone]}>
                    🖨️
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.doneBtn, isPhone && styles.doneBtnPhone, isReady && styles.doneBtnReady]}
                onPress={() => {
                  if (isReady) return;
                  playReadySound();
                  speakFullReady({ table: o.table });
                  markReady(o.tableId);
                }}
                activeOpacity={0.8}
                disabled={isReady}
              >
                <Text
                  style={[styles.doneBtnText, isPhone && styles.doneBtnTextPhone, isReady && styles.doneBtnTextReady]}
                >
                  {isReady ? '✓ 조리완료' : '조리완료'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}

      </ScrollView>
      {renderSidebar()}
    </View>
  );
}
