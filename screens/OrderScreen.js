import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ImageBackground,
  KeyboardAvoidingView,
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
import AddressBookModal from '../components/AddressBookModal';
import AddressChips from '../components/AddressChips';
import PaymentMethodPicker from '../components/PaymentMethodPicker';
import { useStore } from '../utils/StoreContext';
import { printReceipt } from '../utils/printReceipt';
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

export default function OrderScreen({
  table,
  onBack,
  onGoToTables,
  onRequestOrderWithTable,
  autoConfirmIntent,
  clearAutoConfirmIntent,
}) {
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
  // 결제수단 선택 모달 — { mode: 'prepaid' | 'postpaid', tableId, total } | null
  // 선불/후불 버튼이 누르면 모달 띄움 → 사용자 결제수단 선택 → markPaid/clearTable 호출.
  const [paymentPicker, setPaymentPicker] = useState(null);
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
    setItemLargeQty,
    setItemMemo,
    migratePendingCart,
    clearPendingCart,
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
  // 실제 테이블이 없어도(주문 탭 선진입) PENDING 가상 테이블로 장바구니를 담는다.
  const hasRealTable = !!table?.id;
  const isPending = !hasRealTable;
  const tableId = hasRealTable ? table.id : PENDING_TABLE_ID;
  const order = getOrder(tableId);
  // 장바구니 = 편집중 내역. items = 이미 주방/테이블에 확정 커밋된 내역.
  const cart = order.cartItems ?? order.items ?? [];
  const committedItems = order.items ?? [];
  const total = getCartTotal(tableId);
  const totalQty = getCartQty(tableId);
  const hasCommittedOrder = committedItems.length > 0;

  const menuById = Object.fromEntries(menuItems.map((m) => [m.id, m]));
  const currentRows = categoryRows[activeCategory] || [];

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
        {table?.type === 'delivery' ? (
          <View style={styles.headerAddressWrap}>
            <Text style={styles.deliveryLabel}>📍</Text>
            <TextInput
              style={[styles.deliveryInput, styles.deliveryInputCompact]}
              value={order.deliveryAddress || ''}
              onChangeText={(v) => tableId && setDeliveryAddress(tableId, v)}
              placeholder="주소"
              placeholderTextColor="#9ca3af"
            />
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
              placeholder="4:20"
              placeholderTextColor="#9ca3af"
              maxLength={5}
              keyboardType="numeric"
            />
          </View>
        ) : (
          <Text style={styles.tableHeaderHint}>
            {table
              ? ''
              : '메뉴를 담은 뒤 [주문] 을 누르세요'}
          </Text>
        )}
      </View>

      {table?.type === 'delivery' && (
        <AddressBookModal
          visible={addressBookOpen}
          onClose={() => setAddressBookOpen(false)}
          onSelect={(label) => tableId && setDeliveryAddress(tableId, label)}
        />
      )}

      <View style={[styles.body, stacked && styles.bodyStacked]}>
        {/* 왼쪽: 메뉴 영역 */}
        <View style={styles.menuSide}>
          {/* 카테고리 탭 */}
          <View style={styles.categoryBar}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {categories.map((cat) => {
                const active = activeCategory === cat;
                return (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.categoryTab, isPhone && styles.categoryTabPhone, active && styles.categoryTabActive]}
                    onPress={() => setActiveCategory(cat)}
                  >
                    <Text
                      style={[
                        styles.categoryText,
                        isPhone && styles.categoryTextPhone,
                        active && styles.categoryTextActive,
                      ]}
                    >
                      {cat}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* 메뉴 그리드 - 모든 카테고리에서 6×4 격자, 드래그로 자유롭게 이동 */}
          {/* 한 화면에 모든 행이 들어가도록 외부 스크롤 제거 */}
          <View style={styles.favGrid}>
            {(() => {
              const isWeb = Platform.OS === 'web';
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
                        const emptyBox = (
                          <View
                            key={`empty-${rowIdx}-${cellIdx}`}
                            style={[
                              {
                                width: menuTileWidth,
                                minHeight: 0,
                              },
                              styles.tileEmptySlot,
                              isDragTarget && styles.tileDragTarget,
                            ]}
                          />
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
                              // 비율 제약 제거 — 세로는 행 flex 로 자동 스트레치(alignItems: stretch).
                              // 테이블 선택 상태에서 헤더가 높이를 잡아먹어도 4행이 모두 보이도록.
                              aspectRatio: undefined,
                              minHeight: 0,
                            },
                            isDragging && styles.tileDragging,
                            isDragTarget && styles.tileDragTarget,
                          ]}
                          activeOpacity={0.7}
                          onPress={() => {
                            if (!tableId) return;
                            const def = cart.find(
                              (x) =>
                                x.id === item.id &&
                                (x.options || []).length === 0 &&
                                !x.memo &&
                                (x.cookState || 'pending') === 'pending' &&
                                !x.cookStateNormal &&
                                !x.cookStateLarge
                            );
                            const targetId = def
                              ? def.slotId
                              : genSlotId();
                            const hasLarge = def && (def.largeQty || 0) > 0;
                            addItem(tableId, item, targetId);
                            setSelectedRowKey(
                              `${targetId}#${hasLarge ? 'normal' : 'only'}`
                            );
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
                            draggable
                            onDragStart={(e) => {
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
                        // cart 가 비어있지 않으면 자동 확정 의도와 함께 테이블 탭으로,
                        // 비어있으면 단순 이동.
                        if (cart.length > 0 && onRequestOrderWithTable) {
                          onRequestOrderWithTable();
                        } else {
                          onGoToTables?.();
                        }
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
                    onPress={() =>
                      setPaymentPicker({
                        mode: 'postpaid',
                        tableId,
                        total: getOrderTotal(tableId),
                      })
                    }
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
          title={paymentPicker.mode === 'prepaid' ? '선불 결제수단' : '후불 결제수단'}
          onClose={() => setPaymentPicker(null)}
          onSelect={(code, autoPrint) => {
            const picked = code === 'unspecified' ? null : code;
            const id = paymentPicker.tableId;
            const mode = paymentPicker.mode;
            // 결제 직전 receipt 데이터 캡처 — markPaid/clearTable 후 order 가 변경되므로.
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
    </View>
  );
}
