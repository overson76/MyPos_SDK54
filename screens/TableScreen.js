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
  resolveAnyTable,
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
import GroupPaymentSplitPicker from '../components/GroupPaymentSplitPicker';
import GroupModePicker from '../components/GroupModePicker';
import ReservationQuickModal from '../components/ReservationQuickModal';
import { printReceipt } from '../utils/printReceipt';
import { distanceKm, formatDistance } from '../utils/geocode';
import { normalizeAddressKey, computeItemsTotal } from '../utils/orderHelpers';
import { findEntryByPhone } from '../utils/addressBookLookup';
// 1.0.47: 예약/포장 카드에 시간 표기 — { h, m, period } 객체를 "오후 5:30" 한 줄로.
// 2026-05-27: deliveryTime 은 문자열("420") 로 저장 — parseDeliveryTime 으로 객체화 후 formatShort12h 호출.
import { formatShort12h, parseDeliveryTime } from '../utils/timeUtil';
import DeliveryMapSwiper from '../components/DeliveryMapSwiper';
import DeliveryMapModal from '../components/DeliveryMapModal';
import DeliveryRouteCard from '../components/DeliveryRouteCard';

export default function TableScreen({ onSelectTable, highlightTableId }) {
  const [subTab, setSubTab] = useState('기본홀');
  const [splitMode, setSplitMode] = useState(false);
  const [moveMode, setMoveMode] = useState(null); // null | 'source' | 'dest'
  const [moveSourceId, setMoveSourceId] = useState(null);
  const [moveMessage, setMoveMessage] = useState('');
  const [groupMode, setGroupMode] = useState(false);
  const [groupSelection, setGroupSelection] = useState([]);
  // 2026-05-21: 단체 묶기 모드 진입 시 선택된 결제/메뉴 모드 — 'shared' | 'split'
  // 사장님이 '단체' 버튼 누르면 GroupModePicker 모달 → 선택 → 이 state 에 저장 →
  // createGroup 호출 시 이 mode 가 전달됨. 한 번의 단체 묶기 동안 mode 유지.
  const [pendingGroupMode, setPendingGroupMode] = useState('shared');
  const [groupModePickerOpen, setGroupModePickerOpen] = useState(false);
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
  // { tableId, total, label, sourceTableId?, isSplit? } | null.
  // 선택 시 markPaid + clearTable (합산) 또는 clearTableBySource (분리).
  const [paymentPicker, setPaymentPicker] = useState(null);
  // 1.0.37: 단체 묶음 테이블 결제 시 합산/분리 선택 모달.
  // { tableId, members, subtotalsBySource, label } | null.
  const [groupSplitChoice, setGroupSplitChoice] = useState(null);
  // 분리 결제 진행 큐 — { tableId, remaining: string[], subtotals }.
  const [splitPayQueue, setSplitPayQueue] = useState(null);
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
  // 예약 빠른 등록 모달 — { tableId, label, partySize, time, isPM, hasMenu } | null (2026-06-04).
  const [reservationModal, setReservationModal] = useState(null);
  const [routeOptOpen, setRouteOptOpen] = useState(false);
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
    clearTableBySource,
    computeSubtotalsBySource,
    isSplit,
    toggleSplit,
    moveOrder,
    groups,
    createGroup,
    dissolveGroup,
    getGroupFor,
    markPaid,
    setReservationInfo,
    addressBook,
  } = useOrders();
  const { storeInfo } = useStore();
  const { optionsList: OPTIONS_CATALOG } = useMenu();

  // 배달 경로 최적화 후보 — table.type='delivery' + deliveryAddress 채워진 자리.
  // DeliveryRouteCard 가 안에서 addressBook entry 매칭 + 좌표 추출 처리하므로
  // 여기선 단순히 활성 배달 자리만 추림. (KitchenScreen 에서 이동, 2026-05-16)
  const activeDeliveriesForRoute = useMemo(() => {
    return tables
      .filter((t) => t.type === 'delivery')
      .map((t) => {
        const o = getOrder(t.id);
        if (!o?.deliveryAddress) return null;
        return {
          tableId: t.id,
          table: t,
          deliveryAddress: o.deliveryAddress,
        };
      })
      .filter(Boolean);
  }, [tables, orders, getOrder]);

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

  // 1.0.37: 결제하기 진입점 — 단체이면 합산/분리 선택 모달, 일반이면 즉시 결제수단.
  const startPayment = (tableId, totalAmount, label) => {
    payClickedAtRef.current = Date.now();
    const group = getGroupFor?.(tableId);
    if (group && group.memberIds && group.memberIds.length > 1) {
      const order = getOrder(tableId);
      const subtotals = computeSubtotalsBySource(
        order?.items || [],
        tableId
      );
      setGroupSplitChoice({
        tableId,
        members: group.memberIds,
        subtotalsBySource: subtotals,
        label,
      });
      return;
    }
    setPaymentPicker({ tableId, total: totalAmount, label });
  };

  // 분리 결제 시작 — 큐 만들고 첫 손님 PaymentMethodPicker 띄움.
  const handleSplitStart = () => {
    if (!groupSplitChoice) return;
    const { tableId, members, subtotalsBySource } = groupSplitChoice;
    // 소계 0 인 손님은 건너뜀 (시켜놓은 거 없음)
    const queue = members.filter((m) => (subtotalsBySource[m] || 0) > 0);
    setGroupSplitChoice(null);
    if (queue.length === 0) return;
    const first = queue[0];
    setSplitPayQueue({ tableId, remaining: queue, subtotals: subtotalsBySource });
    setPaymentPicker({
      tableId,
      sourceTableId: first,
      total: subtotalsBySource[first] || 0,
      label:
        (tables.find((tb) => tb.id === first)?.label || first) + ' 분리 결제',
      isSplit: true,
    });
  };

  // 합산 결제 — 기존 PaymentMethodPicker 흐름으로 진입.
  const handleSplitCombined = () => {
    if (!groupSplitChoice) return;
    const { tableId, label } = groupSplitChoice;
    const total = Object.values(groupSplitChoice.subtotalsBySource).reduce(
      (a, b) => a + (b || 0),
      0
    );
    setGroupSplitChoice(null);
    setPaymentPicker({ tableId, total, label });
  };

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
        setMoveMessage('단체를 해제했습니다 — 다시 묶으려면 테이블을 차례로 클릭하세요');
        return;
      }
      // split 된 테이블은 단체 묶기 대상에서 제외
      if (tableObj.parentId || isSplit(tableObj.id)) {
        setMoveMessage('합석된 테이블은 단체로 묶을 수 없습니다 (합석 먼저 해제)');
        return;
      }
      // 이미 선택된 테이블을 다시 클릭 → 선택 해제
      if (groupSelection.includes(tableObj.id)) {
        setMoveMessage('');
        setGroupSelection((prev) => prev.filter((x) => x !== tableObj.id));
        return;
      }
      // 2026-06-13: 사장님 요청 "단체 2테이블 한계 해제". 옛 코드는 2번째 클릭에서
      // 즉시 createGroup + 모드 종료 → 3개 이상 못 묶음. 클릭마다 누적만 하고
      // 확정은 [단체 확정(N)] 버튼이 담당 — 3·4·5… 테이블 묶기 가능.
      // (useGroups/reducer/분리결제는 처음부터 N명 지원 — UI 흐름만 한계였음)
      setMoveMessage('');
      setGroupSelection((prev) => [...prev, tableObj.id]);
      return;
    }
    if (moveMode === 'source') {
      const order = getOrder(tableObj.id);
      const hasAny =
        order.items.length > 0 || (order.confirmedItems || []).length > 0;
      if (!hasAny) {
        setMoveMessage('빈 테이블입니다 — 주문이 있는 테이블을 클릭하세요');
        return;
      }
      setMoveSourceId(tableObj.id);
      setMoveMode('dest');
      // 2026-06-13: 사장님 요청 — 단계별 사용법 유도 멘트 (1단계 → 2단계).
      setMoveMessage(
        `${tableObj.label} 선택됨 → 옮겨갈 빈 테이블을 클릭하세요`
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
        setMoveMessage('그 자리는 사용 중입니다 — 비어있는 테이블을 클릭하세요');
        return;
      }
      exitAllModes();
      return;
    }
    // 2026-05-21 사장님 룰: 단체 묶인 슬롯 클릭 — mode 별 분기
    //   shared (통합): leader 의 주문으로 이동 (옛 동작, 모든 멤버 같이 작업)
    //   split  (분리): 클릭한 슬롯 그대로 진입 (각자 자기 주문)
    const group = getGroupFor?.(tableObj.id);
    if (group) {
      const groupMode = group.mode || 'shared';
      if (groupMode === 'shared') {
        const leader = tables.find((tb) => tb.id === group.leaderId);
        if (leader) {
          onSelectTable?.({
            ...leader,
            id: group.leaderId,
            label: buildGroupLabel(group.memberIds),
            isGroup: true,
            memberIds: group.memberIds,
            groupMode,
          });
          return;
        }
      }
      // split 모드 — 클릭한 슬롯 그대로 (각자 메뉴/결제)
      onSelectTable?.({ ...tableObj, inGroup: true, groupMode });
      return;
    }
    // 예약 슬롯 + 메뉴 미확정 → 인원·시간 빠른 입력 모달 (메뉴 없이 예약 가능).
    // 2026-06-04 사장님 요청. 메뉴가 이미 담긴 예약은 기존처럼 주문 화면으로.
    if (tableObj.type === 'reservation') {
      const o = getOrder(tableObj.id);
      if ((o.confirmedItems || []).length === 0) {
        setReservationModal({
          tableId: tableObj.id,
          label: tableObj.label,
          partySize: o.partySize || 0,
          time: o.deliveryTime || '',
          isPM: o.deliveryTimeIsPM ?? true,
          hasMenu:
            (o.items || []).length > 0 || (o.cartItems || []).length > 0,
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
        setMoveMessage('이동할 주문이 있는 테이블을 클릭하세요');
      }
      return;
    }
    if (action === '단체') {
      if (groupMode) {
        // 단체 모드 종료 — 2개 이상 선택되어 있으면 단체 생성 (pendingGroupMode 적용)
        if (groupSelection.length >= 2) {
          createGroup?.(groupSelection, pendingGroupMode);
        }
        exitAllModes();
      } else {
        // 2026-05-21 사장님 룰: 단체 진입 시 [통합][분리] 모달 먼저 띄움.
        // 사장님 선택 → handleGroupModeSelect 가 setGroupMode(true) + pendingGroupMode 저장.
        exitAllModes();
        setGroupModePickerOpen(true);
      }
      return;
    }
  };

  const renderTile = (t, { isSplitPart = false } = {}) => {
    const borderColor = tableTypeColors[t.type];
    // 단체 — 이 테이블이 속한 단체 정보 (mode: 'shared' | 'split')
    const group = getGroupFor?.(t.id);
    const isGrouped = !!group;
    const groupMode = group?.mode || 'shared';
    // 2026-05-21 사장님 룰:
    //   - shared 모드 (통합): leader 의 order 를 양쪽 슬롯에서 동일하게 표시 (옛 동작)
    //   - split  모드 (분리): 각 슬롯이 자기 state 의 order — 메뉴/금액 각자 분리
    const readTableId =
      isGrouped && groupMode === 'shared' ? group.leaderId : t.id;
    const order = getOrder(readTableId);
    const total = getOrderTotal(readTableId);
    const qty = getOrderQty(readTableId);
    const hasOrder = (order.confirmedItems || []).length > 0;
    // 메뉴 없이 인원·시간만 잡은 예약 — 슬롯을 "예약됨" 으로 표시 (2026-06-04).
    const hasReservationInfo =
      t.type === 'reservation' &&
      !hasOrder &&
      ((order.partySize || 0) > 0 || !!order.deliveryTime);
    // 주문중 = 장바구니에 담긴 것이 있고 아직 주방(items)에 커밋 안 된 상태
    const cartOnly =
      (order.cartItems || []).length > 0 &&
      (order.items || []).length === 0;
    // 2026-05-21 사장님 룰: 발신자 정보만 있고 메뉴는 아직 안 담긴 상태 = "주문대기".
    // CID 자동 stash (10초 후) 또는 "주문받기" → OrderTypePicker → 슬롯 선택 흐름에서
    // 발신자 정보만 박힌 빈 슬롯. 직원이 클릭하면 OrderScreen 으로 진입 → 메뉴 담음.
    const isPendingCall =
      !hasOrder &&
      !cartOnly &&
      (!!order.deliveryAlias ||
        !!order.deliveryPhone ||
        !!order.deliveryAddress);
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
    // 2026-05-21: 전화 주문(배달/예약/포장) 모두 동일 우선순위 라벨.
    //   1순위: 별칭 (order.deliveryAlias 또는 주소록 entry.alias) — 👤
    //   2순위: 전화번호 (order.deliveryPhone 또는 주소록 entry.phone) — ☎
    //   3순위: 주소 (order.deliveryAddress) — 📍  ※ 배달만 의미있음
    const deliveryAliasFromOrder = order.deliveryAlias;
    const deliveryPhoneFromOrder = order.deliveryPhone;
    let deliveryAliasFromBook = null;
    let deliveryPhoneFromBook = null;
    let customerRequestFromBook = '';
    // 주소록 lookup — 배달은 주소 key 우선, 예약/포장은 주소 없으니 전화번호로.
    // 2026-06-04: 예약/포장도 배달처럼 주소록 별칭을 보여줌 (사장님: "배달→포장 자리이동
    //   하면 별칭이 사라진다 / 포장·예약도 배달표와 같은 식으로 움직여야"). 옛 코드는
    //   isDelivery 일 때만 조회해서 포장/예약 카드는 order.deliveryAlias 없으면 텅 비었음.
    if (deliveryAddr || deliveryPhoneFromOrder) {
      const key = deliveryAddr ? normalizeAddressKey(deliveryAddr) : null;
      let entry = key ? addressBook?.entries?.[key] : null;
      // 2026-05-29: 주소 key 로 못 찾으면 전화번호로 재시도 — CID phone-only 슬롯
      //   (deliveryAddr="(주소 미입력) ...") 에서 사장님이 그 번호에 별칭("아가맘")을
      //   저장한 entry 는 다른 key 라 주소 매칭이 실패. 전번으로 찾으면 별칭 잡힘.
      //   (사장님 신고 "아가맘 저장했는데 전번만 노출")
      if (!entry && deliveryPhoneFromOrder) {
        entry = findEntryByPhone(addressBook, deliveryPhoneFromOrder);
      }
      deliveryAliasFromBook = entry?.alias || null;
      deliveryPhoneFromBook = entry?.phone || null;
      customerRequestFromBook = (entry?.customerRequest || '').trim();
    }
    const deliveryAlias = deliveryAliasFromOrder || deliveryAliasFromBook;
    const deliveryPhone = deliveryPhoneFromOrder || deliveryPhoneFromBook;
    let deliveryPrimary = null;
    let deliveryIcon = null;
    if (deliveryAlias) {
      deliveryPrimary = deliveryAlias;
      deliveryIcon = '👤';
    } else if (deliveryPhone) {
      const d = String(deliveryPhone).replace(/\D/g, '');
      deliveryPrimary =
        d.length === 11 && d.startsWith('010')
          ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`
          : d.length === 10
          ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`
          : deliveryPhone;
      deliveryIcon = '☎';
    } else if (isDelivery && deliveryAddr) {
      // 예약/포장은 주소 없을 수 있음. 주소 fallback 은 배달만.
      deliveryPrimary = deliveryAddr;
      deliveryIcon = '📍';
    }
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
          (hasOrder || hasReservationInfo) ? styles.tileWithOrder : (isCompact ? styles.tileEmptyPhone : styles.tileEmpty),
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
                    // 버튼 안에 금액 함께 표시 — 버튼이 tileTopLeft 금액을 밀어낼 수 있어서
                    // 결제 금액이 안 보이는 문제 방지.
                    <TouchableOpacity
                      style={styles.tilePayBtn}
                      activeOpacity={0.7}
                      onPress={() => {
                        startPayment(
                          readTableId,
                          getOrderTotal(readTableId),
                          displayLabel
                        );
                      }}
                      accessibilityLabel={`${displayLabel} 결제하기`}
                    >
                      {total > 0 && (
                        <Text style={styles.tilePayBtnTotal}>
                          {total.toLocaleString()}원
                        </Text>
                      )}
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
                  {/* 1.0.23: 포장 결제완료 + 조리완료 시 "픽업 완료" 버튼 노출.
                      사장님 요청: 포장 선불 결제 후 슬롯 유지 → 손님 픽업 시 사장님이 명시 클릭. */}
                  {isPaid && isReady && t.type === 'takeout' ? (
                    <TouchableOpacity
                      style={styles.tilePickupBtn}
                      activeOpacity={0.7}
                      onPress={() => {
                        payClickedAtRef.current = Date.now();
                        clearTable(readTableId);
                      }}
                      accessibilityLabel="픽업 완료"
                    >
                      <Text style={styles.tilePickupBtnText}>📦 픽업 완료</Text>
                    </TouchableOpacity>
                  ) : null}
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
              {/* 배달 카드 — 별칭/전번/주소 라벨 + 지도 버튼 (주소 있을 때만 지도) */}
              {isDelivery && deliveryPrimary ? (
                <TouchableOpacity
                  onPress={() => {
                    if (!deliveryAddr) return;
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
                  disabled={!deliveryAddr}
                >
                  <Text style={styles.deliveryAddr} numberOfLines={1}>
                    {deliveryIcon} {deliveryPrimary}
                    {distanceLabel ? ` · ${distanceLabel}` : ''}
                    {deliveryAddr ? ' 🗺️' : ''}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {/* 2026-05-21: 예약/포장 — 별칭/전번 (있으면).
                  CID PENDING → submitPendingAsType 흐름으로 박힌 alias/phone 이 라이더가 아닌
                  *사장님 식별* 용으로 표시됨. */}
              {(t.type === 'reservation' || t.type === 'takeout') && deliveryPrimary ? (
                <Text style={styles.deliveryAddr} numberOfLines={1}>
                  {deliveryIcon} {deliveryPrimary}
                </Text>
              ) : null}
              {(() => {
                // 2026-05-27 (2차): 배달/예약/포장 *모두* 시간 표기. 사장님 요구.
                // KitchenScreen 카드와 같은 아이콘 (🛵/📅/📦) 으로 시각 일관성.
                // deliveryTime 은 "420" 같은 문자열 — parseDeliveryTime 으로 객체화 후
                // formatShort12h. 문자열 직접 넘기면 parsed.m.toString() 폭발 (사고 2026-05-27).
                const tp = t.type;
                if (tp !== 'delivery' && tp !== 'reservation' && tp !== 'takeout') return null;
                if (!order.deliveryTime) return null;
                const parsedTime = parseDeliveryTime(
                  order.deliveryTime,
                  order.deliveryTimeIsPM ?? true,
                );
                if (!parsedTime) return null;
                const icon = tp === 'delivery' ? '🛵' : tp === 'reservation' ? '📅' : '📦';
                return (
                  <Text style={styles.deliveryAddr} numberOfLines={1}>
                    {icon} {formatShort12h(parsedTime)}
                  </Text>
                );
              })()}
              {customerRequestFromBook ? (
                <Text style={styles.deliveryRequest} numberOfLines={1}>
                  🌟 {customerRequestFromBook}
                </Text>
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
          ) : isPendingCall ? (
            <View style={styles.tilePendingCallWrap}>
              <Text style={styles.tilePendingCallBadge}>🕐 주문대기</Text>
              <Text
                style={isSplitPart ? styles.tileLabelTiny : styles.tileLabel}
                numberOfLines={1}
              >
                {displayLabel}
              </Text>
              {deliveryPrimary ? (
                <Text style={styles.tilePendingCallLabel} numberOfLines={1}>
                  {deliveryIcon} {deliveryPrimary}
                </Text>
              ) : null}
            </View>
          ) : hasReservationInfo ? (
            <View style={styles.tilePendingCallWrap}>
              <Text style={styles.tileReservationBadge}>📅 예약</Text>
              <Text
                style={isSplitPart ? styles.tileLabelTiny : styles.tileLabel}
                numberOfLines={1}
              >
                {displayLabel}
              </Text>
              {(order.partySize || 0) > 0 ? (
                <Text style={styles.tileReservationInfo} numberOfLines={1}>
                  👥 {order.partySize}명
                </Text>
              ) : null}
              {order.deliveryTime
                ? (() => {
                    const pt = parseDeliveryTime(
                      order.deliveryTime,
                      order.deliveryTimeIsPM ?? true,
                    );
                    return pt ? (
                      <Text style={styles.tileReservationInfo} numberOfLines={1}>
                        📅 {formatShort12h(pt)}
                      </Text>
                    ) : null;
                  })()
                : null}
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
            // 2026-06-13: 모드 활성 중엔 버튼이 "다음 행동" 을 말하게 — 단체는
            // 2개 이상 선택 시 [단체 확정(N)] 으로 바뀌어 확정 버튼 역할.
            let label = a;
            if (a === '단체' && groupMode) {
              label =
                groupSelection.length >= 2
                  ? `단체 확정(${groupSelection.length})`
                  : '단체 종료';
            } else if (active) {
              label = `${a} 종료`;
            }
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
                  {label}
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
          {/* 배달 경로 최적화 — 활성 배달 2건 이상일 때만 (2026-05-16: KitchenScreen 에서 이동) */}
          {activeDeliveriesForRoute.length >= 2 ? (
            <TouchableOpacity
              style={styles.routeOptBtn}
              onPress={() => setRouteOptOpen(true)}
            >
              <Text style={styles.routeOptBtnText}>🛵 배달경로</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.settingBtn}>
            <Text style={styles.settingIcon}>⚙</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 합석 안내 — 2026-06-13 사장님 요청: 사용법 유도 멘트 */}
      {splitMode && (
        <View style={styles.hintBar}>
          <Text style={styles.hintText}>
            합석할 테이블을 클릭하세요 — 한 테이블이 2칸으로 나뉩니다 (이미
            합석된 테이블을 클릭하면 다시 합칩니다)
          </Text>
        </View>
      )}

      {/* 자리이동 안내 */}
      {moveMode && (
        <View style={[styles.hintBar, styles.moveHint]}>
          <Text style={styles.moveHintText}>{moveMessage}</Text>
        </View>
      )}

      {/* 단체 안내 — 선택 단계별 다음 행동 유도. 해제/오류 안내(moveMessage)가 우선. */}
      {groupMode && (
        <View style={[styles.hintBar, styles.groupHint]}>
          <Text style={styles.groupHintText}>
            {moveMessage ||
              (groupSelection.length === 0
                ? '단체로 묶을 테이블을 차례로 클릭하세요 (2개 이상)'
                : groupSelection.length === 1
                ? '계속해서 함께 묶을 테이블을 클릭하세요 (다시 클릭하면 해제)'
                : `${groupSelection.length}개 선택됨 — 더 클릭해 추가하거나, 위 [단체 확정] 버튼을 누르면 묶입니다`)}
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
          onClose={() => {
            // 분리 결제 진행 중에 취소 누르면 큐도 함께 해제
            setPaymentPicker(null);
            setSplitPayQueue(null);
          }}
          onSelect={(code, opts) => {
            const { autoPrint, kisApproval } = opts || {};
            const picked = code === 'unspecified' ? null : code;
            const id = paymentPicker.tableId;
            const isSplit = paymentPicker.isSplit;
            const srcId = paymentPicker.sourceTableId;
            // 결제 직전 receipt 데이터 캡처 — 결제 후 order 변경 / 사라짐.
            const orderSnap = autoPrint ? getOrder(id) : null;
            // 1.0.37: 분리 결제면 해당 sourceTable 슬롯만, 합산이면 전체.
            const itemsForReceipt = autoPrint
              ? (orderSnap?.items || []).filter((it) =>
                  isSplit && srcId
                    ? (it.sourceTableId || id) === srcId
                    : true
                )
              : [];
            const itemsWithLabels = itemsForReceipt.map((it) => ({
              ...it,
              optionLabels: (it.options || [])
                .map((oid) => OPTIONS_CATALOG.find((opt) => opt.id === oid)?.label)
                .filter(Boolean),
            }));
            const resolvedTbl = autoPrint ? resolveAnyTable(id) : null;
            // 2026-05-28: 영수증 시간/타입 누락 fix — 빌더가 orderType 없으면 reservation/takeout
            // 의 예약/픽업시각을 절대 안 찍음. delivery 의 출발시각도 같이 누락. 모든 타입에
            // 시간/메타 풀세트 전달.
            const baseIdForType = String(id || '').split('#')[0];
            const tblForType = autoPrint ? resolveAnyTable(baseIdForType) : null;
            const orderType = tblForType?.type || resolvedTbl?.type || 'regular';
            const addrKey = autoPrint && orderSnap?.deliveryAddress
              ? normalizeAddressKey(orderSnap.deliveryAddress)
              : null;
            const addrEntry = addrKey ? addressBook?.entries?.[addrKey] : null;
            const receiptData = autoPrint
              ? {
                  storeName: storeInfo?.name || 'MyPos',
                  storePhone: storeInfo?.phone || '',
                  storeAddress: storeInfo?.address || '',
                  businessNumber: storeInfo?.businessNumber || '',
                  receiptFooter: storeInfo?.receiptFooter || '',
                  tableId: id,
                  tableLabel: resolvedTbl?.label || id,
                  items: itemsWithLabels,
                  total: paymentPicker.total,
                  paymentMethod: picked,
                  paymentStatus: 'paid',
                  deliveryAddress: orderSnap?.deliveryAddress || '',
                  kisApproval: kisApproval || null,
                  printedAt: Date.now(),
                  orderType,
                  scheduledTime: orderSnap?.deliveryTime || '',
                  scheduledTimeIsPM: orderSnap?.deliveryTimeIsPM ?? true,
                  // 2026-05-28: order fallback — entry 누락/phone 빈 케이스 방어.
                  customerAlias: addrEntry?.alias || orderSnap?.deliveryAlias || '',
                  customerPhone: addrEntry?.phone || orderSnap?.deliveryPhone || '',
                  drivingDistanceM:
                    typeof addrEntry?.drivingM === 'number'
                      ? addrEntry.drivingM
                      : null,
                  drivingDurationSec:
                    typeof addrEntry?.drivingDurationSec === 'number'
                      ? addrEntry.drivingDurationSec
                      : null,
                  // 1.0.38: 분리 결제 — 영수증 빌더가 "👤 손님" 줄 추가.
                  isSplit: !!isSplit,
                  sourceTableId: srcId || null,
                  sourceTableLabel: srcId
                    ? tables.find((tb) => tb.id === srcId)?.label || srcId
                    : null,
                }
              : null;

            if (isSplit && srcId) {
              // 1.0.37: 분리 결제 — 해당 손님 슬롯만 정리 + 다음 손님으로
              setPaymentPicker(null);
              clearTableBySource(id, srcId, picked);
              if (receiptData) printReceipt(receiptData).catch(() => {});
              // 다음 손님 진행
              const queue = splitPayQueue;
              const nextRemaining = (queue?.remaining || []).slice(1);
              if (nextRemaining.length > 0) {
                const nextSrc = nextRemaining[0];
                setSplitPayQueue({ ...queue, remaining: nextRemaining });
                const nextLabel =
                  tables.find((tb) => tb.id === nextSrc)?.label || nextSrc;
                setPaymentPicker({
                  tableId: id,
                  sourceTableId: nextSrc,
                  total: queue.subtotals[nextSrc] || 0,
                  label: nextLabel + ' 분리 결제',
                  isSplit: true,
                });
              } else {
                setSplitPayQueue(null);
              }
              return;
            }

            // 합산 결제 — 기존 흐름
            setPaymentPicker(null);
            markPaid(id, picked);
            clearTable(id, picked);
            if (receiptData) printReceipt(receiptData).catch(() => {});
          }}
        />
      ) : null}

      {/* 2026-05-21: 단체 묶기 시 [통합][분리] 모드 선택 모달 */}
      <GroupModePicker
        open={groupModePickerOpen}
        memberLabels={[]}
        onSelect={(mode) => {
          setGroupModePickerOpen(false);
          setPendingGroupMode(mode);
          setGroupMode(true);
          setGroupSelection([]);
          // 첫 테이블 클릭 시 handleTilePress 가 비워서 단계별 안내로 전환.
          setMoveMessage(
            mode === 'shared'
              ? '🔗 통합 모드 — 함께 묶을 테이블을 차례로 클릭하세요 (2개 이상)'
              : '✂️ 분리 모드 — 함께 묶을 테이블을 차례로 클릭하세요 (2개 이상)'
          );
        }}
        onClose={() => setGroupModePickerOpen(false)}
      />

      {/* 1.0.37: 단체 묶음 테이블 결제 — 합산/분리 선택 모달 */}
      <GroupPaymentSplitPicker
        open={!!groupSplitChoice}
        members={groupSplitChoice?.members || []}
        subtotalsBySource={groupSplitChoice?.subtotalsBySource || {}}
        onChooseCombined={handleSplitCombined}
        onChooseSplit={handleSplitStart}
        onClose={() => setGroupSplitChoice(null)}
      />

      {/* 배달 지도 오버레이 — web 은 .js (iframe + Leaflet),
          폰은 .native.js (absolute overlay + WebView + Leaflet) 가 자동 선택됨.
          단일 배달: deliveries 배열 1개, 전체 배달 지도: 배열 N개. */}
      <DeliveryMapModal
        visible={!!mapInfo}
        onClose={() => setMapInfo(null)}
        storeCoord={mapInfo?.storeCoord}
        deliveries={mapInfo?.deliveries || []}
      />

      {/* 예약 빠른 등록 — 빈 예약 슬롯 탭 시. 메뉴 없이 인원·시간만 (2026-06-04). */}
      <ReservationQuickModal
        visible={!!reservationModal}
        tableLabel={reservationModal?.label || ''}
        initialPartySize={reservationModal?.partySize || 0}
        initialTime={reservationModal?.time || ''}
        initialIsPM={reservationModal?.isPM ?? true}
        hasMenu={reservationModal?.hasMenu}
        onCancel={() => setReservationModal(null)}
        onSubmit={({ partySize, time, isPM, alsoMenu }) => {
          const tid = reservationModal?.tableId;
          if (!tid) {
            setReservationModal(null);
            return;
          }
          setReservationInfo(tid, { partySize, time, isPM });
          setReservationModal(null);
          if (alsoMenu) {
            const tobj = resolveAnyTable(tid);
            if (tobj) onSelectTable?.(tobj);
          }
        }}
      />

      {/* 배달 경로 최적화 모달 — 2026-05-16 KitchenScreen 에서 이동.
          DeliveryRouteCard 컴포넌트 그대로 모달 sheet 안에 마운트.
          AddressBookModal 의 안전 패턴 적용 (Pressable backdrop + sheet onPress 차단). */}
      {routeOptOpen && (
        <View style={styles.routeOverlay} pointerEvents="auto">
          <Pressable
            style={styles.routeBackdrop}
            onPress={() => setRouteOptOpen(false)}
          >
            <Pressable style={styles.routeSheet} onPress={() => {}}>
              <View style={styles.routeHeader}>
                <Text style={styles.routeHeaderTitle}>🛵 배달 경로 최적화</Text>
                <TouchableOpacity
                  onPress={() => setRouteOptOpen(false)}
                  hitSlop={8}
                >
                  <Text style={styles.routeHeaderClose}>닫기</Text>
                </TouchableOpacity>
              </View>
              <DeliveryRouteCard
                activeOrders={activeDeliveriesForRoute}
                storeInfo={storeInfo}
                addressBook={addressBook}
              />
            </Pressable>
          </Pressable>
        </View>
      )}
    </View>
  );
}
