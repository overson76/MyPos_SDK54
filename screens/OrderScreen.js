import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ImageBackground,
  Keyboard,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import makeStyles from './OrderScreen.styles';
import { categories } from '../utils/menuData';
import { useMenu } from '../utils/MenuContext';
import { useOrders, PENDING_TABLE_ID } from '../utils/OrderContext';
import {
  computeRecommendations,
  recommendationsToGrid,
  RECOMMENDATION_CATEGORY,
} from '../utils/recommendations';
import { getCustomerRequest } from '../utils/addressBookLookup';
import AddressBookModal from '../components/AddressBookModal';
import AddressChips from '../components/AddressChips';
import PaymentMethodPicker from '../components/PaymentMethodPicker';
import MenuQuickEditModal from '../components/MenuQuickEditModal';
import TableSourcePicker from '../components/TableSourcePicker';
import GroupPaymentSplitPicker from '../components/GroupPaymentSplitPicker';
import { useStore } from '../utils/StoreContext';
import { printReceipt } from '../utils/printReceipt';
import { distanceKm, formatDistance, geocodeAddress } from '../utils/geocode';
import { normalizeAddressKey } from '../utils/orderHelpers';
import { resolveAnyTable } from '../utils/tableData';
import {
  playChangeSound,
  playOrderSound,
  speakOrder,
  speakOrderChange,
} from '../utils/notify';
import { computeDiffRows } from '../utils/orderDiff';
import { useResponsive } from '../utils/useResponsive';
import { formatShort12h, parseDeliveryTime } from '../utils/timeUtil';
import {
  createRecognition,
  getVoiceUnsupportedMessage,
  isVoiceInputSupported,
  parseVoiceOrder,
} from '../utils/voice';
import { reportError } from '../utils/sentry';

export default function OrderScreen({
  table,
  onBack,
  onGoToTables,
  onRequestOrderWithTable,
  autoConfirmIntent,
  clearAutoConfirmIntent,
}) {
  // 컴포넌트 전체에서 사용하는 web 여부 — JSX 평가 시점 ReferenceError 방지를 위해
  // 함수 상단에 한 번 정의. 26a620a 가 line 817 에서 !isWeb 사용 추가했는데
  // 정의는 IIFE 콜백 안에만 있어 native 폰에서 OrderScreen 마운트 즉시 크래시했음.
  const isWeb = Platform.OS === 'web';
  const [activeCategory, setActiveCategory] = useState('즐겨찾기');
  const [listening, setListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const recognitionRef = useRef(null);
  const voiceSupported = isVoiceInputSupported();
  const [sizePrompt, setSizePrompt] = useState(null);
  // 주문 탭에서 주문 클릭 → 테이블 선택 시 자동 확정 흐름.
  // intent 가 들어오면 migratePendingCart 가 끝난 다음 렌더에서 cart 가 비어있지 않으면 자동 확정.
  const [pendingAutoConfirm, setPendingAutoConfirm] = useState(false);
  // 메모 입력 프롬프트 — { slotId, value }
  const [memoPrompt, setMemoPrompt] = useState(null);
  // 옵션 편집 모달 표시
  const [optionsEditOpen, setOptionsEditOpen] = useState(false);
  const [addressBookOpen, setAddressBookOpen] = useState(false);
  const [addressFocused, setAddressFocused] = useState(false);
  // 결제수단 선택 모달 — { mode: 'prepaid' | 'postpaid', tableId, total,
  //   sourceTableId?, isSplit? } | null
  // 선불/후불 버튼이 누르면 모달 띄움 → 사용자 결제수단 선택 → markPaid/clearTable 호출.
  // 1.0.37: 단체 묶음 후불은 GroupPaymentSplitPicker 가 먼저 띄워짐 → 분리 선택 시
  // 큐 방식으로 손님별 PaymentMethodPicker 가 순차 띄워짐.
  const [paymentPicker, setPaymentPicker] = useState(null);
  // 1.0.37: 단체 묶음 후불 결제 — 합산/분리 선택 모달
  const [groupSplitChoice, setGroupSplitChoice] = useState(null);
  // 분리 결제 진행 큐 — { tableId, remaining: string[], subtotals }
  const [splitPayQueue, setSplitPayQueue] = useState(null);
  // 퀵에디트 모달 — 메뉴 타일 꾹 누르면 { id, name, price } 세팅
  const [quickEditItem, setQuickEditItem] = useState(null);
  // 1.0.26: 메뉴 인라인 편집 모드 — ON 시 빈 [+] 슬롯 + 메뉴 카드 [⋮] 액션 노출.
  const [editMode, setEditMode] = useState(false);
  // 빈 슬롯 클릭 시 신규 추가 위치 캡처 — { category, flatIndex }
  const [menuAddTarget, setMenuAddTarget] = useState(null);
  const { storeInfo } = useStore();
  // sizePrompt = { items: [...], index: 0, sizeOption, value }
  const {
    width: _screenW,
    height: _screenH,
    isPortrait: _screenIsPortrait,
    scale,
  } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);
  // 실제 컨테이너 크기 — SafeAreaView/노치(아이폰 Pro Max 가로 등)가 useWindowDimensions 보다
  // 좁아지므로 onLayout 으로 측정한 실측치를 우선 사용해 6번째 메뉴 타일이 카트 영역으로
  // 흘러나오는 문제를 방지.
  const [layoutSize, setLayoutSize] = useState({ w: 0, h: 0 });
  const width = layoutSize.w || _screenW;
  const height = layoutSize.h || _screenH;
  const isXS = width < 600;
  const isSM = width >= 600 && width < 900;
  const isMD = width >= 900 && width < 1200;
  const isPortrait =
    layoutSize.w && layoutSize.h ? height >= width : _screenIsPortrait;
  // 컴팩트(폰 + 작은 태블릿) 감지 — 높이나 너비가 작으면 컴팩트 레이아웃 적용
  const isCompact = width < 1200 || height < 700;
  const isPhone = isCompact; // 기존 폰 스타일 재사용
  // 주문 탭(테이블 미선택)에서도 동일한 메뉴 그리드 비율을 유지하기 위해 헤더는 항상 표시.
  const showTableHeader = true;
  // 좁은 세로(폰 세로)만 세로 스택. 폰 가로는 side-by-side 유지하되 카트를 좁게.
  const stacked = isXS && isPortrait;
  // 화면 비율 기반 — 메뉴 영역과 겹치지 않으면서 빈공간 최소화하는 균형점.
  const cartWidth = stacked
    ? width
    : Math.floor(
        width *
          (isCompact ? 0.30 : isSM ? 0.27 : isMD ? 0.23 : 0.21)
      );
  const menuCols = isCompact ? 4 : isMD ? 5 : 6;
  const menuTilePad = isCompact ? 3 : 10;
  const menuTileGap = isCompact ? 3 : 8;
  // 메뉴 마지막 열과 카트 좌측 경계 사이 시각적 간극 — 타일이 카트에 붙어 보이는 것 방지.
  const menuCartGap = stacked ? 0 : isCompact ? 8 : 16;
  const menuAreaWidth = stacked ? width : width - cartWidth;
  const _menuAreaForGrid = Math.max(0, menuAreaWidth - menuCartGap);
  // 열 분배 기준 타일 폭 (상한) — 열수만큼 정확히 나눈 값
  const _tileWidthMax = Math.floor(
    (_menuAreaForGrid - menuTilePad * 2 - menuTileGap * (menuCols - 1)) / menuCols
  );
  // 가용 메뉴 영역 높이 계산 — 이 값은 실제 행수와 함께
  // 타일 높이를 동적으로 결정하여 한 화면에 모든 행이 들어가도록 함.
  // 상단 탭 + 테이블헤더(있다면) + 카테고리바 + 옵션 패널 높이 합
  //  - 컴팩트(가로모드 폰): App탭(≈36) + 카테고리바(≈32) + 옵션패널(≈90~110) ≈ 170
  //  - 일반(태블릿/PC): 좀 더 여유
  // 헤더는 항상 표시되므로 reserved 에 항상 포함 — 주문탭/테이블탭 비율 통일.
  // 배달 테이블에선 헤더에 입력+칩+시간이 모두 들어가 한 줄이 약간 길어짐.
  // 별도 deliveryBar 영역은 제거됨. 메뉴 영역은 항상 동일한 reserved 로 고정.
  const tableHeaderH = isCompact ? 32 : 42;
  const reservedHeightForMenu = (isCompact ? 170 : 220) + tableHeaderH;
  const availMenuH = Math.max(120, height - reservedHeightForMenu);

  const {
    getOrder,
    getOrderTotal,
    getCartTotal,
    getCartQty,
    addItem,
    removeItem,
    clearTable,
    markPaid,
    confirmOrder,
    toggleOption,
    toggleItemOption,
    incrementSlotQty,
    splitOffWithOptionToggle,
    setDeliveryAddress,
    setDeliveryTime,
    setDeliveryTimeIsPM,
    setPhone,
    setItemLargeQty,
    setItemMemo,
    migratePendingCart,
    clearPendingCart,
    submitPendingAsDelivery,
    addressBook,
    addAddress,
    getGroupFor,
    clearTableBySource,
    computeSubtotalsBySource,
    revenue,
  } = useOrders();

  const genSlotId = () =>
    `s-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  // rowKey = `${slotId}#${portion}`  (portion: 'only' | 'normal' | 'large')
  const [selectedRowKey, setSelectedRowKey] = useState(null);
  const selectedSlotId = selectedRowKey
    ? selectedRowKey.split('#')[0]
    : null;

  // 1.0.36: 단체(group, 묶음) 손님 선택 모달. leader 테이블에 메뉴 추가 시
  // 어느 손님 거인지 받아서 sourceTableId 박음. lastSourceByGroup 으로 마지막
  // 선택 기억 — 같은 손님 연속 추가가 보통이라 자동 적용 + 변경 가능.
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [groupPickerMembers, setGroupPickerMembers] = useState([]);
  const [pendingMenuItem, setPendingMenuItem] = useState(null);
  const [pendingMenuSlotId, setPendingMenuSlotId] = useState(null);
  const [pendingMenuHasLarge, setPendingMenuHasLarge] = useState(false);
  const [lastSourceByGroup, setLastSourceByGroup] = useState({}); // { leaderId: sourceTableId }
  const {
    items: menuItems,
    rows: categoryRows,
    setCategorySlot,
    optionsList: options,
    editableOptions,
    updateOptionLabel,
    moveOption,
    resetEditableOptions,
  } = useMenu();
  const [dragFromIdx, setDragFromIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  // 폰(native) 전용 메뉴 이동 모드 — 웹은 draggable div 로 처리.
  // 1.0.24: longPress 진입 → 그대로 손가락 드래그 → 손 떼면 swap (PC 와 동일 UX).
  // 손가락 떼버린 fallback 으로 다른 타일 탭 패턴도 같이 동작.
  const [nativeMoveFromIdx, setNativeMoveFromIdx] = useState(null);
  // PanResponder 가 hit-test 할 때 쓸 grid 컨테이너의 절대 좌표 (window 기준 pageX/pageY).
  const gridLayoutRef = useRef(null);
  // 1.0.29: View 직접 ref — 폰(RN native) 의 measureInWindow 호출용. e.target 은 폰에서
  // number(reactTag) 라 measureInWindow 메서드 X — 그래서 ref 직접 받기.
  const gridViewRef = useRef(null);
  // 1.0.26: 즐겨찾기 탭의 절대 좌표 — drag-drop 시 hit-test 용.
  const favTabLayoutRef = useRef(null);
  const favTabViewRef = useRef(null);
  // 드래그 중 손가락 위치 (overlay 표시용 — 카드 따라다니는 ghost). null 이면 표시 X.
  const [dragFingerPos, setDragFingerPos] = useState(null);
  // PanResponder 안에서 최신 nativeMoveFromIdx / dragOverIdx 참조용 (closure stale 방지).
  const moveFromRef = useRef(null);
  const dragOverRef = useRef(null);
  useEffect(() => { moveFromRef.current = nativeMoveFromIdx; }, [nativeMoveFromIdx]);
  useEffect(() => { dragOverRef.current = dragOverIdx; }, [dragOverIdx]);
  // === 메뉴 그리드 크기 계산 ===
  // 모든 카테고리는 6열 × 4행 고정 격자. 빈 슬롯은 placeholder 로 표시되고,
  // 사용자가 드래그로 자유롭게 위치 이동 가능.
  const GRID_COLS = 6;
  const GRID_ROWS = 4;
  const menuRowCount = GRID_ROWS;
  // min-clamp 없이 계산된 실제 행 높이 — 가로 비율 상한 계산에 사용.
  const _rawTileHeight = Math.floor(
    (availMenuH - menuTileGap * (menuRowCount + 1)) / menuRowCount
  );
  const menuTileHeight = Math.max(48, _rawTileHeight);
  // 가로는 6등분 가득. 단, 세로가 너무 짧아 타일이 가로로 과하게 찌그러지는 걸
  // 막기 위해 width/height 비를 1.8 이하로 상한.
  const TILE_MAX_ASPECT = 1.8;
  const _gridTileWidth = Math.floor(
    (_menuAreaForGrid - menuTilePad * 2 - menuTileGap * (GRID_COLS - 1)) / GRID_COLS
  );
  const menuTileWidth = Math.min(
    _gridTileWidth,
    Math.round(Math.max(24, _rawTileHeight) * TILE_MAX_ASPECT)
  );

  // 1.0.24: 폰 메뉴 드래그 PanResponder — longPress 진입 후 손가락 떼지 않고 그대로
  // 드래그 → 손 떼면 swap. PC 의 HTML5 drag-and-drop 과 동일한 UX.
  // - nativeMoveFromIdx 가 set 됐을 때만 활성 (longPress 진입 후)
  // - onPanResponderMove 에서 손가락 위치 → cell hit-test → setDragOverIdx
  // - onPanResponderRelease 에서 dragOverIdx 가 valid 면 setCategorySlot 호출
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => moveFromRef.current !== null,
        onStartShouldSetPanResponderCapture: () => moveFromRef.current !== null,
        onMoveShouldSetPanResponder: () => moveFromRef.current !== null,
        onMoveShouldSetPanResponderCapture: () => moveFromRef.current !== null,
        // 1.0.29: 모든 핸들러에 try/catch + Sentry — 폰 crash 차단 + 정확한 stack 캡처.
        onPanResponderGrant: (e) => {
          try {
            const { pageX, pageY } = e.nativeEvent;
            setDragFingerPos({ x: pageX, y: pageY });
            hitTestAndUpdate(pageX, pageY);
          } catch (err) {
            try { reportError(err, { ctx: 'panResponder.grant' }); } catch {}
          }
        },
        onPanResponderMove: (e) => {
          try {
            const { pageX, pageY } = e.nativeEvent;
            setDragFingerPos({ x: pageX, y: pageY });
            hitTestAndUpdate(pageX, pageY);
          } catch (err) {
            try { reportError(err, { ctx: 'panResponder.move' }); } catch {}
          }
        },
        onPanResponderRelease: () => {
          try {
            const from = moveFromRef.current;
            const to = dragOverRef.current;
            if (from !== null && to === 'FAV_TAB') {
              // 1.0.26: 즐겨찾기 탭에 drop → toggleFavorite (이미 즐겨찾기면 무시).
              const flat = Array.isArray(currentRows) ? currentRows.flat() : [];
              const menuId = flat[from];
              if (menuId != null && typeof toggleFavorite === 'function') {
                toggleFavorite(menuId);
              }
            } else if (
              from !== null &&
              to !== null &&
              typeof to === 'number' &&
              from !== to &&
              typeof setCategorySlot === 'function'
            ) {
              setCategorySlot(activeCategory, from, to);
            }
          } catch (err) {
            try { reportError(err, { ctx: 'panResponder.release' }); } catch {}
          }
          // 정리 — 어떤 케이스든 실행
          setNativeMoveFromIdx(null);
          setDragOverIdx(null);
          setDragFingerPos(null);
        },
        onPanResponderTerminate: () => {
          setDragOverIdx(null);
          setDragFingerPos(null);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeCategory]
  );

  // grid 컨테이너 안에서 손가락 위치 → cell idx 매핑.
  // 1.0.26: 즐겨찾기 탭 영역도 우선 hit-test → 'FAV_TAB' sentinel 반환.
  const hitTestAndUpdate = (pageX, pageY) => {
    // 1) 즐겨찾기 탭 hit-test (현재 활성 카테고리가 즐겨찾기 가 아닐 때만 — 중복 방지)
    if (activeCategory !== '즐겨찾기') {
      const fav = favTabLayoutRef.current;
      if (
        fav &&
        pageX >= fav.pageX &&
        pageX <= fav.pageX + fav.width &&
        pageY >= fav.pageY &&
        pageY <= fav.pageY + fav.height
      ) {
        if (dragOverRef.current !== 'FAV_TAB') setDragOverIdx('FAV_TAB');
        return;
      }
    }
    // 2) 그리드 cell hit-test
    const layout = gridLayoutRef.current;
    if (!layout) return;
    const relX = pageX - layout.pageX;
    const relY = pageY - layout.pageY;
    if (relX < 0 || relY < 0 || relX > layout.width || relY > layout.height) {
      setDragOverIdx(null);
      return;
    }
    const colW = layout.width / GRID_COLS;
    const rowH = layout.height / GRID_ROWS;
    const col = Math.floor(relX / colW);
    const row = Math.floor(relY / rowH);
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) {
      setDragOverIdx(null);
      return;
    }
    const idx = row * GRID_COLS + col;
    if (dragOverRef.current !== idx) setDragOverIdx(idx);
  };

  // 실제 테이블이 없어도(주문 탭 선진입) PENDING 가상 테이블로 장바구니를 담는다.
  const hasRealTable = !!table?.id;
  const isPending = !hasRealTable;
  const tableId = hasRealTable ? table.id : PENDING_TABLE_ID;
  const order = getOrder(tableId);

  // 배달 헤더 거리 라벨 — 주소 입력 즉시 반영. 주소록 entry 의 좌표가 있으면 그것 우선,
  // 없으면 500ms 디바운스 후 카카오 호출 (입력 도중 폭증 방지). 매장 좌표 미설정 시 OFF.
  const [liveDistanceLabel, setLiveDistanceLabel] = useState(null);
  useEffect(() => {
    setLiveDistanceLabel(null);
    if (table?.type !== 'delivery') return;
    const addr = order?.deliveryAddress;
    if (!addr) return;
    if (storeInfo?.lat == null || storeInfo?.lng == null) return;
    const key = normalizeAddressKey(addr);
    const entry = key ? addressBook?.entries?.[key] : null;
    if (entry && typeof entry.lat === 'number' && typeof entry.lng === 'number') {
      const km = distanceKm(
        { lat: entry.lat, lng: entry.lng },
        { lat: storeInfo.lat, lng: storeInfo.lng }
      );
      setLiveDistanceLabel(formatDistance(km));
      return;
    }
    let cancelled = false;
    const id = setTimeout(async () => {
      const result = await geocodeAddress(addr);
      if (cancelled || !result) return;
      const km = distanceKm(
        { lat: result.lat, lng: result.lng },
        { lat: storeInfo.lat, lng: storeInfo.lng }
      );
      setLiveDistanceLabel(formatDistance(km));
      // 주소록 entry 자동 등록 (이미 있으면 noop) — TableScreen 배달 카드도 거리 표시되게.
      // useAddressBook 의 백그라운드 effect 가 다음 사이클에 lat/lng 채움.
      addAddress(addr);
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [
    table?.type,
    order?.deliveryAddress,
    addressBook,
    storeInfo?.lat,
    storeInfo?.lng,
  ]);

  // 장바구니 = 편집중 내역. items = 이미 주방/테이블에 확정 커밋된 내역.
  const cart = order.cartItems ?? order.items ?? [];
  const committedItems = order.items ?? [];
  const total = getCartTotal(tableId);
  const totalQty = getCartQty(tableId);
  const hasCommittedOrder = committedItems.length > 0;

  // 1.0.36: 단체(group) 묶음 후 메뉴 추가 시 sourceTable 선택 흐름.
  // group leader 면 모달 띄움, 일반이면 즉시 적용.
  // sourceTableId 가 있어야 동일 메뉴라도 손님별 슬롯이 분리됨 (normalizeSlots).
  const applyMenuAdd = (item, sourceTableId) => {
    if (!tableId) return;
    const src = sourceTableId || tableId;
    const def = cart.find(
      (x) =>
        x.id === item.id &&
        (x.options || []).length === 0 &&
        !x.memo &&
        (x.cookState || 'pending') === 'pending' &&
        !x.cookStateNormal &&
        !x.cookStateLarge &&
        (x.sourceTableId || tableId) === src
    );
    const targetId = def ? def.slotId : genSlotId();
    const hasLarge = def && (def.largeQty || 0) > 0;
    addItem(tableId, item, targetId, sourceTableId);
    setSelectedRowKey(`${targetId}#${hasLarge ? 'normal' : 'only'}`);
  };

  const handleMenuPress = (item) => {
    if (!tableId) return;
    const group = getGroupFor?.(tableId);
    if (group && group.memberIds && group.memberIds.length > 1) {
      // 단체 — sourceTable 선택 모달. 마지막 선택은 ★ 강조.
      setPendingMenuItem(item);
      setGroupPickerMembers(group.memberIds);
      setGroupPickerOpen(true);
      return;
    }
    applyMenuAdd(item, null);
  };

  const handleGroupSourceSelect = (sourceTableId) => {
    if (pendingMenuItem) {
      const group = getGroupFor?.(tableId);
      if (group?.leaderId) {
        setLastSourceByGroup((prev) => ({
          ...prev,
          [group.leaderId]: sourceTableId,
        }));
      }
      applyMenuAdd(pendingMenuItem, sourceTableId);
    }
    setGroupPickerOpen(false);
    setPendingMenuItem(null);
  };

  const handleGroupSourceCancel = () => {
    setGroupPickerOpen(false);
    setPendingMenuItem(null);
  };

  // 1.0.37: 분리 결제 시작 — 큐 만들고 첫 손님 PaymentMethodPicker 띄움.
  const handleSplitStart = () => {
    if (!groupSplitChoice) return;
    const { tableId: tid, members, subtotalsBySource } = groupSplitChoice;
    const queue = members.filter((m) => (subtotalsBySource[m] || 0) > 0);
    setGroupSplitChoice(null);
    if (queue.length === 0) return;
    const first = queue[0];
    setSplitPayQueue({ tableId: tid, remaining: queue, subtotals: subtotalsBySource });
    setPaymentPicker({
      mode: 'postpaid',
      tableId: tid,
      sourceTableId: first,
      total: subtotalsBySource[first] || 0,
      isSplit: true,
    });
  };

  // 합산 결제 — 기존 후불 흐름으로 진입.
  const handleSplitCombined = () => {
    if (!groupSplitChoice) return;
    const total = Object.values(groupSplitChoice.subtotalsBySource).reduce(
      (a, b) => a + (b || 0),
      0
    );
    const tid = groupSplitChoice.tableId;
    setGroupSplitChoice(null);
    setPaymentPicker({ mode: 'postpaid', tableId: tid, total });
  };

  const menuById = Object.fromEntries(menuItems.map((m) => [m.id, m]));

  // AI 메뉴 추천 — 시간대/단골/인기도 가중 점수로 매출 history 에서 자동 선정.
  // 외부 API 사용 X. 카탈로그 편집 불가능한 동적 카테고리.
  const isRecommendation = activeCategory === RECOMMENDATION_CATEGORY;
  const displayCategories = useMemo(
    () => [RECOMMENDATION_CATEGORY, ...categories],
    []
  );
  const recommendations = useMemo(() => {
    if (!isRecommendation) return [];
    const orderForAddr = hasRealTable ? getOrder(table.id) : null;
    const addr = orderForAddr?.deliveryAddress || null;
    // 같은 phone 의 다른 주소도 단골로 묶기 — 손님이 본점/지점/회사/집 등
    // 여러 주소로 시켜도 동일 손님 인식.
    const addrKey = addr ? normalizeAddressKey(addr) : null;
    const entry =
      addrKey && addressBook?.entries ? addressBook.entries[addrKey] : null;
    const customerPhone = entry?.phone || null;
    return computeRecommendations({
      history: revenue?.history || [],
      menus: menuItems,
      customerAddressKey: addr,
      customerPhone,
      addressBook,
      topN: GRID_COLS * GRID_ROWS,
    });
  }, [
    isRecommendation,
    revenue?.history,
    menuItems,
    hasRealTable,
    table,
    getOrder,
    addressBook,
  ]);
  const recommendedRows = useMemo(
    () => recommendationsToGrid(recommendations, GRID_COLS, GRID_ROWS),
    [recommendations]
  );
  const currentRows = isRecommendation
    ? recommendedRows
    : categoryRows[activeCategory] || [];

  // 배달 헤더에 노출할 "전번 등록 prompt" 대상 entry.
  // 시나리오: CID 새 번호 → PENDING 자리 → 배달 자리로 변환 → 사장님이 통화하며
  // 주소 알게 됨 → 주소 입력 → 매칭된 entry 에 전번이 비어있으면 한 클릭으로 등록.
  // 사장님 직접 편집 화면 진입 불필요.
  const phoneRegisterTarget = useMemo(() => {
    if (table?.type !== 'delivery') return null;
    const phoneRaw = order?.deliveryPhone || '';
    const phoneDigits = String(phoneRaw).replace(/\D/g, '');
    if (!phoneDigits || phoneDigits.length < 4) return null;
    const addr = (order?.deliveryAddress || '').trim();
    if (!addr) return null;
    const key = normalizeAddressKey(addr);
    if (!key) return null;
    const entry = addressBook?.entries?.[key];
    if (!entry) return null;
    if (entry.phone) {
      // 이미 등록된 phone 이 현재 phone 과 다르면 prompt 안 띄움 (사장님이 의도해서
      // 옛 phone 유지 중일 수 있음. 변경은 수동 편집으로).
      return null;
    }
    return {
      key,
      alias: (entry.alias || '').trim() || entry.label || addr,
      phone: phoneRaw,
      phoneDigits,
    };
  }, [
    table?.type,
    order?.deliveryPhone,
    order?.deliveryAddress,
    addressBook?.entries,
  ]);

  const handleRegisterPhone = () => {
    if (!phoneRegisterTarget) return;
    if (typeof setPhone !== 'function') return;
    setPhone(phoneRegisterTarget.key, phoneRegisterTarget.phone);
  };

  // 추천 카테고리는 자동 생성 — editMode 진입 자체를 차단(빈 [+] 슬롯 혼동 방지).
  useEffect(() => {
    if (isRecommendation && editMode) setEditMode(false);
  }, [isRecommendation, editMode]);

  const stopRecognition = () => {
    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch (e) {}
      recognitionRef.current = null;
    }
    setListening(false);
    setInterimText('');
  };

  const toggleListening = () => {
    if (listening) {
      stopRecognition();
      return;
    }
    if (!tableId) return;
    // 플랫폼이 지원하지 않으면 사용자에게 안내 Alert 표시 후 종료
    if (!voiceSupported) {
      const msg = getVoiceUnsupportedMessage();
      if (msg) {
        Alert.alert('음성 인식을 사용할 수 없습니다', msg, [
          { text: '확인', style: 'default' },
        ]);
      }
      return;
    }
    const rec = createRecognition();
    if (!rec) {
      const msg = getVoiceUnsupportedMessage();
      if (msg) {
        Alert.alert('음성 인식을 사용할 수 없습니다', msg, [
          { text: '확인', style: 'default' },
        ]);
      }
      return;
    }

    rec.onresult = (e) => {
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (interim) setInterimText(interim);
      if (final) {
        const parsed = parseVoiceOrder(final, menuItems);
        parsed.forEach(({ item, qty }) => {
          for (let n = 0; n < qty; n++) addItem(tableId, item);
        });
        setInterimText('');
      }
    };
    rec.onerror = () => stopRecognition();
    rec.onend = () => {
      recognitionRef.current = null;
      setListening(false);
      setInterimText('');
    };

    try {
      rec.start();
      recognitionRef.current = rec;
      setListening(true);
    } catch (e) {}
  };

  useEffect(() => {
    return () => {
      const rec = recognitionRef.current;
      if (rec) {
        try {
          rec.stop();
        } catch (e) {}
      }
    };
  }, []);

  useEffect(() => {
    if (listening) stopRecognition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId]);

  // 실제 테이블이 선택되면 PENDING 장바구니를 해당 테이블로 이관한다.
  useEffect(() => {
    if (table?.id && migratePendingCart) {
      migratePendingCart(table.id);
      if (autoConfirmIntent) {
        // intent 는 한 번만 소비. 실제 확정은 다음 렌더에서 cart 가 채워진 뒤 수행.
        setPendingAutoConfirm(true);
        clearAutoConfirmIntent?.();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table?.id]);

  // 자동 확정: pendingAutoConfirm 가 set 되고 cart 가 (마이그레이션 후) 채워진 시점에 한 번 실행.
  useEffect(() => {
    if (!pendingAutoConfirm) return;
    if (!hasRealTable) return;
    if (cart.length === 0) return;
    setPendingAutoConfirm(false);
    if (hasCommittedOrder) {
      const diff = computeDiffRows(cart, order.confirmedItems || []);
      const anyChange = diff.some((r) => r.kind !== 'unchanged');
      if (anyChange) {
        playChangeSound();
        speakOrderChange({
          table,
          diff,
          menuItems,
          order: { ...order, items: cart },
          optionsList: options,
        });
      } else {
        playOrderSound();
        speakOrder({
          table,
          order: { ...order, items: cart },
          menuItems,
          optionsList: options,
        });
      }
    } else {
      playOrderSound();
      speakOrder({
        table,
        order: { ...order, items: cart },
        menuItems,
        optionsList: options,
      });
    }
    confirmOrder(tableId);
    onBack?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutoConfirm, cart.length, hasRealTable]);

  const confirmSizePrompt = () => {
    if (!sizePrompt || !tableId) return;
    const { items, index, value, sizeOption, mode } = sizePrompt;
    const item = items[index];
    if (mode === 'option') {
      splitOffWithOptionToggle(
        tableId,
        item.slotId,
        value,
        sizeOption.id
      );
    } else {
      setItemLargeQty(tableId, item.slotId || item.id, value);
    }
    if (index + 1 < items.length) {
      const nextItem = items[index + 1];
      setSizePrompt({
        ...sizePrompt,
        index: index + 1,
        value: 1, // 기본값 1
      });
    } else {
      setSizePrompt(null);
    }
  };

  const cancelSizePrompt = () => setSizePrompt(null);

  return (
    <View
      style={styles.container}
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        if (
          Math.abs((layoutSize.w || 0) - w) > 0.5 ||
          Math.abs((layoutSize.h || 0) - h) > 0.5
        ) {
          setLayoutSize({ w, h });
        }
      }}
    >
      {/* 대 / 옵션 분리 적용 — Modal 대신 absolute 오버레이 (iOS new arch 호환성) */}
      {sizePrompt &&
        (() => {
          const curItem = sizePrompt.items[sizePrompt.index];
          if (!curItem) return null;
          return (
            <View style={styles.sizeModalOverlay} pointerEvents="auto">
              <Pressable
                style={styles.sizeModalBackdrop}
                onPress={cancelSizePrompt}
              >
                <Pressable
                  style={styles.sizeModalCard}
                  onPress={() => {}}
                >
                  <TouchableOpacity
                    style={styles.sizeModalClose}
                    onPress={cancelSizePrompt}
                  >
                    <Text style={styles.sizeModalCloseText}>✕</Text>
                  </TouchableOpacity>
                  <Text style={styles.sizeModalLine1}>
                    {curItem.name} {curItem.qty}개 중
                  </Text>
                  <Text style={styles.sizeModalLine2}>
                    몇 개를 {sizePrompt.sizeOption.label} 적용할까요?
                  </Text>
                  <View style={styles.sizeModalRow}>
                    {/* 주문내역과 동일한 [− N +] 단일 박스 스타일 */}
                    <View style={styles.sizeStepBox}>
                      <TouchableOpacity
                        style={styles.sizeStepBtn}
                        onPress={() =>
                          setSizePrompt((s) => ({
                            ...s,
                            value: Math.max(0, s.value - 1),
                          }))
                        }
                      >
                        <Text style={styles.sizeStepBtnText}>−</Text>
                      </TouchableOpacity>
                      <Text style={styles.sizeStepValue}>
                        {sizePrompt.value}
                      </Text>
                      <TouchableOpacity
                        style={styles.sizeStepBtn}
                        onPress={() =>
                          setSizePrompt((s) => ({
                            ...s,
                            value: Math.min(curItem.qty, s.value + 1),
                          }))
                        }
                      >
                        <Text style={styles.sizeStepBtnText}>+</Text>
                      </TouchableOpacity>
                    </View>
                    <TouchableOpacity
                      style={styles.sizeConfirmBtn}
                      onPress={confirmSizePrompt}
                    >
                      <Text style={styles.sizeConfirmText}>확인</Text>
                    </TouchableOpacity>
                  </View>
                  {sizePrompt.items.length > 1 && (
                    <Text style={styles.sizeProgress}>
                      {sizePrompt.index + 1} / {sizePrompt.items.length}
                    </Text>
                  )}
                </Pressable>
              </Pressable>
            </View>
          );
        })()}

      {/* 메모 입력 모달 — 자유 입력 */}
      {memoPrompt && (() => {
        const targetItem = cart.find((i) => i.slotId === memoPrompt.slotId);
        if (!targetItem) return null;
        return (
          <KeyboardAvoidingView
            style={styles.sizeModalOverlay}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            pointerEvents="auto"
          >
            <Pressable
              style={styles.sizeModalBackdrop}
              onPress={() => setMemoPrompt(null)}
            >
              <Pressable
                style={styles.sizeModalCard}
                onPress={() => {}}
              >
                <TouchableOpacity
                  style={styles.sizeModalClose}
                  onPress={() => setMemoPrompt(null)}
                >
                  <Text style={styles.sizeModalCloseText}>✕</Text>
                </TouchableOpacity>
                <Text style={styles.sizeModalLine1}>{targetItem.name} 메모</Text>
                {/* 확인/비우기 버튼을 TextInput 위에 배치 — iOS 키보드가 올라와도 항상 보임 */}
                <View style={styles.memoModalRow}>
                  <TouchableOpacity
                    style={styles.memoClearBtn}
                    onPress={() => {
                      setItemMemo(tableId, memoPrompt.slotId, '');
                      setMemoPrompt(null);
                    }}
                  >
                    <Text style={styles.memoClearBtnText}>비우기</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.sizeConfirmBtn}
                    onPress={() => {
                      setItemMemo(
                        tableId,
                        memoPrompt.slotId,
                        memoPrompt.value
                      );
                      setMemoPrompt(null);
                    }}
                  >
                    <Text style={styles.sizeConfirmText}>확인</Text>
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={styles.memoInput}
                  value={memoPrompt.value}
                  onChangeText={(v) =>
                    setMemoPrompt((p) => (p ? { ...p, value: v } : p))
                  }
                  placeholder="예: 면 푹 익혀서, 양 많이"
                  placeholderTextColor="#9ca3af"
                  multiline
                  maxLength={60}
                  autoFocus
                />
              </Pressable>
            </Pressable>
          </KeyboardAvoidingView>
        );
      })()}

      {/* 옵션 편집 모달 — 라벨 변경 / 위치 이동 / 기본값 복원 */}
      {optionsEditOpen && (() => {
        // 화면 높이 기준 동적 사이즈 — 좁은 가로(아이폰 Pro Max 가로 등)에서 잘림 방지
        const cardMaxH = Math.max(220, height - 32);
        // 카드 내부 패딩+제목+힌트+버튼바를 빼고 남은 공간이 리스트 영역.
        // 대략 헤더~힌트(~64), 버튼바(~48), 카드패딩(~28), gap(~16) = 156
        const listMaxH = Math.max(80, cardMaxH - 156);
        return (
          <View style={styles.sizeModalOverlay} pointerEvents="auto">
            <Pressable
              style={styles.sizeModalBackdrop}
              onPress={() => setOptionsEditOpen(false)}
            >
              <Pressable
                style={[
                  styles.sizeModalCard,
                  styles.optionsEditCard,
                  { maxHeight: cardMaxH },
                ]}
                onPress={() => {}}
              >
                <TouchableOpacity
                  style={styles.sizeModalClose}
                  onPress={() => setOptionsEditOpen(false)}
                >
                  <Text style={styles.sizeModalCloseText}>✕</Text>
                </TouchableOpacity>
                <Text style={styles.sizeModalLine1}>옵션 편집</Text>
                <Text style={styles.optionsEditHint}>
                  라벨을 직접 수정하고 ↑↓ 로 순서를 바꿀 수 있어요
                </Text>
                <ScrollView
                  style={[styles.optionsEditList, { maxHeight: listMaxH }]}
                  contentContainerStyle={{ paddingBottom: 4 }}
                >
                  {editableOptions.map((opt, idx) => (
                    <View key={opt.id} style={styles.optionsEditRow}>
                      <TextInput
                        style={styles.optionsEditInput}
                        value={opt.label}
                        onChangeText={(v) => updateOptionLabel(opt.id, v)}
                        placeholder="옵션 이름"
                        placeholderTextColor="#9ca3af"
                        maxLength={12}
                      />
                      <TouchableOpacity
                        style={[
                          styles.optionsEditMoveBtn,
                          idx === 0 && styles.optionsEditMoveBtnDisabled,
                        ]}
                        disabled={idx === 0}
                        onPress={() => moveOption(idx, idx - 1)}
                      >
                        <Text style={styles.optionsEditMoveBtnText}>↑</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.optionsEditMoveBtn,
                          idx === editableOptions.length - 1 &&
                            styles.optionsEditMoveBtnDisabled,
                        ]}
                        disabled={idx === editableOptions.length - 1}
                        onPress={() => moveOption(idx, idx + 1)}
                      >
                        <Text style={styles.optionsEditMoveBtnText}>↓</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
                <View style={styles.memoModalRow}>
                  <TouchableOpacity
                    style={styles.memoClearBtn}
                    onPress={() => resetEditableOptions()}
                  >
                    <Text style={styles.memoClearBtnText}>기본값 복원</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.sizeConfirmBtn}
                    onPress={() => setOptionsEditOpen(false)}
                  >
                    <Text style={styles.sizeConfirmText}>완료</Text>
                  </TouchableOpacity>
                </View>
              </Pressable>
            </Pressable>
          </View>
        );
      })()}

      <View style={styles.tableHeader}>
        <Text style={styles.tableLabel} numberOfLines={1}>
          {table?.label || '주문 즐겨찾기'}
        </Text>
        {(() => {
          // 1.0.44: 시간 입력 UI 를 배달뿐 아니라 예약/포장에도 노출.
          // 같은 deliveryTime/deliveryTimeIsPM 필드 재사용 — 마이그레이션 0.
          // 알림은 useScheduledAlerts 가 type 별 음성(배달 출발/예약/픽업) 분기.
          const tType = table?.type;
          const needsTime = tType === 'delivery' || tType === 'reservation' || tType === 'takeout';
          if (!needsTime) {
            return (
              <Text style={styles.tableHeaderHint}>
                {table ? '' : '메뉴를 담은 뒤 [주문] 을 누르세요'}
              </Text>
            );
          }
          const timePlaceholder =
            tType === 'reservation' ? '6:30' : tType === 'takeout' ? '5:15' : '4:20';
          return (
            <View style={styles.headerAddressWrap}>
              {tType === 'delivery' && (
                <>
                  <Text style={styles.deliveryLabel}>📍</Text>
                  <TextInput
                    style={[styles.deliveryInput, styles.deliveryInputCompact]}
                    value={order.deliveryAddress || ''}
                    onChangeText={(v) => tableId && setDeliveryAddress(tableId, v)}
                    placeholder="주소"
                    placeholderTextColor="#9ca3af"
                    returnKeyType="done"
                    onSubmitEditing={() => Keyboard.dismiss()}
                    blurOnSubmit
                    onFocus={() => setAddressFocused(true)}
                    onBlur={() => setAddressFocused(false)}
                  />
                  {addressFocused && (
                    <TouchableOpacity
                      style={styles.kbDoneBtn}
                      onPress={() => Keyboard.dismiss()}
                    >
                      <Text style={styles.kbDoneBtnText}>✓</Text>
                    </TouchableOpacity>
                  )}
                  {liveDistanceLabel ? (
                    <Text
                      style={{
                        marginHorizontal: 6,
                        fontSize: 13,
                        color: '#059669',
                        fontWeight: '700',
                      }}
                    >
                      📏 {liveDistanceLabel}
                    </Text>
                  ) : null}
                  <TouchableOpacity
                    style={styles.addressBookBtn}
                    onPress={() => setAddressBookOpen(true)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.addressBookBtnText}>▼</Text>
                  </TouchableOpacity>
                  <AddressChips
                    compact={isPhone}
                    inline
                    max={12}
                    onSelect={(label) => tableId && setDeliveryAddress(tableId, label)}
                  />
                  {phoneRegisterTarget && (
                    <TouchableOpacity
                      style={styles.phoneRegisterChip}
                      activeOpacity={0.7}
                      onPress={handleRegisterPhone}
                      accessibilityLabel={`${phoneRegisterTarget.phone} 를 ${phoneRegisterTarget.alias} 에 등록`}
                    >
                      <Text style={styles.phoneRegisterChipText} numberOfLines={1}>
                        📞 {phoneRegisterTarget.phone} → {phoneRegisterTarget.alias}{' '}
                        등록
                      </Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
              <Text style={styles.deliveryLabelTight}>🕐</Text>
              <View style={styles.ampmGroup}>
                <TouchableOpacity
                  style={[
                    styles.ampmBtn,
                    !order.deliveryTimeIsPM && styles.ampmBtnActive,
                  ]}
                  onPress={() => tableId && setDeliveryTimeIsPM(tableId, false)}
                >
                  <Text
                    style={[
                      styles.ampmText,
                      !order.deliveryTimeIsPM && styles.ampmTextActive,
                    ]}
                  >
                    오전
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.ampmBtn,
                    (order.deliveryTimeIsPM ?? true) && styles.ampmBtnActive,
                  ]}
                  onPress={() => tableId && setDeliveryTimeIsPM(tableId, true)}
                >
                  <Text
                    style={[
                      styles.ampmText,
                      (order.deliveryTimeIsPM ?? true) && styles.ampmTextActive,
                    ]}
                  >
                    오후
                  </Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={[styles.deliveryTimeInput, styles.deliveryTimeInputCompact]}
                value={order.deliveryTime || ''}
                onChangeText={(v) => tableId && setDeliveryTime(tableId, v)}
                placeholder={timePlaceholder}
                placeholderTextColor="#9ca3af"
                maxLength={5}
                keyboardType="numeric"
                returnKeyType="done"
                onSubmitEditing={() => Keyboard.dismiss()}
                blurOnSubmit
              />
            </View>
          );
        })()}
      </View>

      {table?.type === 'delivery' && (
        <AddressBookModal
          visible={addressBookOpen}
          onClose={() => setAddressBookOpen(false)}
          onSelect={(label, entry) => {
            if (!tableId) return;
            setDeliveryAddress(tableId, label);
            // 1.0.53: 별칭 단골 자동 등록 — 별칭만 있고 phone 비어있는 entry 클릭 시
            // 현재 주문의 deliveryPhone (CID 또는 사장님 입력) 을 entry.phone 에 자동 sync.
            // 다음 전화부터 같은 phone 으로 단골 자동 인식 (사장님 의도).
            const order = getOrder(tableId);
            if (
              entry?.key &&
              !entry.phone &&
              order?.deliveryPhone &&
              typeof setPhone === 'function'
            ) {
              setPhone(entry.key, order.deliveryPhone);
            }
          }}
        />
      )}

      <View style={[styles.body, stacked && styles.bodyStacked]}>
        {/* 왼쪽: 메뉴 영역 */}
        <View style={styles.menuSide}>
          {/* 카테고리 탭 (1.0.27: layout 원복 — 1.0.26 의 inline flexDirection 제거) */}
          <View style={styles.categoryBar}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {displayCategories.map((cat) => {
                const active = activeCategory === cat;
                const isFav = cat === '즐겨찾기';
                // 1.0.26: 즐겨찾기 탭 — drag-drop 시 hit-test 용 onLayout + drop zone 강조
                const isDropTarget = isFav && dragOverIdx === 'FAV_TAB' && nativeMoveFromIdx !== null;
                return (
                  <TouchableOpacity
                    key={cat}
                    ref={isFav ? favTabViewRef : null}
                    style={[
                      styles.categoryTab,
                      isPhone && styles.categoryTabPhone,
                      active && styles.categoryTabActive,
                      isDropTarget && {
                        backgroundColor: '#fef3c7',
                        borderWidth: 2,
                        borderColor: '#d97706',
                      },
                    ]}
                    onPress={() => { setActiveCategory(cat); setNativeMoveFromIdx(null); }}
                    onLayout={() => {
                      if (!isFav) return;
                      try {
                        const ref = favTabViewRef.current;
                        if (ref && typeof ref.measureInWindow === 'function') {
                          ref.measureInWindow((x, y, w, h) => {
                            favTabLayoutRef.current = { pageX: x, pageY: y, width: w, height: h };
                          });
                        }
                      } catch (err) {
                        try { reportError(err, { ctx: 'favTabLayout.measure' }); } catch {}
                      }
                    }}
                  >
                    <Text
                      style={[
                        styles.categoryText,
                        isPhone && styles.categoryTextPhone,
                        active && styles.categoryTextActive,
                        isDropTarget && { color: '#d97706', fontWeight: '900' },
                      ]}
                    >
                      {isDropTarget ? '⭐ 즐겨찾기에 추가' : cat}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
          {/* 1.0.27: 편집 모드 토글 + 안내 띠를 별도 행으로 분리 (1.0.26 의 layout 충돌 회피) */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 8,
              paddingVertical: 4,
              backgroundColor: editMode ? '#fee2e2' : 'transparent',
            }}
          >
            {editMode ? (
              <Text
                style={{
                  flex: 1,
                  fontSize: 11,
                  color: '#991b1b',
                  fontWeight: '700',
                }}
              >
                ✏️ 메뉴 편집 중 — 빈 [+] 클릭 = 추가 · 메뉴 클릭 = 수정/삭제 · longPress+드래그 = 이동/즐겨찾기
              </Text>
            ) : (
              <View style={{ flex: 1 }} />
            )}
            <TouchableOpacity
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 8,
                backgroundColor: editMode ? '#dc2626' : '#f3f4f6',
                borderWidth: 1,
                borderColor: editMode ? '#b91c1c' : '#d1d5db',
              }}
              onPress={() => setEditMode(!editMode)}
              activeOpacity={0.7}
              accessibilityLabel="메뉴 편집 모드"
            >
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: '700',
                  color: editMode ? '#fff' : '#374151',
                }}
              >
                {editMode ? '✓ 완료' : '✏️ 편집'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* 폰 메뉴 이동 모드 배너 — 선택된 메뉴 타일이 있을 때만 표시 */}
          {!isWeb && nativeMoveFromIdx !== null ? (
            <View style={styles.nativeMoveBanner}>
              <Text style={styles.nativeMoveBannerText}>
                🔀 이동할 위치를 탭하세요 · 같은 칸 탭하면 취소
              </Text>
              <TouchableOpacity
                style={styles.nativeMoveCancelBtn}
                onPress={() => setNativeMoveFromIdx(null)}
              >
                <Text style={styles.nativeMoveCancelText}>취소</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* 메뉴 그리드 - 모든 카테고리에서 6×4 격자, 드래그로 자유롭게 이동 */}
          {/* 한 화면에 모든 행이 들어가도록 외부 스크롤 제거 */}
          {/* 1.0.29: gridViewRef 직접 ref 받기 — 폰(RN native) 의 measureInWindow 호출용.
               기존 e.target.measureInWindow 는 폰에서 e.target 이 number(reactTag) 라
               메서드 X. ref 직접 받으면 RN native 의 component instance 라 method 정상. */}
          <View
            ref={gridViewRef}
            style={styles.favGrid}
            onLayout={() => {
              try {
                const ref = gridViewRef.current;
                if (ref && typeof ref.measureInWindow === 'function') {
                  ref.measureInWindow((x, y, w, h) => {
                    gridLayoutRef.current = { pageX: x, pageY: y, width: w, height: h };
                  });
                }
              } catch (err) {
                try { reportError(err, { ctx: 'gridLayout.measure' }); } catch {}
              }
            }}
            {...(!isWeb ? panResponder.panHandlers : {})}
          >
            {(() => {
              // 모든 카테고리를 6열 × 4행 격자로 재구성 (null 슬롯 유지).
              const displayRows = (() => {
                const flat = currentRows.flat();
                const rows = [];
                for (let r = 0; r < GRID_ROWS; r++) {
                  const row = [];
                  for (let c = 0; c < GRID_COLS; c++) {
                    const idx = r * GRID_COLS + c;
                    row.push(flat[idx] ?? null);
                  }
                  rows.push(row);
                }
                return rows;
              })();
              return displayRows.map((rowIds, rowIdx) => (
                <View
                  key={`row-${activeCategory}-${rowIdx}`}
                  style={styles.favRow}
                >
                  {rowIds
                    .map((id, cellIdx) => ({
                      id,
                      item: id != null ? menuById[id] : null,
                      cellIdx,
                    }))
                    .map(({ id, item, cellIdx }) => {
                      const dragIdx = rowIdx * GRID_COLS + cellIdx;
                      const isDragTarget =
                        dragOverIdx === dragIdx &&
                        dragFromIdx !== null &&
                        dragFromIdx !== dragIdx;
                      const applyDrop = (from, to) => {
                        if (isRecommendation) return;
                        if (from === null || from === to) return;
                        setCategorySlot?.(activeCategory, from, to);
                      };
                      const dropHandlers = isWeb
                        ? {
                            onDragOver: (e) => {
                              e.preventDefault();
                              if (dragOverIdx !== dragIdx) {
                                setDragOverIdx(dragIdx);
                              }
                            },
                            onDragLeave: () => {
                              if (dragOverIdx === dragIdx) {
                                setDragOverIdx(null);
                              }
                            },
                            onDrop: (e) => {
                              e.preventDefault();
                              let from = dragFromIdx;
                              try {
                                const data = e.dataTransfer?.getData(
                                  'text/plain'
                                );
                                if (data !== '' && data != null) {
                                  const parsed = Number(data);
                                  if (Number.isFinite(parsed)) from = parsed;
                                }
                              } catch (_) {}
                              setDragFromIdx(null);
                              setDragOverIdx(null);
                              applyDrop(from, dragIdx);
                            },
                          }
                        : {};
                      // 빈 칸 — 모든 카테고리 격자에 존재; 드롭 대상
                      if (!item) {
                        // 1.0.26: 편집 모드 ON 시 점선 + "+" 표시 + 클릭 시 신규 추가 모달
                        const editEmptyStyle = editMode
                          ? {
                              borderWidth: 2,
                              borderStyle: 'dashed',
                              borderColor: '#dc2626',
                              alignItems: 'center',
                              justifyContent: 'center',
                              backgroundColor: '#fef2f2',
                            }
                          : null;
                        const emptyContent = (
                          <View
                            key={`empty-${rowIdx}-${cellIdx}`}
                            style={[
                              {
                                width: menuTileWidth,
                                minHeight: 0,
                              },
                              styles.tileEmptySlot,
                              editEmptyStyle,
                              isDragTarget && styles.tileDragTarget,
                            ]}
                          >
                            {editMode ? (
                              <Text
                                style={{
                                  fontSize: 28,
                                  color: '#dc2626',
                                  fontWeight: '900',
                                }}
                              >
                                +
                              </Text>
                            ) : null}
                          </View>
                        );
                        const emptyBox = editMode ? (
                          <TouchableOpacity
                            key={`empty-press-${rowIdx}-${cellIdx}`}
                            onPress={() => {
                              if (isRecommendation) return;
                              setMenuAddTarget({
                                category: activeCategory,
                                flatIndex: dragIdx,
                              });
                            }}
                            activeOpacity={0.6}
                            accessibilityLabel={`${activeCategory} 카테고리에 새 메뉴 추가`}
                          >
                            {emptyContent}
                          </TouchableOpacity>
                        ) : (
                          emptyContent
                        );
                        if (isWeb) {
                          return (
                            <div
                              key={`empty-w-${rowIdx}-${cellIdx}`}
                              style={{ display: 'flex' }}
                              {...dropHandlers}
                            >
                              {emptyBox}
                            </div>
                          );
                        }
                        return emptyBox;
                      }
                      const isDragging = dragFromIdx === dragIdx;
                      const tileNode = (
                        <TouchableOpacity
                          key={id}
                          style={[
                            styles.tile,
                            isPhone && styles.tilePhone,
                            {
                              backgroundColor: item.color,
                              width: menuTileWidth,
                              aspectRatio: undefined,
                              minHeight: 0,
                            },
                            isDragging && styles.tileDragging,
                            isDragTarget && styles.tileDragTarget,
                            // 폰 이동 모드 스타일
                            !isWeb && nativeMoveFromIdx === dragIdx && styles.tileNativeMoving,
                            !isWeb && nativeMoveFromIdx !== null && nativeMoveFromIdx !== dragIdx && styles.tileNativeMoveTarget,
                          ]}
                          activeOpacity={0.7}
                          onLongPress={() => {
                            if (isRecommendation) return;
                            // 폰: 꾹 누르면 메뉴 이동 모드 진입
                            // 웹: draggable div 가 처리하므로 여기선 무시
                            if (!isWeb) {
                              setNativeMoveFromIdx(dragIdx);
                            }
                          }}
                          delayLongPress={400}
                          onPress={() => {
                            // 1.0.26: 편집 모드 ON 시 메뉴 카드 클릭 = 빠른 수정 모달.
                            // 장바구니 추가 흐름은 일반 모드에서만.
                            if (editMode) {
                              setQuickEditItem(item);
                              return;
                            }
                            // 폰 이동 모드 중: 목적지 선택
                            if (!isWeb && nativeMoveFromIdx !== null) {
                              if (nativeMoveFromIdx === dragIdx) {
                                // 같은 타일 다시 탭 → 취소
                                setNativeMoveFromIdx(null);
                              } else {
                                setCategorySlot?.(activeCategory, nativeMoveFromIdx, dragIdx);
                                setNativeMoveFromIdx(null);
                              }
                              return;
                            }
                            handleMenuPress(item);
                          }}
                        >
                          <ImageBackground
                            source={{ uri: item.image || undefined }}
                            style={styles.tileImage}
                            imageStyle={styles.tileImageRadius}
                          >
                            <View style={[styles.tileScrimTop, isPhone && styles.tileScrimTopPhone]}>
                              <Text
                                style={[styles.tileName, isPhone && styles.tileNamePhone]}
                                numberOfLines={1}
                              >
                                {item.name}
                              </Text>
                            </View>
                            <View style={{ flex: 1 }} />
                            <View style={[styles.tileScrimBottom, isPhone && styles.tileScrimBottomPhone]}>
                              <Text style={[styles.tilePrice, isPhone && styles.tilePricePhone]}>
                                {item.price.toLocaleString()}
                              </Text>
                            </View>
                          </ImageBackground>
                        </TouchableOpacity>
                      );
                      if (isWeb) {
                        return (
                          <div
                            key={`tile-w-${activeCategory}-${dragIdx}`}
                            style={{ display: 'flex' }}
                            draggable={!isRecommendation}
                            onDragStart={(e) => {
                              if (isRecommendation) return;
                              try {
                                e.dataTransfer.effectAllowed = 'move';
                                e.dataTransfer.setData(
                                  'text/plain',
                                  String(dragIdx)
                                );
                              } catch (_) {}
                              setDragFromIdx(dragIdx);
                            }}
                            onDragEnd={() => {
                              setDragFromIdx(null);
                              setDragOverIdx(null);
                            }}
                            {...dropHandlers}
                          >
                            {tileNode}
                          </div>
                        );
                      }
                      return tileNode;
                    })}
                </View>
              ));
            })()}
          </View>

          {/* 옵션 패널 */}
          <View style={[styles.optionsSection, isPhone && styles.optionsSectionPhone]}>
            <View style={styles.optionsHeaderRow}>
              <Text
                style={[styles.optionsTitle, isPhone && styles.optionsTitlePhone, styles.optionsTitleFlex]}
                numberOfLines={1}
              >
                {selectedSlotId
                  ? `옵션 — ${
                      cart.find((i) => i.slotId === selectedSlotId)
                        ?.name || ''
                    }`
                  : '옵션 (장바구니에서 메뉴를 선택하세요)'}
              </Text>
              <TouchableOpacity
                style={[
                  styles.memoBtn,
                  isPhone && styles.memoBtnPhone,
                  !selectedSlotId && styles.memoBtnDisabled,
                ]}
                disabled={!selectedSlotId}
                onPress={() => {
                  const it = cart.find((i) => i.slotId === selectedSlotId);
                  if (!it) return;
                  setMemoPrompt({ slotId: it.slotId, value: it.memo || '' });
                }}
              >
                <Text
                  style={[
                    styles.memoBtnText,
                    isPhone && styles.memoBtnTextPhone,
                    !selectedSlotId && styles.memoBtnTextDisabled,
                  ]}
                  numberOfLines={1}
                >
                  📝 메모
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.optionsEditBtn, isPhone && styles.optionsEditBtnPhone]}
                onPress={() => setOptionsEditOpen(true)}
              >
                <Text
                  style={[styles.optionsEditBtnText, isPhone && styles.optionsEditBtnTextPhone]}
                >
                  ✏️
                </Text>
              </TouchableOpacity>
            </View>
            <View style={styles.optionsGrid}>
              {options.map((opt) => {
                const selectedItem = cart.find(
                  (i) => i.slotId === selectedSlotId
                );
                const isSizeOpt = !!opt.sizeGroup;
                const itemActive =
                  !isSizeOpt &&
                  selectedItem &&
                  (selectedItem.options || []).includes(opt.id);
                const sizeMatches =
                  isSizeOpt &&
                  selectedItem &&
                  selectedItem.sizeGroup === opt.sizeGroup;
                const sizeHasAny =
                  sizeMatches && (selectedItem.largeQty || 0) > 0;
                const enabled = selectedItem
                  ? !isSizeOpt || sizeMatches
                  : false;
                return (
                  <TouchableOpacity
                    key={opt.id}
                    style={[
                      styles.optionBtn,
                      isPhone && styles.optionBtnPhone,
                      itemActive && styles.optionBtnActive,
                      sizeHasAny && styles.optionBtnActive,
                      !enabled && styles.optionBtnDisabled,
                    ]}
                    disabled={!enabled}
                    onPress={() => {
                      if (!tableId || !selectedItem) return;
                      if (!isSizeOpt) {
                        // 옵션이 이미 있으면 토글 오프 → 전체에서 제거
                        const already = (
                          selectedItem.options || []
                        ).includes(opt.id);
                        if (already || selectedItem.qty === 1) {
                          toggleItemOption(
                            tableId,
                            selectedItem.slotId,
                            opt.id
                          );
                          return;
                        }
                        // qty > 1 + 옵션 신규 적용 → 수량 분리 모달
                        setSizePrompt({
                          items: [selectedItem],
                          index: 0,
                          sizeOption: opt,
                          value: 1,
                          mode: 'option',
                        });
                        return;
                      }
                      if (!sizeMatches) return;
                      // 수량 1이면 묻지 말고 바로 대 토글 (일반 옵션과 동일 정책)
                      if (selectedItem.qty === 1) {
                        const sid = selectedItem.slotId || selectedItem.id;
                        const curLarge = selectedItem.largeQty || 0;
                        setItemLargeQty(tableId, sid, curLarge > 0 ? 0 : 1);
                        return;
                      }
                      setSizePrompt({
                        items: [selectedItem],
                        index: 0,
                        sizeOption: opt,
                        value: 1,
                        mode: 'size',
                      });
                    }}
                  >
                    <Text
                      style={[
                        styles.optionLabel,
                        isPhone && styles.optionLabelPhone,
                        (itemActive || sizeHasAny) && styles.optionLabelActive,
                      ]}
                      numberOfLines={1}
                    >
                      {opt.label}
                    </Text>
                    {opt.price != null && (
                      <Text
                        style={[
                          styles.optionPrice,
                          isPhone && styles.optionPricePhone,
                          (itemActive || sizeHasAny) && styles.optionLabelActive,
                        ]}
                        numberOfLines={1}
                      >
                        ({opt.price.toLocaleString()})
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {/* 오른쪽(또는 하단): 장바구니 */}
        <View
          style={[
            styles.cartSide,
            !stacked && { width: cartWidth },
            stacked && styles.cartSideStacked,
          ]}
        >
          <View style={styles.cartHeader}>
            <Text style={styles.cartTitle}>주문 내역</Text>
            <View style={styles.cartHeaderRight}>
              <TouchableOpacity
                style={[
                  styles.micBtn,
                  listening && styles.micBtnActive,
                ]}
                disabled={!tableId}
                onPress={toggleListening}
              >
                <Text style={styles.micIcon}>{listening ? '🔴' : '🎤'}</Text>
              </TouchableOpacity>
              <Text style={styles.cartSubtitle}>{totalQty}개</Text>
            </View>
          </View>

          {listening && (
            <View style={styles.listeningBar}>
              <Text style={styles.listeningTitle}>듣는 중…</Text>
              <Text style={styles.listeningText} numberOfLines={1}>
                {interimText || '메뉴명과 수량을 말하세요 (예: 팥칼 두개, 만백 하나)'}
              </Text>
            </View>
          )}

          <ScrollView style={styles.cartList} contentContainerStyle={{ padding: 12 }}>
            {cart.length === 0 ? (
              <Text style={styles.cartEmpty}>메뉴를 눌러 담으세요</Text>
            ) : (
              (() => {
                // 이 카트 안에서 동일 메뉴의 '대' 포션이 하나라도 존재하는지 맵
                const hasLargeMap = {};
                for (const it of cart) {
                  if ((it.largeQty || 0) > 0) hasLargeMap[it.id] = true;
                }
                return cart;
              })().flatMap((item) => {
                const sid = item.slotId || item.id;
                const lq = item.largeQty || 0;
                const nq = item.qty - lq;
                // 카트 안에 같은 메뉴의 '대'가 존재하면 '보통' 라벨 표시
                const cartHasLarge = cart.some(
                  (it) => it.id === item.id && (it.largeQty || 0) > 0
                );
                const itemOpts = (item.options || [])
                  .map((oid) => options.find((o) => o.id === oid)?.label)
                  .filter(Boolean);
                const rows = [];

                const renderRow = (portionQty, isLargePortion, portion) => {
                  const unitPrice =
                    item.price + (isLargePortion ? item.sizeUpcharge || 0 : 0);
                  const portionSubtotal = unitPrice * portionQty;
                  const rowKey = `${sid}#${portion}`;
                  const isSelected = selectedRowKey === rowKey;
                  return (
                    <TouchableOpacity
                      key={rowKey}
                      onPress={() =>
                        setSelectedRowKey((p) =>
                          p === rowKey ? null : rowKey
                        )
                      }
                      activeOpacity={0.7}
                      style={[
                        styles.cartItem,
                        isSelected && styles.cartItemSelected,
                      ]}
                    >
                      <View style={styles.cartItemTopRow}>
                        <Text style={styles.cartItemName} numberOfLines={1}>
                          {item.name}
                          {isLargePortion && (
                            <Text style={styles.largeBadge}> 대</Text>
                          )}
                          {!isLargePortion && cartHasLarge && (
                            <Text style={styles.normalInlineTag}> 보통</Text>
                          )}
                        </Text>
                        <Text style={styles.cartItemSubtotal} numberOfLines={1}>
                          {portionSubtotal.toLocaleString()}
                        </Text>
                      </View>
                      {itemOpts.length > 0 && (
                        <Text
                          style={styles.cartItemOptions}
                          numberOfLines={1}
                        >
                          • {itemOpts.join(', ')}
                        </Text>
                      )}
                      {item.memo ? (
                        <Text
                          style={styles.cartItemMemo}
                          numberOfLines={2}
                        >
                          📝 {item.memo}
                        </Text>
                      ) : null}
                      <View style={styles.cartItemBottomRow}>
                        <View style={styles.qtyControls}>
                          <TouchableOpacity
                            style={styles.qtyBtn}
                            onPress={(e) => {
                              e.stopPropagation?.();
                              if (isLargePortion) {
                                setItemLargeQty(tableId, sid, lq - 1);
                              } else {
                                removeItem(tableId, sid);
                              }
                            }}
                          >
                            <Text style={styles.qtyBtnText}>−</Text>
                          </TouchableOpacity>
                          <Text style={styles.qtyNum}>{portionQty}</Text>
                          <TouchableOpacity
                            style={styles.qtyBtn}
                            onPress={(e) => {
                              e.stopPropagation?.();
                              if (isLargePortion) {
                                incrementSlotQty(tableId, sid);
                                setItemLargeQty(tableId, sid, lq + 1);
                              } else {
                                incrementSlotQty(tableId, sid);
                              }
                            }}
                          >
                            <Text style={styles.qtyBtnText}>+</Text>
                          </TouchableOpacity>
                        </View>
                        <Text style={styles.cartItemPrice} numberOfLines={1}>
                          @{unitPrice.toLocaleString()}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                };

                if (lq === 0) {
                  rows.push(renderRow(item.qty, false, 'only'));
                } else if (nq === 0) {
                  rows.push(renderRow(lq, true, 'large'));
                } else {
                  rows.push(renderRow(nq, false, 'normal'));
                  rows.push(renderRow(lq, true, 'large'));
                }
                return rows;
              })
            )}
          </ScrollView>

          <View style={[styles.cartFooter, isPhone && styles.cartFooterPhone]}>
            {/* 선택 테이블 + 합계 — 클릭하면 테이블 탭으로 이동해 선택/변경 */}
            <TouchableOpacity
              activeOpacity={0.6}
              onPress={() => onGoToTables?.()}
              style={[
                styles.selectedTableBar,
                isPhone && styles.selectedTableBarPhone,
                isPending && styles.selectedTableBarPending,
                table?.isGroup && styles.selectedTableBarGroup,
              ]}
            >
              <Text
                style={[
                  styles.selectedTableLabel,
                  isPhone && styles.selectedTableLabelPhone,
                ]}
              >
                {isPending ? '⚠' : '🪑'}
              </Text>
              <Text
                style={[
                  styles.selectedTableValue,
                  isPhone && styles.selectedTableValuePhone,
                  isPending && styles.selectedTableValuePending,
                ]}
                numberOfLines={1}
              >
                {isPending
                  ? '미선택'
                  : table?.isGroup
                  ? `👥 ${table.label}`
                  : table?.label || ''}
              </Text>
              <Text
                style={[
                  styles.selectedTableHint,
                  isPhone && styles.selectedTableHintPhone,
                ]}
                numberOfLines={1}
              >
                ▸ 테이블
              </Text>
              <View style={{ flex: 1 }} />
              <Text style={[styles.totalValue, isPhone && styles.totalValuePhone]}>
                {total.toLocaleString()}원
              </Text>
            </TouchableOpacity>

            {/* 현금 5만원 기준 거스름돈 */}
            {total > 0 && (
              <View style={styles.changeRow}>
                {total <= 50000 ? (
                  <Text style={styles.changeText}>
                    💵 5만원 받음 → 거스름돈{' '}
                    <Text style={styles.changeAmount}>
                      {(50000 - total).toLocaleString()}원
                    </Text>
                  </Text>
                ) : (
                  <Text style={styles.changeText}>
                    💵 5만원 부족 →{' '}
                    <Text style={styles.changeShortage}>
                      {(total - 50000).toLocaleString()}원
                    </Text>{' '}
                    추가 필요
                  </Text>
                )}
              </View>
            )}

            {order.paymentStatus === 'paid' && (
              <View style={styles.paidBadge}>
                <Text style={styles.paidBadgeText}>✓ 결제완료 (선불)</Text>
              </View>
            )}

            {order.paymentStatus !== 'paid' ? (
              <>
                {isPending && cart.length > 0 && (
                  <Text style={styles.pendingNoticeText} numberOfLines={2}>
                    ⚠ 테이블 선택 후 주문 가능
                  </Text>
                )}
                {/* 5개 버튼을 한 줄로 합쳐 세로 공간 최소화 */}
                <View style={styles.payRow}>
                  <TouchableOpacity
                    style={[
                      styles.orderBtn,
                      isPhone && styles.payBtnPhone,
                      // 미선택일 때는 클릭 시 테이블 선택으로 안내, 그 외에는 cart 있을 때만 활성.
                      // 이미 확정된 주문이 있어도 cart 변경분을 다시 확정 가능 (변경 음성으로 안내).
                      !isPending && cart.length === 0 && styles.payBtnDisabled,
                    ]}
                    disabled={!isPending && cart.length === 0}
                    onPress={() => {
                      if (isPending) {
                        // 1.0.47: 미선택 + cart 있음 + "주문" → 빈 배달 슬롯 자동 배당 + 확정.
                        // PENDING 에 미리 박힌 주소/전화/별칭(CID 흐름)이 있으면 같이 옮김.
                        if (cart.length > 0) {
                          const targetId = submitPendingAsDelivery({
                            deliveryAddress: order?.deliveryAddress,
                            deliveryPhone: order?.deliveryPhone,
                            deliveryAlias: order?.deliveryAlias,
                          });
                          if (targetId) {
                            const targetTable = {
                              id: targetId,
                              label: `배달${targetId.slice(1)}`,
                              type: 'delivery',
                            };
                            playOrderSound();
                            speakOrder({
                              table: targetTable,
                              order: { ...order, items: cart },
                              menuItems,
                              optionsList: options,
                            });
                            // migrate 가 dispatch 비동기라 다음 마이크로태스크에 확정.
                            setTimeout(() => {
                              confirmOrder(targetId);
                              onBack?.();
                            }, 0);
                          }
                          return;
                        }
                        // cart 비어있으면 단순 테이블 탭 이동.
                        onGoToTables?.();
                        return;
                      }
                      // 이미 확정된 주문이 있고 cart 와 다르면 변경 음성/사운드로 안내,
                      // 그 외(첫 주문이거나 변경 없음)는 새 주문 음성/사운드.
                      if (hasCommittedOrder) {
                        const diff = computeDiffRows(
                          cart,
                          order.confirmedItems || []
                        );
                        const anyChange = diff.some(
                          (r) => r.kind !== 'unchanged'
                        );
                        if (anyChange) {
                          playChangeSound();
                          speakOrderChange({
                            table,
                            diff,
                            menuItems,
                            order: { ...order, items: cart },
                            optionsList: options,
                          });
                        } else {
                          playOrderSound();
                          speakOrder({
                            table,
                            order: { ...order, items: cart },
                            menuItems,
                            optionsList: options,
                          });
                        }
                      } else {
                        playOrderSound();
                        speakOrder({
                          table,
                          order: { ...order, items: cart },
                          menuItems,
                          optionsList: options,
                        });
                      }
                      confirmOrder(tableId);
                      onBack?.();
                    }}
                  >
                    <Text style={[styles.payBtnText, isPhone && styles.payBtnTextPhone]}>주문</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.changeBtn,
                      isPhone && styles.payBtnPhone,
                      (cart.length === 0 || !hasCommittedOrder || isPending) &&
                        styles.payBtnDisabled,
                    ]}
                    disabled={
                      cart.length === 0 || !hasCommittedOrder || isPending
                    }
                    onPress={() => {
                      const diff = computeDiffRows(
                        cart,
                        order.confirmedItems || []
                      );
                      const anyChange = diff.some(
                        (r) => r.kind !== 'unchanged'
                      );
                      playChangeSound();
                      if (anyChange) {
                        speakOrderChange({
                          table,
                          diff,
                          menuItems,
                          order: { ...order, items: cart },
                          optionsList: options,
                        });
                      } else {
                        speakOrder({
                          table,
                          order: { ...order, items: cart },
                          menuItems,
                          optionsList: options,
                        });
                      }
                      confirmOrder(tableId);
                      onBack?.();
                    }}
                  >
                    <Text style={[styles.payBtnText, isPhone && styles.payBtnTextPhone]}>변경</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.clearInlineBtn,
                      isPhone && styles.payBtnPhone,
                      cart.length === 0 &&
                        !hasCommittedOrder &&
                        styles.clearBtnDisabled,
                    ]}
                    disabled={cart.length === 0 && !hasCommittedOrder}
                    onPress={() => {
                      if (isPending) {
                        clearPendingCart?.();
                      } else {
                        clearTable(tableId);
                      }
                    }}
                  >
                    <Text
                      style={[
                        styles.clearBtnText,
                        isPhone && styles.payBtnTextPhone,
                        cart.length === 0 &&
                          !hasCommittedOrder &&
                          styles.clearBtnTextDisabled,
                      ]}
                    >
                      삭제
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.prepaidBtn,
                      isPhone && styles.payBtnPhone,
                      (!hasCommittedOrder || isPending) &&
                        styles.payBtnDisabled,
                    ]}
                    disabled={!hasCommittedOrder || isPending}
                    onPress={() =>
                      setPaymentPicker({
                        mode: 'prepaid',
                        tableId,
                        total: getOrderTotal(tableId),
                      })
                    }
                  >
                    <Text style={[styles.payBtnText, isPhone && styles.payBtnTextPhone]}>선불</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.postpaidBtn,
                      isPhone && styles.payBtnPhone,
                      (!hasCommittedOrder || isPending) &&
                        styles.payBtnDisabled,
                    ]}
                    disabled={!hasCommittedOrder || isPending}
                    onPress={() => {
                      // 1.0.37: 단체 묶음이면 합산/분리 선택 모달 먼저
                      const group = getGroupFor?.(tableId);
                      if (group && group.memberIds && group.memberIds.length > 1) {
                        const ord = getOrder(tableId);
                        const subs = computeSubtotalsBySource(
                          ord?.items || [],
                          tableId
                        );
                        setGroupSplitChoice({
                          tableId,
                          members: group.memberIds,
                          subtotalsBySource: subs,
                        });
                        return;
                      }
                      setPaymentPicker({
                        mode: 'postpaid',
                        tableId,
                        total: getOrderTotal(tableId),
                      });
                    }}
                  >
                    <Text
                      style={[
                        styles.payBtnText,
                        styles.postpaidBtnText,
                        isPhone && styles.payBtnTextPhone,
                      ]}
                    >
                      후불
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <TouchableOpacity
                style={styles.clearTableBtn}
                onPress={() => {
                  clearTable(tableId);
                  onBack?.();
                }}
              >
                <Text style={styles.clearTableBtnText}>테이블 비우기</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      {paymentPicker ? (
        <PaymentMethodPicker
          total={paymentPicker.total}
          title={
            paymentPicker.isSplit
              ? '분리 결제 — 손님별'
              : paymentPicker.mode === 'prepaid'
              ? '선불 결제수단'
              : '후불 결제수단'
          }
          onClose={() => {
            setPaymentPicker(null);
            setSplitPayQueue(null);
          }}
          onSelect={(code, opts) => {
            const { autoPrint, kisApproval } = opts || {};
            const picked = code === 'unspecified' ? null : code;
            const id = paymentPicker.tableId;
            const mode = paymentPicker.mode;
            const isSplit = paymentPicker.isSplit;
            const srcId = paymentPicker.sourceTableId;
            // 결제 직전 receipt 데이터 캡처 — 결제 후 order 가 변경되므로.
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
                .map((oid) => options.find((opt) => opt.id === oid)?.label)
                .filter(Boolean),
            }));
            const tbl = autoPrint ? table : null;
            const receiptData = autoPrint
              ? {
                  storeName: storeInfo?.name || 'MyPos',
                  storePhone: storeInfo?.phone || '',
                  storeAddress: storeInfo?.address || '',
                  businessNumber: storeInfo?.businessNumber || '',
                  receiptFooter: storeInfo?.receiptFooter || '',
                  tableId: id,
                  tableLabel: tbl?.label || id,
                  items: itemsWithLabels,
                  total: paymentPicker.total,
                  paymentMethod: picked,
                  paymentStatus: 'paid',
                  deliveryAddress: orderSnap?.deliveryAddress || '',
                  customerRequest: orderSnap?.deliveryAddress
                    ? getCustomerRequest(addressBook, orderSnap.deliveryAddress)
                    : '',
                  kisApproval: kisApproval || null,
                  printedAt: Date.now(),
                  isSplit: !!isSplit,
                  sourceTableId: srcId || null,
                  sourceTableLabel: srcId
                    ? resolveAnyTable(srcId)?.label || srcId
                    : null,
                }
              : null;

            if (isSplit && srcId) {
              // 1.0.37: 분리 결제 — 해당 손님 슬롯만 정리 + 다음 손님으로
              setPaymentPicker(null);
              clearTableBySource(id, srcId, picked);
              if (receiptData) printReceipt(receiptData).catch(() => {});
              const queue = splitPayQueue;
              const nextRemaining = (queue?.remaining || []).slice(1);
              if (nextRemaining.length > 0) {
                const nextSrc = nextRemaining[0];
                setSplitPayQueue({ ...queue, remaining: nextRemaining });
                setPaymentPicker({
                  mode: 'postpaid',
                  tableId: id,
                  sourceTableId: nextSrc,
                  total: queue.subtotals[nextSrc] || 0,
                  isSplit: true,
                });
              } else {
                setSplitPayQueue(null);
                // 모든 손님 결제 끝 — 마지막은 자동으로 테이블 비워졌음 (reducer 가)
                onBack?.();
              }
              return;
            }

            setPaymentPicker(null);
            // 선불 = 결제만 (테이블 유지). 후불 = 결제 + 테이블 비우기 + 뒤로.
            if (mode === 'prepaid') {
              markPaid(id, picked);
            } else {
              clearTable(id, picked);
              onBack?.();
            }
            // 자동 출력 — receipt 데이터로 비동기 호출. 실패해도 결제 흐름엔 영향 X.
            if (receiptData) {
              printReceipt(receiptData).catch(() => {});
            }
          }}
        />
      ) : null}

      {/* 1.0.37: 단체 묶음 후불 결제 — 합산/분리 선택 모달 */}
      <GroupPaymentSplitPicker
        open={!!groupSplitChoice}
        members={groupSplitChoice?.members || []}
        subtotalsBySource={groupSplitChoice?.subtotalsBySource || {}}
        onChooseCombined={handleSplitCombined}
        onChooseSplit={handleSplitStart}
        onClose={() => setGroupSplitChoice(null)}
      />

      {/* 메뉴 퀵에디트 모달 — 타일 꾹 누르면 이름/가격 바로 수정 */}
      {quickEditItem ? (
        <MenuQuickEditModal
          item={quickEditItem}
          onClose={() => setQuickEditItem(null)}
        />
      ) : null}

      {/* 1.0.26: 신규 메뉴 추가 모달 — 편집 모드 ON 시 빈 [+] 슬롯 클릭 */}
      {menuAddTarget ? (
        <MenuQuickEditModal
          addAt={menuAddTarget}
          onClose={() => setMenuAddTarget(null)}
        />
      ) : null}

      {/* 1.0.36: 단체 묶음 후 메뉴 추가 시 어느 손님인지 묻는 모달 */}
      <TableSourcePicker
        open={groupPickerOpen}
        members={groupPickerMembers}
        lastSourceId={
          (() => {
            const group = getGroupFor?.(tableId);
            return group?.leaderId ? lastSourceByGroup[group.leaderId] : null;
          })()
        }
        onSelect={handleGroupSourceSelect}
        onClose={handleGroupSourceCancel}
      />
    </View>
  );
}
