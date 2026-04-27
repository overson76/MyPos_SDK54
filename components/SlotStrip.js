import { useEffect, useRef, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useResponsive } from '../utils/useResponsive';

// 그리드의 일부 셀 자리를 차지하는 가로 스와이프 영역.
// 처음 baseCount 개의 슬롯은 영역 폭에 정확히 fit (그리드 셀과 같은 폭),
// baseCount 보다 많은 슬롯은 가로 스와이프로 접근.
//
// Props:
//   slots: [{id,...}]  렌더할 슬롯 배열 (이미 정렬된 상태)
//   renderItem: (slot) => ReactNode  슬롯 → 타일
//   baseCount: number  영역 폭에 fit 시킬 기본 슬롯 수 (예약 2, 포장 2, 배달 5)
//   gap: number  슬롯 간 간격 (그리드 gap 과 동일하게)
export default function SlotStrip({ slots, renderItem, baseCount, gap = 4 }) {
  const { scale } = useResponsive();
  const chevronFont = { fontSize: Math.round(14 * scale) };
  const scrollRef = useRef(null);
  const dragRef = useRef({ down: false, startX: 0, startScroll: 0, moved: 0 });
  const [innerW, setInnerW] = useState(0);
  // 추가 슬롯이 좌/우 어느 쪽에 더 있는지 — fade 그라디언트 표시 여부 결정.
  // 슬롯이 baseCount 이하라 스와이프 자체가 불필요하면 둘 다 false → fade 안 그림.
  const [edges, setEdges] = useState({ canLeft: false, canRight: false });

  // 스크롤 위치 / 컨텐츠 크기 기반으로 좌/우 fade 표시 여부 갱신.
  const updateEdges = (x, contentW, viewW) => {
    if (contentW <= viewW + 1) {
      setEdges((prev) =>
        prev.canLeft || prev.canRight ? { canLeft: false, canRight: false } : prev
      );
      return;
    }
    const canLeft = x > 4;
    const canRight = x < contentW - viewW - 4;
    setEdges((prev) =>
      prev.canLeft === canLeft && prev.canRight === canRight
        ? prev
        : { canLeft, canRight }
    );
  };

  const handleScroll = (e) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    updateEdges(contentOffset.x, contentSize.width, layoutMeasurement.width);
  };

  const handleContentSizeChange = (w) => {
    // 슬롯 추가/삭제 등으로 컨텐츠 폭이 바뀌면 즉시 edges 재계산.
    updateEdges(0, w, innerW);
  };

  // baseCount 개 슬롯이 영역 폭에 정확히 fit 되도록 한 슬롯 폭 계산
  // total = N*w + (N-1)*gap → w = (total - (N-1)*gap) / N
  const slotW = innerW > 0 && baseCount > 0
    ? Math.max(0, (innerW - (baseCount - 1) * gap) / baseCount)
    : 0;

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

  return (
    <View
      style={styles.wrap}
      onLayout={(e) => setInnerW(e.nativeEvent.layout.width)}
    >
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.row, { gap }]}
        style={Platform.OS === 'web' ? styles.scrollWeb : null}
        onScroll={handleScroll}
        onContentSizeChange={handleContentSizeChange}
        scrollEventThrottle={16}
      >
        {slotW > 0 &&
          slots.map((slot) => (
            <View key={slot.id} style={{ width: slotW }}>
              {renderItem(slot)}
            </View>
          ))}
      </ScrollView>
      {/* 더 보기 신호용 fade 그라디언트 — 영역 좌/우 끝에 흰색 → 투명.
          pointerEvents="none" 으로 슬롯 클릭/스와이프 방해하지 않음. */}
      {edges.canLeft && (
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(255,255,255,0.95)', 'rgba(255,255,255,0)']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.fadeLeft}
        >
          <Text style={[styles.chevronLeft, chevronFont]}>❮</Text>
        </LinearGradient>
      )}
      {edges.canRight && (
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.95)']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.fadeRight}
        >
          <Text style={[styles.chevronRight, chevronFont]}>❯</Text>
        </LinearGradient>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // 그리드 행 안에서 차지하는 셀 영역 (flex 로 폭 결정됨)
  wrap: { flex: 1, minWidth: 0, alignSelf: 'stretch' },
  row: { alignItems: 'stretch' },
  scrollWeb: { cursor: 'grab', userSelect: 'none' },
  // fade 그라디언트 — 슬롯 위에 absolute 로 떠 있되 클릭은 그대로 통과.
  fadeLeft: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 24,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingLeft: 4,
  },
  fadeRight: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 24,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: 4,
  },
  // chevron — "이쪽으로 더 있음" 시각 신호. 너무 강하지 않게 회색.
  chevronLeft: { fontSize: 14, color: '#6b7280', fontWeight: '700' },
  chevronRight: { fontSize: 14, color: '#6b7280', fontWeight: '700' },
});
