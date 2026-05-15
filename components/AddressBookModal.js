import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useOrders } from '../utils/OrderContext';
import { useResponsive } from '../utils/useResponsive';
import { getEntryInitial, HANGUL_INDEX_BAR } from '../utils/hangulInitial';

// 배달 주소록 — 검색 / 핀 / 삭제 / 선택.
// pinned 우선, 그 다음 사용 횟수 desc, 그 다음 lastUsedAt desc.
// 당일 배송 완료된 항목은 회색 처리(별도 섹션 분리하지는 않음 — 한 리스트에서 시각적으로만 구분).
export default function AddressBookModal({ visible, onClose, onSelect }) {
  const { scale, height: viewportH } = useResponsive();
  // viewport 높이에 따라 ScrollView 최대 높이 동적 계산 — 폰 가로(viewport 430)
  // 에서 sheet maxHeight 90% = 387 안에 header(50)+search(50)+indexBar(46)+여유(16)
  // = 162 가 들어가야 하므로 ScrollView 는 225 까지만. PC(viewport 800) 에선
  // sheet 720 안에 충분히 들어가 420 까지 자연스럽게 사용.
  const styles = useMemo(() => makeStyles(scale, viewportH), [scale, viewportH]);
  const { addressBook, pinAddress, deleteAddress, setAlias, setPhone, addAddress } = useOrders();
  const [query, setQuery] = useState('');
  // 편집 중인 항목 key. null = 편집 없음.
  const [editingKey, setEditingKey] = useState(null);
  const [editAlias, setEditAlias] = useState('');
  const [editPhone, setEditPhone] = useState('');
  // 새 주소 추가 폼
  const [addingNew, setAddingNew] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newAlias, setNewAlias] = useState('');
  const [newPhone, setNewPhone] = useState('');
  // 정렬 모드 — 'default' (핀/카운트) | 'alpha' (가나다)
  // 인덱스 바 글자 클릭 시 자동 alpha + 점프. ⭐ 클릭 시 default 복귀.
  const [sortMode, setSortMode] = useState('default');
  // alpha 모드 진입 직후 점프 대기 — useEffect 가 items 갱신된 다음 처리.
  const [pendingJump, setPendingJump] = useState(null);
  // 각 row 의 DOM node (RN-web) 추적 → scrollIntoView 점프용. native 는 noop.
  const rowRefs = useRef({});
  // ScrollView ref + 각 row 의 y offset — native 환경에서 scrollTo 점프용.
  // RN-Web 의 scrollIntoView 가 native 에선 작동 안 함 → scrollTo + offset 패턴
  // 으로 web/native 통합.
  const listRef = useRef(null);
  const rowOffsetsRef = useRef({});
  // 인덱스 바 드래그 — 현재 호버 글자 큰 미리보기 표시 (iPhone 연락처 패턴).
  const [activeHover, setActiveHover] = useState(null);
  const barWidthRef = useRef(0);
  const lastIdxRef = useRef(-1);
  // 인덱스 항목 — ⭐ (자주 정렬) + 14자음 + A + # = 17개. memo 로 안정성.
  const indexItems = useMemo(() => ['⭐', ...HANGUL_INDEX_BAR], []);

  const todaySet = useMemo(
    () => new Set(addressBook.todayDeliveredKeys || []),
    [addressBook.todayDeliveredKeys]
  );

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    // 1.0.50: 주소·별칭·전화번호 3가지 모두 검색 (AddressBookPanel 과 통일).
    //   기존: label(주소)만 → "사하구 사하로... (별칭) 김진사" 일 때 "김진사" 검색 불가.
    //   사용자 보고: 주소지 있을 때 별칭 검색 안 되는 버그.
    const qDigits = q.replace(/\D/g, '');
    const arr = Object.values(addressBook.entries || {});
    const filtered = q
      ? arr.filter(
          (e) =>
            (e.label || '').toLowerCase().includes(q) ||
            (e.alias || '').toLowerCase().includes(q) ||
            (qDigits && (e.phone || '').includes(qDigits))
        )
      : arr;
    return filtered.sort((a, b) => {
      if (sortMode === 'alpha') {
        // 가나다 정렬 — 초성 인덱스 → 같은 초성 내 별칭/라벨 가나다.
        const ka = getEntryInitial(a);
        const kb = getEntryInitial(b);
        const idxA = HANGUL_INDEX_BAR.indexOf(ka);
        const idxB = HANGUL_INDEX_BAR.indexOf(kb);
        if (idxA !== idxB) return idxA - idxB;
        const na = ((a.alias || '').trim() || a.label || '').toLowerCase();
        const nb = ((b.alias || '').trim() || b.label || '').toLowerCase();
        return na.localeCompare(nb, 'ko');
      }
      // default 정렬 — 핀 우선 → 같은 핀 그룹에서 오늘 미완료 우선 → 카운트 → 최근.
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      const at = todaySet.has(a.key);
      const bt = todaySet.has(b.key);
      if (at !== bt) return at ? 1 : -1;
      const ca = a.count || 0;
      const cb = b.count || 0;
      if (cb !== ca) return cb - ca;
      return (b.lastUsedAt || 0) - (a.lastUsedAt || 0);
    });
  }, [addressBook.entries, query, todaySet, sortMode]);

  // 인덱스 바 클릭 → 가나다 모드 + 다음 tick 에 첫 매칭 entry 로 스크롤.
  // 우선순위: ScrollView.scrollTo (web + native 모두 지원) → scrollIntoView (web fallback).
  useEffect(() => {
    if (!pendingJump || sortMode !== 'alpha') return;
    const target = items.find((e) => getEntryInitial(e) === pendingJump);
    setPendingJump(null);
    if (!target) return;
    // 1) ScrollView.scrollTo + 측정된 row y offset — native + web 통합.
    const y = rowOffsetsRef.current[target.key];
    if (
      listRef.current &&
      typeof listRef.current.scrollTo === 'function' &&
      typeof y === 'number'
    ) {
      try {
        listRef.current.scrollTo({ y: Math.max(0, y - 4), animated: true });
        return;
      } catch (_) {}
    }
    // 2) RN-Web fallback — scrollIntoView (네이티브에선 NOOP).
    const node = rowRefs.current[target.key];
    if (node && typeof node.scrollIntoView === 'function') {
      try {
        node.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (_) {}
    }
  }, [pendingJump, sortMode, items]);

  const jumpToInitial = (initial) => {
    setSortMode('alpha');
    setPendingJump(initial);
  };

  const resetSort = () => {
    setSortMode('default');
    setPendingJump(null);
  };

  // 인덱스 바 드래그/탭 → locationY 로 항목 결정 → 점프 + hover preview.
  // closure stale 방지 — fnsRef 통해 최신 jumpToInitial/resetSort 사용.
  const fnsRef = useRef({ jumpToInitial, resetSort });
  useEffect(() => {
    fnsRef.current = { jumpToInitial, resetSort };
  });

  // 인덱스 바는 list 하단의 가로 한 줄 — locationX 로 항목 결정.
  // 폰 가로 모드(932×430)에서 세로 17개가 잘리는 문제 해결 + 매장 POS 가로 화면에 자연스러움.
  //
  // 좌표계 정책 (2026-05-16):
  //   - iOS Safari 의 RN-Web 에서 nativeEvent.locationX 가 0 또는 잘못된 좌표로
  //     들어오는 함정 (PanResponder grant 시점에 target 좌표계가 부정확).
  //     → ㅋ 클릭해도 ⭐ 가 잡히고, 드래그가 ㄱㄴ 까지만 따라가다 다시 ⭐ 로
  //     돌아오는 사고 발생.
  //   - 해결: nativeEvent.pageX 와 indexBar 의 page left 차이로 직접 계산.
  //     pageX 는 모든 브라우저에서 정확. barLeftRef 는 onLayout 시 측정.
  const barRef = useRef(null);
  const barLeftRef = useRef(0);
  const computeLocalX = (evt) => {
    const native = evt?.nativeEvent || {};
    // 우선순위: pageX > locationX (pageX 가 더 robust).
    if (typeof native.pageX === 'number') {
      return native.pageX - (barLeftRef.current || 0);
    }
    return typeof native.locationX === 'number' ? native.locationX : 0;
  };
  const handleBarTouch = (localX) => {
    const w = barWidthRef.current;
    if (!w || localX < 0 || localX > w + 4) return; // 바 영역 밖이면 무시
    const idx = Math.max(
      0,
      Math.min(
        indexItems.length - 1,
        Math.floor((localX / w) * indexItems.length)
      )
    );
    if (idx === lastIdxRef.current) return;
    lastIdxRef.current = idx;
    const ch = indexItems[idx];
    setActiveHover(ch);
    if (ch === '⭐') fnsRef.current.resetSort();
    else fnsRef.current.jumpToInitial(ch);
  };

  const barPanResponder = useMemo(
    () =>
      PanResponder.create({
        // Capture 우선권 — RN native 에서 자식 element 또는 부모 Pressable 이
        // touch 를 가로채기 전에 인덱스 바가 먼저 받음. iPhone native 앱에서
        // PanResponder 못 받던 사고의 핵심 fix.
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false, // 다른 component 가 가로채려해도 거부
        onPanResponderGrant: (e) => {
          lastIdxRef.current = -1; // 새 드래그 시작 → 같은 위치도 재호출
          handleBarTouch(computeLocalX(e));
        },
        onPanResponderMove: (e) => {
          handleBarTouch(computeLocalX(e));
        },
        onPanResponderRelease: () => {
          // 손가락 떼면 0.8초 후 hover preview 사라짐 — 사용자가 결과 인지할 시간.
          setTimeout(() => setActiveHover(null), 800);
        },
        onPanResponderTerminate: () => setActiveHover(null),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // 삭제는 되돌릴 수 없음 (Firestore hard delete) — 한 번 더 확인.
  // 인덱스 바 드래그 도중 실수 클릭으로 삭제되는 사고 방지.
  const handleDelete = (it) => {
    const label = (it.alias || '').trim() || it.label || '항목';
    const confirmMsg = `"${label}" 을(를) 주소록에서 삭제할까요?\n삭제하면 되돌릴 수 없습니다.`;
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm) {
        if (!window.confirm(confirmMsg)) return;
        deleteAddress(it.key);
      } else {
        deleteAddress(it.key);
      }
    } else {
      Alert.alert('삭제 확인', confirmMsg, [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: () => deleteAddress(it.key),
        },
      ]);
    }
  };

  const handleSelect = (label) => {
    onSelect && onSelect(label);
    onClose && onClose();
  };

  const openEdit = (it) => {
    setEditingKey(it.key);
    setEditAlias(it.alias || '');
    setEditPhone(it.phone ? formatPhoneDisplay(it.phone) : '');
  };

  const confirmEdit = () => {
    if (!editingKey) return;
    setAlias(editingKey, editAlias);
    setPhone(editingKey, editPhone);
    setEditingKey(null);
  };

  const cancelEdit = () => setEditingKey(null);

  const confirmAdd = () => {
    if (!newLabel.trim()) return;
    addAddress(newLabel.trim(), newAlias.trim(), newPhone);
    setAddingNew(false);
    setNewLabel('');
    setNewAlias('');
    setNewPhone('');
  };

  const cancelAdd = () => {
    setAddingNew(false);
    setNewLabel('');
    setNewAlias('');
    setNewPhone('');
  };

  if (!visible) return null;

  return (
    <View style={styles.overlay} pointerEvents="auto">
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View
          style={styles.sheet}
          // RN native: Pressable sheet 가 child PanResponder 의 touch 를
          // 가로채는 사고 → 인덱스 바 드래그 작동 안 함.
          // View + responder system 패턴 — 자식 PanResponder (true 반환) 가
          // 우선권 차지 + 자식이 못 받는 빈 영역 touch 는 sheet 가 흡수해
          // backdrop(부모) 으로 bubble 되지 않게 함 (모달 실수 close 방지).
          onStartShouldSetResponder={() => true}
          onResponderTerminationRequest={() => false}>
          <View style={styles.header}>
            <Text style={styles.title}>배달 주소록</Text>
            <View style={styles.headerRight}>
              <TouchableOpacity
                style={styles.addBtn}
                onPress={() => setAddingNew(true)}
                hitSlop={6}
              >
                <Text style={styles.addBtnText}>+ 추가</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onClose} hitSlop={8}>
                <Text style={styles.closeBtn}>닫기</Text>
              </TouchableOpacity>
            </View>
          </View>

          {addingNew && (
            <View style={styles.newBox}>
              <View style={styles.editRow}>
                <Text style={styles.editFieldLabel}>주소</Text>
                <TextInput
                  style={styles.editInput}
                  value={newLabel}
                  onChangeText={setNewLabel}
                  placeholder="예) 부산 사하구 사하로 47"
                  placeholderTextColor="#9ca3af"
                  maxLength={100}
                  autoFocus
                />
              </View>
              <View style={styles.editRow}>
                <Text style={styles.editFieldLabel}>별칭</Text>
                <TextInput
                  style={styles.editInput}
                  value={newAlias}
                  onChangeText={setNewAlias}
                  placeholder="예) 김사장 (선택)"
                  placeholderTextColor="#9ca3af"
                  maxLength={20}
                />
              </View>
              <View style={styles.editRow}>
                <Text style={styles.editFieldLabel}>전화번호</Text>
                <TextInput
                  style={styles.editInput}
                  value={newPhone}
                  onChangeText={setNewPhone}
                  placeholder="예) 010-1234-5678 (선택)"
                  placeholderTextColor="#9ca3af"
                  keyboardType="phone-pad"
                  maxLength={14}
                />
              </View>
              <View style={styles.editActions}>
                <TouchableOpacity style={styles.editConfirmBtn} onPress={confirmAdd}>
                  <Text style={styles.editConfirmText}>등록</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.editCancelBtn} onPress={cancelAdd}>
                  <Text style={styles.editCancelText}>취소</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View style={styles.searchRow}>
            <Text style={styles.searchIcon}>🔍</Text>
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="주소·별칭·전화번호 검색"
              placeholderTextColor="#9ca3af"
              autoFocus={false}
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
                <Text style={styles.clearBtn}>×</Text>
              </TouchableOpacity>
            )}
          </View>

          {items.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                {query
                  ? '검색 결과가 없습니다'
                  : '저장된 배달 주소가 없습니다'}
              </Text>
              <Text style={styles.emptyHint}>
                배달이 완료되면 자동으로 등록됩니다
              </Text>
            </View>
          ) : (
            <View style={styles.listWithIndex}>
            <ScrollView ref={listRef} style={styles.list}>
              {items.map((it) => {
                const isToday = todaySet.has(it.key);
                const isEditing = editingKey === it.key;
                return (
                  <View
                    key={it.key}
                    onLayout={(e) => {
                      // native 환경 scrollTo 점프용 — row 의 ScrollView 안 y offset 저장.
                      rowOffsetsRef.current[it.key] = e.nativeEvent.layout.y;
                    }}
                    ref={(node) => {
                      // RN-web 의 View ref → HTMLDivElement (scrollIntoView 가능).
                      // native 는 RN 컴포넌트 — scrollIntoView 없어 점프 noop.
                      if (node) rowRefs.current[it.key] = node;
                      else delete rowRefs.current[it.key];
                    }}
                    style={[styles.row, isToday && styles.rowToday]}
                  >
                    {isEditing ? (
                      // ── 편집 모드 ──────────────────────────────────────
                      <View style={styles.editBox}>
                        <Text style={styles.editLabel} numberOfLines={1}>{it.label}</Text>
                        <View style={styles.editRow}>
                          <Text style={styles.editFieldLabel}>별칭</Text>
                          <TextInput
                            style={styles.editInput}
                            value={editAlias}
                            onChangeText={setEditAlias}
                            placeholder="예) 김사장"
                            placeholderTextColor="#9ca3af"
                            maxLength={20}
                            autoFocus
                          />
                        </View>
                        <View style={styles.editRow}>
                          <Text style={styles.editFieldLabel}>전화번호</Text>
                          <TextInput
                            style={styles.editInput}
                            value={editPhone}
                            onChangeText={setEditPhone}
                            placeholder="예) 010-1234-5678"
                            placeholderTextColor="#9ca3af"
                            keyboardType="phone-pad"
                            maxLength={14}
                          />
                        </View>
                        <View style={styles.editActions}>
                          <TouchableOpacity style={styles.editConfirmBtn} onPress={confirmEdit}>
                            <Text style={styles.editConfirmText}>저장</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.editCancelBtn} onPress={cancelEdit}>
                            <Text style={styles.editCancelText}>취소</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      // ── 일반 모드 ──────────────────────────────────────
                      <>
                        <TouchableOpacity
                          style={styles.rowMain}
                          onPress={() => handleSelect(it.label)}
                          activeOpacity={0.6}
                        >
                          {it.alias ? (
                            <Text style={styles.rowAlias} numberOfLines={1}>
                              👤 {it.alias}
                            </Text>
                          ) : null}
                          <Text
                            style={[
                              styles.rowLabel,
                              isToday && styles.rowLabelToday,
                            ]}
                            numberOfLines={2}
                          >
                            {it.label}
                          </Text>
                          <View style={styles.rowMeta}>
                            <Text style={styles.rowCount}>×{it.count || 0}</Text>
                            {it.phone ? (
                              <Text style={styles.rowPhone}>
                                {formatPhoneDisplay(it.phone)}
                              </Text>
                            ) : null}
                            {isToday && (
                              <Text style={styles.todayBadge}>오늘 완료</Text>
                            )}
                          </View>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.iconBtn}
                          onPress={() => openEdit(it)}
                          hitSlop={6}
                        >
                          <Text style={styles.iconText}>✏️</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.iconBtn}
                          onPress={() => pinAddress(it.key, !it.pinned)}
                          hitSlop={6}
                        >
                          <Text
                            style={[
                              styles.iconText,
                              it.pinned && styles.iconTextActive,
                            ]}
                          >
                            {it.pinned ? '📌' : '📍'}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.iconBtn}
                          onPress={() => handleDelete(it)}
                          hitSlop={6}
                        >
                          <Text style={styles.deleteText}>🗑</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                );
              })}
            </ScrollView>
            <View
              ref={barRef}
              style={styles.indexBar}
              onLayout={(e) => {
                barWidthRef.current = e.nativeEvent.layout.width;
                // page 기준 left 측정 — RN-Web 에서 ref→HTMLDivElement.
                // pageX - barLeft 로 정확한 local x 계산 (locationX 함정 우회).
                const node = barRef.current;
                if (node && typeof node.getBoundingClientRect === 'function') {
                  barLeftRef.current = node.getBoundingClientRect().left;
                }
              }}
              accessibilityLabel="가나다 빠른찾기 — 탭 또는 좌우 드래그"
              {...barPanResponder.panHandlers}
            >
              {indexItems.map((ch, idx) => {
                const isStar = ch === '⭐';
                const isHovered = activeHover === ch;
                const isModeActive =
                  (isStar && sortMode === 'default') ||
                  (!isStar && sortMode === 'alpha');
                return (
                  <View key={`${ch}-${idx}`} style={styles.indexBtn}>
                    <Text
                      style={[
                        isStar ? styles.indexStar : styles.indexText,
                        isModeActive && styles.indexActive,
                        isHovered && styles.indexHovered,
                      ]}
                    >
                      {ch}
                    </Text>
                  </View>
                );
              })}
            </View>
            </View>
          )}
          {activeHover && (
            <View pointerEvents="none" style={styles.hoverPreview}>
              <Text style={styles.hoverPreviewText}>{activeHover}</Text>
            </View>
          )}
        </View>
      </Pressable>
    </View>
  );
}

// 저장된 digits → 표시용 포맷 (01012341234 → 010-1234-1234)
function formatPhoneDisplay(digits) {
  const d = (digits || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('010')) {
    return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  }
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
  return d;
}

// scale: useResponsive() 의 폰트 배율(lg=1.3, 그 외 1.0).
function makeStyles(scale = 1, viewportH = 800) {
  // sheet 의 실제 사용 가능 영역 계산 (2026-05-16 4차 fix):
  //   - backdrop padding 16*2 = 32 차감
  //   - 폰(viewport<500) 은 Safari URL bar 동적 영역 + 여유 위해 80%
  //   - PC 는 충분한 여유로 90%
  //   - reserved 180 = header(54) + search(50) + indexBar(50) + 여유(26)
  const isPhone = viewportH < 500;
  const sheetMaxH = (viewportH - 32) * (isPhone ? 0.8 : 0.9);
  const scrollMaxH = Math.max(100, Math.min(420, sheetMaxH - 180));
  const fp = (n) => Math.round(n * scale);
  return StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    elevation: 9999,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  sheet: {
    width: '100%',
    maxWidth: 520,
    maxHeight: sheetMaxH,
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#ef4444',
  },
  title: { fontSize: fp(16), fontWeight: '900', color: '#fff' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  addBtn: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  addBtnText: { fontSize: fp(12), fontWeight: '800', color: '#fff' },
  closeBtn: { fontSize: fp(13), fontWeight: '700', color: '#fff' },
  newBox: {
    padding: 12,
    backgroundColor: '#f0fdf4',
    borderBottomWidth: 1,
    borderBottomColor: '#bbf7d0',
    gap: 6,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    gap: 6,
  },
  searchIcon: { fontSize: fp(14) },
  searchInput: {
    flex: 1,
    fontSize: fp(14),
    color: '#111827',
    paddingVertical: 6,
    outlineStyle: 'none',
  },
  clearBtn: {
    fontSize: fp(18),
    fontWeight: '700',
    color: '#9ca3af',
    paddingHorizontal: 6,
  },
  empty: { padding: 32, alignItems: 'center', gap: 6 },
  emptyText: { fontSize: fp(14), color: '#6b7280', fontWeight: '600' },
  emptyHint: { fontSize: fp(11), color: '#9ca3af' },
  // 동적 maxHeight (2026-05-16 3차 fix): viewport 크기에 따라 ScrollView 영역
  // 자동 조절. 폰 가로(viewport 430) 에서 sheet maxHeight 90%=387 안에 indexBar
  // 까지 모두 들어가도록 scrollMaxH 가 225 로 줄어듦. PC 에선 420.
  // flex 의존 X (yoga 가 부모 height auto + flex:1 자식을 0 으로 평가하는 함정 회피).
  list: { maxHeight: scrollMaxH },
  listWithIndex: { flexDirection: 'column' },
  indexBar: {
    flexDirection: 'row',
    width: '100%',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    backgroundColor: '#f9fafb',
    alignItems: 'center',
    justifyContent: 'space-between',
    // 드래그 시 텍스트 선택 방지 (RN-web).
    userSelect: 'none',
    cursor: 'pointer',
    // iOS Safari: 기본 touch-action(=auto) 이면 가로 스와이프가 페이지 동작에
    // 흡수되어 RN-Web PanResponder 의 onPanResponderMove 가 안 들어옴
    // → PC 에선 정상이지만 폰 Safari 에서 드래그가 첫 탭만 인식되는 사고.
    // 'none' 으로 모든 default touch 동작 차단 → PanResponder 가 모든 move 수신.
    touchAction: 'none',
  },
  indexBtn: {
    flex: 1,
    paddingHorizontal: 2,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indexText: {
    fontSize: fp(14),
    fontWeight: '900',
    color: '#6b7280',
    textAlign: 'center',
  },
  indexStar: {
    fontSize: fp(15),
    textAlign: 'center',
    opacity: 0.55,
  },
  indexActive: {
    color: '#2563eb',
    opacity: 1,
  },
  // 드래그 중 호버 표시 — 큰 글자 + 굵게 + 빨강.
  indexHovered: {
    color: '#dc2626',
    transform: [{ scale: 1.25 }],
    opacity: 1,
  },
  // iPhone 연락처 패턴 — 드래그 중 화면 가운데에 큰 글자 띄움.
  hoverPreview: {
    position: 'absolute',
    top: '38%',
    alignSelf: 'center',
    width: 110,
    height: 110,
    borderRadius: 18,
    backgroundColor: 'rgba(17, 24, 39, 0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    elevation: 16,
  },
  hoverPreviewText: {
    fontSize: 60,
    fontWeight: '900',
    color: '#fff',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    gap: 4,
  },
  rowToday: { backgroundColor: '#f9fafb' },
  rowMain: { flex: 1, minWidth: 0, paddingHorizontal: 4, paddingVertical: 2 },
  rowLabel: { fontSize: fp(13), fontWeight: '700', color: '#111827' },
  rowLabelToday: {
    color: '#9ca3af',
    textDecorationLine: 'line-through',
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  rowCount: { fontSize: fp(11), fontWeight: '700', color: '#dc2626' },
  todayBadge: {
    fontSize: fp(9),
    color: '#fff',
    fontWeight: '900',
    backgroundColor: '#9ca3af',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    overflow: 'hidden',
  },
  iconBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  iconText: { fontSize: fp(16), opacity: 0.5 },
  iconTextActive: { opacity: 1 },
  deleteText: { fontSize: fp(14), opacity: 0.6 },
  rowAlias: {
    fontSize: fp(12),
    fontWeight: '800',
    color: '#2563eb',
    marginBottom: 1,
  },
  rowPhone: {
    fontSize: fp(10),
    color: '#6b7280',
    fontWeight: '500',
  },
  // 편집 모드
  editBox: {
    flex: 1,
    paddingHorizontal: 4,
    paddingVertical: 6,
    gap: 6,
  },
  editLabel: {
    fontSize: fp(11),
    color: '#9ca3af',
    fontWeight: '500',
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  editFieldLabel: {
    fontSize: fp(11),
    color: '#6b7280',
    fontWeight: '700',
    width: 50,
  },
  editInput: {
    flex: 1,
    fontSize: fp(13),
    color: '#111827',
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    outlineStyle: 'none',
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 2,
  },
  editConfirmBtn: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
  },
  editConfirmText: {
    color: '#fff',
    fontSize: fp(12),
    fontWeight: '800',
  },
  editCancelBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  editCancelText: {
    color: '#9ca3af',
    fontSize: fp(12),
    fontWeight: '700',
  },
  });
}
