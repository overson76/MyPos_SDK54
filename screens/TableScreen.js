import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import makeStyles from './TableScreen.styles';
import {
  DYNAMIC_SLOT_PREFIX,
  tableActions,
  tables,
  tableSubTabs,
  tableTypeColors,
} from '../utils/tableData';
import { useOrders } from '../utils/OrderContext';
import { useMenu } from '../utils/MenuContext';
import { useStore } from '../utils/StoreContext';
import { useResponsive } from '../utils/useResponsive';
import SlotStrip from '../components/SlotStrip';
import PaymentMethodPicker from '../components/PaymentMethodPicker';
import { printReceipt } from '../utils/printReceipt';
import { distanceKm, formatDistance } from '../utils/geocode';
import { normalizeAddressKey } from '../utils/orderHelpers';
import DeliveryMapSwiper from '../components/DeliveryMapSwiper';
import DeliveryMapModal from '../components/DeliveryMapModal';

export default function TableScreen({ onSelectTable, highlightTableId }) {
  const [subTab, setSubTab] = useState('기본홀');
  const [splitMode, setSplitMode] = useState(false);
  const [moveMode, setMoveMode] = useState(null); // null | 'source' | 'dest'
  const [moveSourceId, setMoveSourceId] = useState(null);
  const [moveMessage, setMoveMessage] = useState('');
  const [groupMode, setGroupMode] = useState(false);
  const [groupSelection, setGroupSelection] = useState([]);
  // 하이라이트 깜빡임 + 배달 경과시간 주기적 리렌더
  const [blinkOn, setBlinkOn] = useState(true);
  // highlightTableId 변경 시 3초간만 깜빡이고 자동 소멸 — 영구 깜빡임 눈 피로 회피.
  const [blinkActive, setBlinkActive] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());
  // 격자 정렬용 — 그리드 폭을 측정해서 SlotStrip 폭을 일반 셀 폭의 정확한 N배로 맞춤
  const [gridWidth, setGridWidth] = useState(0);
  // 메뉴 전체보기 모달 — 선택된 테이블의 id 저장 (null 이면 닫힘)
  const [expandedTableId, setExpandedTableId] = useState(null);
  // 결제하기 버튼이 띄우는 결제수단 선택 모달.
  // { tableId, total } | null. 선택 시 markPaid + clearTable + 모달 닫기.
  const [paymentPicker, setPaymentPicker] = useState(null);
  // 펼쳐보기 칩 클릭이 타일 onPress 와 같이 발화하는 RN 플랫폼 quirk 방어용 가드.
  // boolean flag 는 부모 onPress 가 안 불릴 때 sticky 가 되는 부작용이 있어 timestamp 로 자동 만료.
  const expandClickedAtRef = useRef(0);
  // 테이블 위 결제완료 버튼 클릭 시 부모 onPress 무시용 동일 가드.
  const payClickedAtRef = useRef(0);
  useEffect(() => {
    const blinkId = setInterval(() => setBlinkOn((b) => !b), 600);
    const timeId = setInterval(() => setNowTick(Date.now()), 15000);
    return () => {
      clearInterval(blinkId);
      clearInterval(timeId);
    };
  }, []);
  // highlightTableId 가 바뀌면 3초만 활성 → 자동 소멸. 영구 깜빡임 눈 피로 방지.
  useEffect(() => {
    if (!highlightTableId) {
      setBlinkActive(false);
      return;
    }
    setBlinkActive(true);
    const t = setTimeout(() => setBlinkActive(false), 3000);
    return () => clearTimeout(t);
  }, [highlightTableId]);
  const { width, height, isXS, isSM, isMD, scale } = useResponsive();
  // 폰트 배율(scale) 이 바뀔 때만 StyleSheet 재생성 — lg 진입 시 1.0 → 1.3.
  const styles = useMemo(() => makeStyles(scale), [scale]);
  const [mapInfo, setMapInfo] = useState(null);
  // 모든 화면을 한 화면에 Fit — 항상 5 × 4 그리드로 표시
  const isCompact = width < 1200 || height < 700;
  const cols = 5;
  const gridGap = isCompact ? 4 : 10;
  const gridPadH = isCompact ? 4 : 16;
  const gridPadV = isCompact ? 4 : 16;
  // 그리드 행/열은 flex 로 채우므로 tileWidth/tileHeight 계산은 제거하고
  // 각 셀(flex:1) 이 가용 공간을 자동 분배하도록 처리
  const rowCount = Math.ceil(tables.length / cols);
  // split 슬롯 등에서 참고용 (splitSlot minHeight 0 으로 flex 채우기)
  const isPhone = isCompact; // 기존 폰 전용 스타일 재사용
  const {
    orders,
    getOrder,
    getOrderTotal,
    getOrderQty,
    clearTable,
    isSplit,
    toggleSplit,
    moveOrder,
    groups,
    createGroup,
    dissolveGroup,
    getGroupFor,
    markPaid,
    addressBook,
  } = useOrders();
  const { storeInfo } = useStore();
  const { optionsList: OPTIONS_CATALOG } = useMenu();

  // 전체 배달 지도 — 좌표 있는 배달 테이블을 한 화면에 모두 표시.
  const openAllDeliveryMap = () => {
    const deliveries = tables
      .filter((t) => t.type === 'delivery')
      .map((t) => {
        const o = getOrder(t.id);
        const addr = o?.deliveryAddress;
        if (!addr) return null;
        const key = normalizeAddressKey(addr);
        const entry = key ? addressBook?.entries?.[key] : null;
        const coord = entry && typeof entry.lat === 'number'
          ? { lat: entry.lat, lng: entry.lng } : null;
        const distLbl = coord && typeof storeInfo?.lat === 'number'
          ? formatDistance(distanceKm(coord, { lat: storeInfo.lat, lng: storeInfo.lng }))
          : null;
        return { coord, addr, label: t.label || t.id, distanceLabel: distLbl };
      })
      .filter(Boolean);
    if (!deliveries.length) return;
    setMapInfo({
      storeCoord: typeof storeInfo?.lat === 'number'
        ? { lat: storeInfo.lat, lng: storeInfo.lng } : null,
      deliveries,
    });
  };

  const exitAllModes = () => {
    setSplitMode(false);
    setMoveMode(null);
    setMoveSourceId(null);
    setMoveMessage('');
    setGroupMode(false);
    setGroupSelection([]);
  };

  // 단체로 묶인 테이블의 병합 라벨 (예: "01+02+03")
  const buildGroupLabel = (memberIds) =>
    memberIds
      .map((id) => tables.find((tb) => tb.id === id)?.label || id)
      .join('+');

  const handleTilePress = (tableObj) => {
    if (splitMode) {
      const parentId = tableObj.parentId || tableObj.id;
      toggleSplit(parentId);
      exitAllModes();
      return;
    }
    if (groupMode) {
      // 이미 단체로 묶인 테이블 클릭 → 단체 해제
      const existing = getGroupFor?.(tableObj.id);
      if (existing) {
        dissolveGroup?.(existing.leaderId);
        return;
      }
      // split 된 테이블은 단체 묶기 대상에서 제외
      if (tableObj.parentId || isSplit(tableObj.id)) {
        setMoveMessage('합석된 테이블은 단체로 묶을 수 없습니다 (합석 먼저 해제)');
        return;
      }
      // 이미 선택된 테이블을 다시 클릭 → 선택 해제
      if (groupSelection.includes(tableObj.id)) {
        setGroupSelection((prev) => prev.filter((x) => x !== tableObj.id));
        return;
      }
      // 두 번째 선택 시 추가 버튼 클릭 없이 즉시 단체 생성
      const nextSel = [...groupSelection, tableObj.id];
      if (nextSel.length >= 2) {
        createGroup?.(nextSel);
        exitAllModes();
      } else {
        setGroupSelection(nextSel);
      }
      return;
    }
    if (moveMode === 'source') {
      const order = getOrder(tableObj.id);
      const hasAny =
        order.items.length > 0 || (order.confirmedItems || []).length > 0;
      if (!hasAny) {
        setMoveMessage('주문이 있는 테이블을 선택하세요');
        return;
      }
      setMoveSourceId(tableObj.id);
      setMoveMode('dest');
      setMoveMessage(
        `${tableObj.label} → 이동할 빈 테이블을 선택하세요`
      );
      return;
    }
    if (moveMode === 'dest') {
      if (tableObj.id === moveSourceId) {
        exitAllModes();
        return;
      }
      const ok = moveOrder(moveSourceId, tableObj.id);
      if (!ok) {
        setMoveMessage('비어있는 테이블로만 이동할 수 있습니다');
        return;
      }
      exitAllModes();
      return;
    }
    // 단체로 묶인 테이블 중 아무거나 클릭 → 리더의 주문으로 이동, 라벨은 병합 표시
    const group = getGroupFor?.(tableObj.id);
    if (group) {
      const leader = tables.find((tb) => tb.id === group.leaderId);
      if (leader) {
        onSelectTable?.({
          ...leader,
          id: group.leaderId,
          label: buildGroupLabel(group.memberIds),
          isGroup: true,
          memberIds: group.memberIds,
        });
        return;
      }
    }
    onSelectTable?.(tableObj);
  };

  const handleActionPress = (action) => {
    if (action === '합석') {
      const was = splitMode;
      exitAllModes();
      setSplitMode(!was);
      return;
    }
    if (action === '자리이동') {
      const was = moveMode !== null;
      exitAllModes();
      if (!was) {
        setMoveMode('source');
        setMoveMessage('이동할 테이블(주문 있음)을 선택하세요');
      }
      return;
    }
    if (action === '단체') {
      if (groupMode) {
        // 단체 모드 종료 — 2개 이상 선택되어 있으면 단체 생성
        if (groupSelection.length >= 2) {
          createGroup?.(groupSelection);
        }
        exitAllModes();
      } else {
        exitAllModes();
        setGroupMode(true);
        setGroupSelection([]);
        setMoveMessage('단체로 묶을 테이블을 선택 후 단체 버튼을 다시 누르세요 (2개 이상)');
      }
      return;
    }
  };

  const renderTile = (t, { isSplitPart = false } = {}) => {
    const borderColor = tableTypeColors[t.type];
    // 단체 — 이 테이블이 속한 단체 정보
    const group = getGroupFor?.(t.id);
    const isGrouped = !!group;
    // 그룹 멤버는 주문 정보를 리더의 tableId 로부터 읽는다
    const readTableId = isGrouped ? group.leaderId : t.id;
    const order = getOrder(readTableId);
    const total = getOrderTotal(readTableId);
    const qty = getOrderQty(readTableId);
    const hasOrder = (order.confirmedItems || []).length > 0;
    // 주문중 = 장바구니에 담긴 것이 있고 아직 주방(items)에 커밋 안 된 상태
    const cartOnly =
      (order.cartItems || []).length > 0 &&
      (order.items || []).length === 0;
    // 단체 모드에서 선택된 테이블 — 시각적 강조
    const isGroupSelected = groupMode && groupSelection.includes(t.id);
    // 단체 라벨: 묶인 테이블 번호들을 '+' 로 연결
    const displayLabel = isGrouped ? buildGroupLabel(group.memberIds) : t.label;
    const isHighlighted =
      !!highlightTableId &&
      (t.id === highlightTableId ||
        (t.parentId && t.parentId === highlightTableId) ||
        highlightTableId === t.id.split('#')[0]);
    const slotAllCooked = (i) => {
      const lq = i.largeQty || 0;
      const nq = i.qty - lq;
      const both = lq > 0 && nq > 0;
      if (both) {
        const n = i.cookStateNormal || i.cookState || 'pending';
        const l = i.cookStateLarge || i.cookState || 'pending';
        return n === 'cooked' && l === 'cooked';
      }
      return (i.cookState || 'pending') === 'cooked';
    };
    const slotAnyCooking = (i) => {
      const lq = i.largeQty || 0;
      const nq = i.qty - lq;
      const both = lq > 0 && nq > 0;
      const cs = i.cookState || 'pending';
      if (both) {
        const n = i.cookStateNormal || cs;
        const l = i.cookStateLarge || cs;
        return n === 'cooking' || l === 'cooking';
      }
      return cs === 'cooking';
    };
    const anyCooking = order.items.some(slotAnyCooking);
    const allCooked =
      order.items.length > 0 && order.items.every(slotAllCooked);
    const isReady = allCooked || order.status === 'ready';
    const isPaid = order.paymentStatus === 'paid';
    const deliveryAddr = order.deliveryAddress;
    const isDelivery = t.type === 'delivery';
    // 배달 거리 — 매장 좌표 + 주소록의 변환 좌표 모두 있을 때만 표시.
    // useAddressBook 의 백그라운드 effect 가 lat/lng 채워주면 자동으로 나타남.
    let distanceLabel = null;
    if (isDelivery && deliveryAddr && storeInfo?.lat != null && storeInfo?.lng != null) {
      const key = normalizeAddressKey(deliveryAddr);
      const entry = key ? addressBook?.entries?.[key] : null;
      if (entry && typeof entry.lat === 'number' && typeof entry.lng === 'number') {
        distanceLabel = formatDistance(
          distanceKm(
            { lat: entry.lat, lng: entry.lng },
            { lat: storeInfo.lat, lng: storeInfo.lng }
          )
        );
      }
    }
    // 배달 테이블이고 조리완료 상태면 '배달중' 뱃지 표시
    const isOutForDelivery = isDelivery && isReady;
    // 배달중이면 조리완료 시점(readyAt)부터 경과 분수 계산
    const deliveredMins =
      isOutForDelivery && order.readyAt
        ? Math.max(0, Math.floor((nowTick - order.readyAt) / 60000))
        : null;

    // isCompact(폰/소형)면 4개 고정. 큰 화면은 scale 비례로 늘어남.
    // scale 은 폭 기준이지만 타일 높이도 폭에 비례해 커지므로 함께 활용.
    const ITEMS_VISIBLE_LIMIT = isCompact ? 4 : Math.min(8, Math.round(4 * scale));
    const overflowCount = Math.max(
      0,
      (order.items?.length || 0) - ITEMS_VISIBLE_LIMIT
    );

    const cardNode = (
      <TouchableOpacity
        onPress={() => {
          // 펼쳐보기 / 결제완료 버튼 클릭 직후 200ms 안의 타일 onPress 는 nested-touchable 누수로 무시
          if (Date.now() - expandClickedAtRef.current < 200) return;
          if (Date.now() - payClickedAtRef.current < 200) return;
          handleTilePress(t);
        }}
        activeOpacity={0.7}
        style={[
          isSplitPart ? styles.tilePart : styles.tile,
          isCompact && (isSplitPart ? styles.tilePartPhone : styles.tilePhone),
          { borderColor },
          hasOrder ? styles.tileWithOrder : (isCompact ? styles.tileEmptyPhone : styles.tileEmpty),
          // 셀 내부 flex:1 로 가용 공간 채우기 (스크롤 없이 한 화면에 맞춤)
          !isSplitPart && { flex: 1, alignSelf: 'stretch' },
          isReady && !isPaid && !isOutForDelivery && styles.tileReady,
          isOutForDelivery && !isPaid && styles.tileDelivering,
          !isReady && anyCooking && !isPaid && styles.tileCooking,
          isPaid && styles.tilePaid,
          cartOnly && !hasOrder && styles.tileOrdering,
          isGrouped && styles.tileGrouped,
          isGroupSelected && styles.tileGroupSelected,
          isHighlighted && blinkActive && blinkOn && styles.tileHighlightedBlink,
        ]}
      >
        <View style={styles.tileTouch}>
          {hasOrder ? (
            <View style={{ flex: 1, minHeight: 0 }}>
              <View style={styles.tileTopRow}>
                <View style={styles.tileTopLeft}>
                  <Text
                    style={isSplitPart ? styles.tileLabelTiny : styles.tileLabelSmall}
                    numberOfLines={1}
                  >
                    {displayLabel}
                  </Text>
                  {total > 0 && (
                    <Text
                      style={[
                        styles.tileTopTotal,
                        isSplitPart && styles.tileTopTotalTiny,
                        isPaid && styles.tileTopTotalPaid,
                      ]}
                      numberOfLines={1}
                    >
                      {total.toLocaleString()}원
                    </Text>
                  )}
                </View>
                <View style={styles.badgesWrap}>
                  {isGrouped && (
                    <Text style={styles.tileGroupBadge}>👥 단체</Text>
                  )}
                  {isOutForDelivery ? (
                    <Text style={styles.tileDeliveringBadge}>
                      🛵 배달중{deliveredMins != null ? ` ${deliveredMins}분` : ''}
                    </Text>
                  ) : isReady && !isPaid ? (
                    // 조리완료 미결제: "결제하기" 버튼 직접 노출.
                    // 누르면 결제수단 선택 모달 → 선택값으로 markPaid + clearTable.
                    // 총금액은 위 tileTopLeft 의 total 텍스트에 이미 표시됨 — picker 안에서 한 번 더.
                    <TouchableOpacity
                      style={styles.tilePayBtn}
                      activeOpacity={0.7}
                      onPress={() => {
                        payClickedAtRef.current = Date.now();
                        setPaymentPicker({
                          tableId: readTableId,
                          total: getOrderTotal(readTableId),
                          label: displayLabel,
                        });
                      }}
                      accessibilityLabel={`${displayLabel} 결제하기`}
                    >
                      <Text style={styles.tilePayBtnText}>💰 결제하기</Text>
                    </TouchableOpacity>
                  ) : isReady ? (
                    <Text style={styles.tileReadyBadge}>✓ 조리완료</Text>
                  ) : anyCooking ? (
                    <Text style={styles.tileCookingBadge}>🔥 조리중</Text>
                  ) : null}
                  {isPaid && (
                    <Text style={styles.tilePaidBadge}>✓ 결제완료</Text>
                  )}
                  {!isReady && !anyCooking && !isPaid && (
                    <Text style={styles.tileQtyBadge}>{qty}개</Text>
                  )}
                  {overflowCount > 0 && (
                    <TouchableOpacity
                      style={styles.expandChip}
                      activeOpacity={0.7}
                      onPress={() => {
                        expandClickedAtRef.current = Date.now();
                        setExpandedTableId(readTableId);
                      }}
                      accessibilityLabel={`주문 ${order.items.length}종 전체보기`}
                    >
                      <Text style={styles.expandChipText}>
                        +{overflowCount} ▾
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
              {t.type === 'delivery' && deliveryAddr ? (
                <TouchableOpacity
                  onPress={() => {
                    const dk = normalizeAddressKey(deliveryAddr);
                    const de = dk ? addressBook?.entries?.[dk] : null;
                    setMapInfo({
                      storeCoord: typeof storeInfo?.lat === 'number'
                        ? { lat: storeInfo.lat, lng: storeInfo.lng } : null,
                      deliveries: [{
                        coord: typeof de?.lat === 'number' ? { lat: de.lat, lng: de.lng } : null,
                        addr: deliveryAddr,
                        label: t.label || t.id,
                        distanceLabel,
                      }],
                    });
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.deliveryAddr} numberOfLines={1}>
                    📍 {deliveryAddr}
                    {distanceLabel ? ` · ${distanceLabel}` : ''}
                    {' 🗺️'}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {(() => {
                const shown = order.items.slice(0, ITEMS_VISIBLE_LIMIT);
                // idx 를 key 에 합쳐 같은 i.id 다른 슬롯 (옛 데이터에 slotId 누락) 의 충돌 방지.
                const rendered = shown.flatMap((i, idx) => {
                  const lq = i.largeQty || 0;
                  const nq = i.qty - lq;
                  const tileHasLarge = order.items.some(
                    (x) => x.id === i.id && (x.largeQty || 0) > 0
                  );
                  const optLabels = (i.options || [])
                    .map((oid) =>
                      OPTIONS_CATALOG.find((o) => o.id === oid)
                    )
                    .filter((o) => o && !o.sizeGroup)
                    .map((o) => o.label);
                  const cookState = i.cookState || 'pending';
                  const hasBoth = lq > 0 && nq > 0;
                  const nState = hasBoth
                    ? i.cookStateNormal || cookState
                    : cookState;
                  const lState = hasBoth
                    ? i.cookStateLarge || cookState
                    : cookState;
                  const rows = [];
                  if (nq > 0) {
                    const itemCooked = nState === 'cooked';
                    const itemCooking = nState === 'cooking';
                    rows.push(
                      <View key={`${i.slotId || i.id}-${idx}-n`}>
                        {i.memo ? (
                          <Text
                            style={[styles.itemMemo, isSplitPart && styles.textTiny]}
                            numberOfLines={2}
                          >
                            📝 {i.memo}
                          </Text>
                        ) : null}
                        <View style={styles.orderItemRow}>
                          <Text
                            style={[
                              styles.orderItemName,
                              isSplitPart && styles.textTiny,
                              itemCooked && styles.itemCookedText,
                              itemCooking && styles.itemCookingText,
                            ]}
                            numberOfLines={1}
                          >
                            {i.name}
                            {tileHasLarge && (
                              <Text style={styles.normalTag}> 보통</Text>
                            )}
                            {itemCooked && (
                              <Text style={styles.itemCookedBadge}> ✓완료</Text>
                            )}
                            {itemCooking && (
                              <Text style={styles.itemCookingBadge}> 🔥조리중</Text>
                            )}
                            {optLabels.length > 0 && (
                              <Text style={styles.optTag}>
                                {' '}
                                [{optLabels.join(', ')}]
                              </Text>
                            )}
                          </Text>
                          <Text
                            style={[
                              styles.orderItemQty,
                              isSplitPart && styles.textTiny,
                            ]}
                          >
                            ×{nq}
                          </Text>
                        </View>
                      </View>
                    );
                  }
                  if (lq > 0) {
                    const itemCooked = lState === 'cooked';
                    const itemCooking = lState === 'cooking';
                    // 보통 행이 이미 메모를 표기했으면 중복 방지
                    const memoAlreadyShown = nq > 0;
                    rows.push(
                      <View key={`${i.slotId || i.id}-${idx}-l`}>
                        {i.memo && !memoAlreadyShown ? (
                          <Text
                            style={[styles.itemMemo, isSplitPart && styles.textTiny]}
                            numberOfLines={2}
                          >
                            📝 {i.memo}
                          </Text>
                        ) : null}
                        <View style={styles.orderItemRow}>
                          <Text
                            style={[
                              styles.orderItemName,
                              isSplitPart && styles.textTiny,
                              itemCooked && styles.itemCookedText,
                              itemCooking && styles.itemCookingText,
                            ]}
                            numberOfLines={1}
                          >
                            {i.name}
                            <Text style={styles.largeTag}> 대</Text>
                            {itemCooked && (
                              <Text style={styles.itemCookedBadge}> ✓완료</Text>
                            )}
                            {itemCooking && (
                              <Text style={styles.itemCookingBadge}> 🔥조리중</Text>
                            )}
                            {optLabels.length > 0 && (
                              <Text style={styles.optTag}>
                                {' '}
                                [{optLabels.join(', ')}]
                              </Text>
                            )}
                          </Text>
                          <Text
                            style={[
                              styles.orderItemQty,
                              isSplitPart && styles.textTiny,
                            ]}
                          >
                            ×{lq}
                          </Text>
                        </View>
                      </View>
                    );
                  }
                  return rows;
                });
                return <View style={styles.orderItemsList}>{rendered}</View>;
              })()}
            </View>
          ) : cartOnly ? (
            <View style={styles.tileOrderingWrap}>
              <Text style={styles.tileOrderingBadge}>🔒 주문중</Text>
              {isGrouped && (
                <Text style={styles.tileGroupBadge}>👥 단체</Text>
              )}
              <Text
                style={isSplitPart ? styles.tileLabelTiny : styles.tileLabel}
                numberOfLines={1}
              >
                {displayLabel}
              </Text>
            </View>
          ) : (
            <View style={styles.tileEmptyWrap}>
              {isGrouped && (
                <Text style={styles.tileGroupBadge}>👥 단체</Text>
              )}
              <Text
                style={isSplitPart ? styles.tileLabelTiny : styles.tileLabelEmpty}
                numberOfLines={1}
              >
                {displayLabel}
              </Text>
            </View>
          )}
        </View>

        {isPaid && (
          <TouchableOpacity
            style={styles.clearTableBtn}
            onPress={(e) => {
              e?.stopPropagation?.();
              clearTable(readTableId);
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.clearTableBtnText}>테이블 비우기</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );

    // 배달 카드 — 위 스와이프로 지도 열기 (PC 에서는 🗺️ 클릭)
    if (t.type === 'delivery') {
      const dKey = deliveryAddr ? normalizeAddressKey(deliveryAddr) : null;
      const dEntry = dKey ? addressBook?.entries?.[dKey] : null;
      const openMap = () =>
        setMapInfo({
          storeCoord: typeof storeInfo?.lat === 'number'
            ? { lat: storeInfo.lat, lng: storeInfo.lng } : null,
          deliveries: [{
            coord: typeof dEntry?.lat === 'number' ? { lat: dEntry.lat, lng: dEntry.lng } : null,
            addr: deliveryAddr,
            label: t.label || t.id,
            distanceLabel,
          }],
        });
      return (
        <DeliveryMapSwiper key={t.id} onSwipeUp={openMap}>
          {cardNode}
        </DeliveryMapSwiper>
      );
    }
    return <Fragment key={t.id}>{cardNode}</Fragment>;
  };

  return (
    <View style={styles.container}>
      {/* 서브탭 + 액션 버튼 */}
      <View style={[styles.topBar, isCompact && styles.topBarPhone]}>
        <View style={[styles.subTabs, isCompact && styles.subTabsPhone]}>
          {tableSubTabs.map((t) => {
            const active = subTab === t;
            return (
              <TouchableOpacity
                key={t}
                style={[styles.subTab, isCompact && styles.subTabPhone, active && styles.subTabActive]}
                onPress={() => setSubTab(t)}
              >
                <Text
                  style={[styles.subTabText, isCompact && styles.subTabTextPhone, active && styles.subTabTextActive]}
                >
                  {t}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={styles.actions}>
          {tableActions.map((a) => {
            const active =
              (a === '합석' && splitMode) ||
              (a === '자리이동' && moveMode !== null) ||
              (a === '단체' && groupMode);
            return (
              <TouchableOpacity
                key={a}
                style={[styles.actionBtn, isCompact && styles.actionBtnPhone, active && styles.actionBtnActive]}
                onPress={() => handleActionPress(a)}
              >
                <Text
                  style={[
                    styles.actionBtnText,
                    isCompact && styles.actionBtnTextPhone,
                    active && styles.actionBtnTextActive,
                  ]}
                >
                  {a}
                </Text>
              </TouchableOpacity>
            );
          })}
          {/* 전체 배달 지도 — 배달 테이블이 하나 이상 있을 때만 표시 */}
          {tables.some((t) => t.type === 'delivery') ? (
            <TouchableOpacity style={styles.allMapBtn} onPress={openAllDeliveryMap}>
              <Text style={styles.allMapBtnText}>🗺️ 배달지도</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.settingBtn}>
            <Text style={styles.settingIcon}>⚙</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 합석 안내 */}
      {splitMode && (
        <View style={styles.hintBar}>
          <Text style={styles.hintText}>
            나눌 테이블을 선택하세요 (이미 합석된 테이블 선택 시 다시 합쳐집니다)
          </Text>
        </View>
      )}

      {/* 자리이동 안내 */}
      {moveMode && (
        <View style={[styles.hintBar, styles.moveHint]}>
          <Text style={styles.moveHintText}>{moveMessage}</Text>
        </View>
      )}

      {/* 단체 안내 */}
      {groupMode && (
        <View style={[styles.hintBar, styles.groupHint]}>
          <Text style={styles.groupHintText}>
            {moveMessage || '단체로 묶을 테이블을 선택하세요 (2개 이상)'}
          </Text>
          {groupSelection.length > 0 && (
            <Text style={styles.groupHintSelected}>
              선택됨: {buildGroupLabel(groupSelection)} ({groupSelection.length}개)
            </Text>
          )}
        </View>
      )}

      {/* 5열 × 4행 그리드 — 변경 전 위치 보존.
          방/일반 11개는 1~3행 좌측에 고정.
          예약(2행 우측 2칸) / 포장(3행 우측 2칸) / 배달(4행 5칸 전체) 영역은 SlotStrip 으로
          묶어 baseCount 개 슬롯이 셀 위치에 fit 되고, 그보다 많아지면 가로 스와이프.
          정렬: 신규/조리중 우선 → 조리완료(ready) 는 영역 내에서 우측으로 밀림. */}
      {(() => {
        // 동적 슬롯 빌더
        const buildDynamicSlots = (type) => {
          const baseSlots = tables.filter((t) => t.type === type);
          const prefixEntry = Object.entries(DYNAMIC_SLOT_PREFIX).find(
            ([, v]) => v.type === type
          );
          if (!prefixEntry) return baseSlots;
          const [prefix, def] = prefixEntry;
          const baseIds = new Set(baseSlots.map((b) => b.id));
          const extraIds = Object.keys(orders || {})
            .map((id) => (id.includes('#') ? id.split('#')[0] : id))
            .filter(
              (id) =>
                id.startsWith(prefix) &&
                /^\d+$/.test(id.slice(prefix.length)) &&
                !baseIds.has(id)
            );
          const extras = Array.from(new Set(extraIds)).map((id) => ({
            id,
            label: `${def.labelPrefix}${id.slice(prefix.length)}`,
            type,
            dynamic: true,
          }));
          let all = [...baseSlots, ...extras];
          const isUsed = (t) => {
            const o = orders?.[t.id];
            if (o && (o.items?.length > 0 || o.cartItems?.length > 0))
              return true;
            const splitChildHas = Object.entries(orders || {}).some(
              ([oid, oo]) =>
                oid.startsWith(`${t.id}#`) &&
                ((oo.items?.length || 0) > 0 || (oo.cartItems?.length || 0) > 0)
            );
            return splitChildHas;
          };
          const allUsed = all.length > 0 && all.every(isUsed);
          if (allUsed) {
            const maxN = all.reduce((m, t) => {
              const n = parseInt(t.id.slice(prefix.length), 10);
              return Number.isNaN(n) ? m : Math.max(m, n);
            }, 0);
            all.push({
              id: `${prefix}${maxN + 1}`,
              label: `${def.labelPrefix}${maxN + 1}`,
              type,
              dynamic: true,
            });
          }
          all.sort((a, b) => {
            const ar = orders?.[a.id]?.status === 'ready' ? 1 : 0;
            const br = orders?.[b.id]?.status === 'ready' ? 1 : 0;
            return ar - br;
          });
          return all;
        };

        const reservationSlots = buildDynamicSlots('reservation');
        const takeoutSlots = buildDynamicSlots('takeout');
        const deliverySlots = buildDynamicSlots('delivery');

        // 슬롯 → 타일 (분할 처리 포함)
        const renderSlotItem = (t) => {
          if (isSplit(t.id)) {
            const parts = [1, 2].map((idx) => ({
              ...t,
              id: `${t.id}#${idx}`,
              label: `${t.label}-${idx}`,
              parentId: t.id,
            }));
            return (
              <View style={styles.splitSlot}>
                {parts.map((p) => renderTile(p, { isSplitPart: true }))}
              </View>
            );
          }
          return renderTile(t);
        };

        // 단일 일반 셀 (방) — 분할 슬롯 처리 포함, flex:1 로 행 안에서 균등 분배
        const renderRegularCell = (t) => {
          if (isSplit(t.id)) {
            const parts = [1, 2].map((idx) => ({
              ...t,
              id: `${t.id}#${idx}`,
              label: `${t.label}-${idx}`,
              parentId: t.id,
            }));
            return (
              <View key={t.id} style={[styles.splitSlot, { flex: 1 }]}>
                {parts.map((p) => renderTile(p, { isSplitPart: true }))}
              </View>
            );
          }
          return renderTile(t);
        };

        const tableById = Object.fromEntries(tables.map((t) => [t.id, t]));
        const reg = (id) => tableById[id];

        // 격자 정렬: 그리드 폭 측정 → 일반 셀 폭 = (W - 4*gap)/5,
        // SlotStrip 영역 폭 = N * cellW + (N-1) * gap
        // (행 안에 일반 셀 flex:1 + SlotStrip 고정폭 → 일반 셀이 남은 공간 균등 분배되어 정확히 cellW)
        const TOTAL_COLS = 5;
        const cellW =
          gridWidth > 0
            ? (gridWidth - (TOTAL_COLS - 1) * gridGap) / TOTAL_COLS
            : 0;
        const stripWidthFor = (n) =>
          cellW > 0 ? n * cellW + (n - 1) * gridGap : 0;

        return (
          <View
            style={[styles.grid, isCompact && styles.gridPhone]}
            onLayout={(e) => {
              const w = e.nativeEvent.layout.width;
              const padH = (isCompact ? 4 : 16) * 2;
              setGridWidth(Math.max(0, w - padH));
            }}
          >
            {/* Row 1: 07 08 09 방10 방11 */}
            <View style={[styles.gridRow, { gap: gridGap }]}>
              {['t07', 't08', 't09', 'r10', 'r11'].map((id) =>
                renderRegularCell(reg(id))
              )}
            </View>
            {/* Row 2: 04 05 06 [예약 영역 2칸] */}
            <View style={[styles.gridRow, { gap: gridGap }]}>
              {['t04', 't05', 't06'].map((id) => renderRegularCell(reg(id)))}
              <View style={[styles.stripCell, { width: stripWidthFor(2) }]}>
                {cellW > 0 && (
                  <SlotStrip
                    slots={reservationSlots}
                    renderItem={renderSlotItem}
                    baseCount={2}
                    gap={gridGap}
                  />
                )}
              </View>
            </View>
            {/* Row 3: 01 02 03 [포장 영역 2칸] */}
            <View style={[styles.gridRow, { gap: gridGap }]}>
              {['t01', 't02', 't03'].map((id) => renderRegularCell(reg(id)))}
              <View style={[styles.stripCell, { width: stripWidthFor(2) }]}>
                {cellW > 0 && (
                  <SlotStrip
                    slots={takeoutSlots}
                    renderItem={renderSlotItem}
                    baseCount={2}
                    gap={gridGap}
                  />
                )}
              </View>
            </View>
            {/* Row 4: [배달 영역 5칸 전체] */}
            <View style={[styles.gridRow, { gap: gridGap }]}>
              <View style={[styles.stripCell, { width: stripWidthFor(5) }]}>
                {cellW > 0 && (
                  <SlotStrip
                    slots={deliverySlots}
                    renderItem={renderSlotItem}
                    baseCount={5}
                    gap={gridGap}
                  />
                )}
              </View>
            </View>
          </View>
        );
      })()}

      {/* 주문 메뉴 전체보기 — RN <Modal> 대신 absolute 오버레이 (iOS new arch 호환성).
         어디를 터치하든 닫히도록 카드도 onPress=close 로 둔다 (정보 표시 전용 모달). */}
      {expandedTableId !== null && (
        <View style={styles.modalOverlay} pointerEvents="auto">
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setExpandedTableId(null)}
            accessibilityLabel="모달 닫기"
          >
            <Pressable
              style={styles.modalCard}
              onPress={() => setExpandedTableId(null)}
            >
              {(() => {
              if (expandedTableId == null) return null;
              const expTable = tables.find(
                (x) => x.id === expandedTableId
              );
              const expOrder = getOrder(expandedTableId);
              const expItems = expOrder?.items || [];
              const expTotal = getOrderTotal(expandedTableId);
              return (
                <>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>
                      {expTable?.label || '주문'} 주문 내역 ({expItems.length}종)
                    </Text>
                    <Text style={styles.modalCloseHint}>눌러서 닫기</Text>
                  </View>
                  <ScrollView
                    style={styles.modalBody}
                    contentContainerStyle={{ paddingBottom: 12 }}
                  >
                    {expItems.map((i, idx) => {
                      const lq = i.largeQty || 0;
                      const nq = (i.qty || 0) - lq;
                      const optLabels = (i.options || [])
                        .map((oid) =>
                          OPTIONS_CATALOG.find((o) => o.id === oid)
                        )
                        .filter((o) => o && !o.sizeGroup)
                        .map((o) => o.label);
                      const cookState = i.cookState || 'pending';
                      const hasBoth = lq > 0 && nq > 0;
                      const nState = hasBoth
                        ? i.cookStateNormal || cookState
                        : cookState;
                      const lState = hasBoth
                        ? i.cookStateLarge || cookState
                        : cookState;
                      const rows = [];
                      if (nq > 0) {
                        const itemCooked = nState === 'cooked';
                        const itemCooking = nState === 'cooking';
                        rows.push(
                          <View key={`${i.slotId || i.id}-${idx}-n`}>
                            {i.memo ? (
                              <Text style={styles.itemMemoModal} numberOfLines={2}>
                                📝 {i.memo}
                              </Text>
                            ) : null}
                            <View style={styles.modalItemRow}>
                              <Text
                                style={[
                                  styles.modalItemName,
                                  itemCooked && styles.itemCookedText,
                                  itemCooking && styles.itemCookingText,
                                ]}
                                numberOfLines={2}
                              >
                                {i.name}
                                {lq > 0 && (
                                  <Text style={styles.normalTag}> 보통</Text>
                                )}
                                {itemCooked && (
                                  <Text style={styles.itemCookedBadge}> ✓완료</Text>
                                )}
                                {itemCooking && (
                                  <Text style={styles.itemCookingBadge}> 🔥조리중</Text>
                                )}
                                {optLabels.length > 0 && (
                                  <Text style={styles.optTag}>
                                    {' '}
                                    [{optLabels.join(', ')}]
                                  </Text>
                                )}
                              </Text>
                              <Text style={styles.modalItemQty}>×{nq}</Text>
                              <Text style={styles.modalItemSubtotal}>
                                {((i.price || 0) * nq).toLocaleString()}
                              </Text>
                            </View>
                          </View>
                        );
                      }
                      if (lq > 0) {
                        const largeUnit =
                          (i.price || 0) + (i.sizeUpcharge || 0);
                        const itemCooked = lState === 'cooked';
                        const itemCooking = lState === 'cooking';
                        const memoAlreadyShown = nq > 0;
                        rows.push(
                          <View key={`${i.slotId || i.id}-${idx}-l`}>
                            {i.memo && !memoAlreadyShown ? (
                              <Text style={styles.itemMemoModal} numberOfLines={2}>
                                📝 {i.memo}
                              </Text>
                            ) : null}
                            <View style={styles.modalItemRow}>
                              <Text
                                style={[
                                  styles.modalItemName,
                                  itemCooked && styles.itemCookedText,
                                  itemCooking && styles.itemCookingText,
                                ]}
                                numberOfLines={2}
                              >
                                {i.name}
                                <Text style={styles.largeTag}> 대</Text>
                                {itemCooked && (
                                  <Text style={styles.itemCookedBadge}> ✓완료</Text>
                                )}
                                {itemCooking && (
                                  <Text style={styles.itemCookingBadge}> 🔥조리중</Text>
                                )}
                                {optLabels.length > 0 && (
                                  <Text style={styles.optTag}>
                                    {' '}
                                    [{optLabels.join(', ')}]
                                  </Text>
                                )}
                              </Text>
                              <Text style={styles.modalItemQty}>×{lq}</Text>
                              <Text style={styles.modalItemSubtotal}>
                                {(largeUnit * lq).toLocaleString()}
                              </Text>
                            </View>
                          </View>
                        );
                      }
                      return rows;
                    })}
                  </ScrollView>
                  <View style={styles.modalFooter}>
                    <Text style={styles.modalTotalLabel}>합계</Text>
                    <Text style={styles.modalTotalValue}>
                      {expTotal.toLocaleString()}원
                    </Text>
                  </View>
                </>
              );
            })()}
            </Pressable>
          </Pressable>
        </View>
      )}

      {paymentPicker ? (
        <PaymentMethodPicker
          total={paymentPicker.total}
          title={`${paymentPicker.label || '테이블'} 결제`}
          onClose={() => setPaymentPicker(null)}
          onSelect={(code, autoPrint) => {
            const picked = code === 'unspecified' ? null : code;
            const id = paymentPicker.tableId;
            // 결제 직전 receipt 데이터 캡처 — clearTable 후 order 사라지므로.
            const orderSnap = autoPrint ? getOrder(id) : null;
            const receiptData = autoPrint
              ? {
                  storeName: storeInfo?.name || 'MyPos',
                  tableId: id,
                  items: orderSnap?.items || [],
                  total: paymentPicker.total,
                  paymentMethod: picked,
                  paymentStatus: 'paid',
                  deliveryAddress: orderSnap?.deliveryAddress || '',
                  printedAt: Date.now(),
                }
              : null;
            setPaymentPicker(null);
            // 결제하기 = markPaid + clearTable 한 번에. 어제 추가된 흐름 그대로.
            markPaid(id, picked);
            clearTable(id, picked);
            // 자동 출력 — 비동기, 실패해도 결제 흐름 영향 X.
            if (receiptData) {
              printReceipt(receiptData).catch(() => {});
            }
          }}
        />
      ) : null}

      {/* 배달 지도 오버레이 — web 은 .js (iframe + Leaflet),
          폰은 .native.js (absolute overlay + WebView + Leaflet) 가 자동 선택됨.
          단일 배달: deliveries 배열 1개, 전체 배달 지도: 배열 N개. */}
      <DeliveryMapModal
        visible={!!mapInfo}
        onClose={() => setMapInfo(null)}
        storeCoord={mapInfo?.storeCoord}
        deliveries={mapInfo?.deliveries || []}
      />
    </View>
  );
}
