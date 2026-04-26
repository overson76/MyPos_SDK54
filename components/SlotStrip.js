import { useEffect, useRef, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

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
  const scrollRef = useRef(null);
  const dragRef = useRef({ down: false, startX: 0, startScroll: 0, moved: 0 });
  const [innerW, setInnerW] = useState(0);

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
      >
        {slotW > 0 &&
          slots.map((slot) => (
            <View key={slot.id} style={{ width: slotW }}>
              {renderItem(slot)}
            </View>
          ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // 그리드 행 안에서 차지하는 셀 영역 (flex 로 폭 결정됨)
  wrap: { flex: 1, minWidth: 0, alignSelf: 'stretch' },
  row: { alignItems: 'stretch' },
  scrollWeb: { cursor: 'grab', userSelect: 'none' },
});
