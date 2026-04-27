import { useEffect, useMemo, useRef } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useOrders } from '../utils/OrderContext';
import { useResponsive } from '../utils/useResponsive';

// 자주 쓰는 배달 주소 상위 N개를 가로 스크롤 칩으로 노출.
// 정렬: pinned 우선 → 오늘 미완료 우선(완료된 것은 뒤로) → count desc → lastUsedAt desc.
// 당일 배송 완료된 주소는 회색 + 우측으로 밀려나지만 눌러서 입력은 가능.
export default function AddressChips({ onSelect, max = 8, compact = false, inline = false }) {
  const { scale } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);
  const { addressBook } = useOrders();
  const scrollRef = useRef(null);
  // 드래그 거리 추적 — 5px 미만 이동은 클릭으로 간주 (칩 onPress 보존)
  const dragRef = useRef({ down: false, startX: 0, startScroll: 0, moved: 0 });

  // 웹에서만: 마우스 휠을 가로 스크롤로 변환 + 마우스 드래그로 스와이프 가능.
  // 모바일/태블릿 터치는 RN ScrollView 기본 동작으로 충분.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const sv = scrollRef.current;
    if (!sv) return;
    const node =
      typeof sv.getScrollableNode === 'function'
        ? sv.getScrollableNode()
        : sv;
    if (!node || !node.addEventListener) return;

    const onWheel = (e) => {
      // 트랙패드 가로 제스처(deltaX)면 그대로 둠. 휠(deltaY)을 가로로 변환.
      if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      if (e.deltaY === 0) return;
      node.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    const onDown = (e) => {
      dragRef.current = {
        down: true,
        startX: e.pageX,
        startScroll: node.scrollLeft,
        moved: 0,
      };
      node.style.cursor = 'grabbing';
    };
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d.down) return;
      const dx = e.pageX - d.startX;
      d.moved = Math.abs(dx);
      if (d.moved > 3) {
        node.scrollLeft = d.startScroll - dx;
        e.preventDefault();
      }
    };
    const onUp = () => {
      dragRef.current.down = false;
      node.style.cursor = '';
    };

    node.addEventListener('wheel', onWheel, { passive: false });
    node.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      node.removeEventListener('wheel', onWheel);
      node.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const todaySet = useMemo(
    () => new Set(addressBook.todayDeliveredKeys || []),
    [addressBook.todayDeliveredKeys]
  );

  const items = useMemo(() => {
    const arr = Object.values(addressBook.entries || {});
    return arr
      .sort((a, b) => {
        // 오늘 완료된 항목은 무조건 뒤로 (핀 고정이라도 회색 처리되면 뒤로 보냄)
        const at = todaySet.has(a.key);
        const bt = todaySet.has(b.key);
        if (at !== bt) return at ? 1 : -1;
        // 오늘 미완료끼리는 핀 우선
        if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
        const ca = a.count || 0;
        const cb = b.count || 0;
        if (cb !== ca) return cb - ca;
        return (b.lastUsedAt || 0) - (a.lastUsedAt || 0);
      })
      .slice(0, max);
  }, [addressBook.entries, todaySet, max]);

  if (items.length === 0) return null;

  return (
    <View
      style={[
        styles.wrap,
        compact && styles.wrapCompact,
        inline && styles.wrapInline,
      ]}
    >
      <Text
        style={[styles.label, compact && styles.labelCompact]}
        numberOfLines={1}
      >
        자주
      </Text>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        style={Platform.OS === 'web' ? styles.scrollWeb : null}
      >
        {items.map((it) => {
          const isToday = todaySet.has(it.key);
          return (
            <TouchableOpacity
              key={it.key}
              style={[
                styles.chip,
                compact && styles.chipCompact,
                it.pinned && styles.chipPinned,
                isToday && styles.chipToday,
              ]}
              activeOpacity={0.7}
              onPress={() => {
                // 드래그 중이었으면 클릭 무시 (오선택 방지)
                if (dragRef.current.moved > 3) return;
                onSelect && onSelect(it.label);
              }}
            >
              {it.pinned && <Text style={styles.pinIcon}>📌</Text>}
              <Text
                style={[
                  styles.chipText,
                  compact && styles.chipTextCompact,
                  isToday && styles.chipTextToday,
                ]}
                numberOfLines={1}
              >
                {it.label}
              </Text>
              <Text style={[styles.chipCount, isToday && styles.chipCountToday]}>
                ×{it.count || 0}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

// scale: useResponsive() 의 폰트 배율(lg=1.3, 그 외 1.0).
function makeStyles(scale = 1) {
  const fp = (n) => Math.round(n * scale);
  return StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#fff7ed',
    borderBottomWidth: 1,
    borderBottomColor: '#fed7aa',
    gap: 6,
  },
  wrapCompact: { paddingHorizontal: 6, paddingVertical: 4 },
  // 인라인 모드: 헤더 안에 들어갈 때 배경/보더/패딩 제거하고 flex로 남은 공간 채움
  wrapInline: {
    flex: 1,
    minWidth: 0,
    backgroundColor: 'transparent',
    borderBottomWidth: 0,
    paddingHorizontal: 0,
    paddingVertical: 0,
    marginLeft: 4,
  },
  label: {
    fontSize: fp(11),
    color: '#9a3412',
    fontWeight: '800',
    flexShrink: 0,
    marginRight: 2,
  },
  labelCompact: { fontSize: fp(10) },
  row: { gap: 6, alignItems: 'center', paddingRight: 8 },
  // 웹: 마우스 드래그용 cursor + 사용자가 텍스트 선택 못 하게 방지
  scrollWeb: { cursor: 'grab', userSelect: 'none' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    gap: 4,
    maxWidth: 110,
  },
  chipCompact: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 11, maxWidth: 95, gap: 3 },
  chipPinned: { backgroundColor: '#fef3c7', borderColor: '#fcd34d' },
  chipToday: {
    backgroundColor: '#f3f4f6',
    borderColor: '#d1d5db',
    opacity: 0.65,
  },
  pinIcon: { fontSize: fp(11) },
  chipText: { fontSize: fp(12), fontWeight: '700', color: '#7f1d1d', flexShrink: 1 },
  chipTextCompact: { fontSize: fp(10) },
  chipTextToday: {
    color: '#6b7280',
    textDecorationLine: 'line-through',
  },
  chipCount: { fontSize: fp(10), fontWeight: '900', color: '#dc2626' },
  chipCountToday: { color: '#9ca3af' },
  });
}
