import { useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  GestureHandlerRootView,
  PinchGestureHandler,
  PanGestureHandler,
  State,
} from 'react-native-gesture-handler';

// 모든 화면에 핀치 줌 + 팬을 제공하는 래퍼.
// - 두 손가락 핀치 → 스케일 조절 (1.0 ~ 3.0). 기본 이하로는 축소되지 않음.
// - 스케일이 1.0 일 때: 한 손가락 드래그는 자식의 탭/스크롤에 양보 (팬 비활성)
// - 스케일이 1.0 초과일 때: 한 손가락 드래그로 팬 활성. activeOffset 으로 작은 터치는 자식에 전달.
// - 줌 상태일 때 우상단에 "원래 크기" 리셋 버튼 노출 (실수로 줌이 들어갔을 때 빠른 복구용).
export default function PinchZoom({ children }) {
  const baseScale = useRef(new Animated.Value(1)).current;
  const pinchScale = useRef(new Animated.Value(1)).current;
  const scale = Animated.multiply(baseScale, pinchScale);
  const lastScale = useRef(1);
  const [zoomed, setZoomed] = useState(false);

  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const lastTx = useRef(0);
  const lastTy = useRef(0);

  const pinchRef = useRef(null);
  const panRef = useRef(null);

  const onPinchEvent = Animated.event(
    [{ nativeEvent: { scale: pinchScale } }],
    { useNativeDriver: true }
  );

  const onPinchStateChange = (e) => {
    if (e.nativeEvent.oldState === State.ACTIVE) {
      // 최소 1.0 (기본 크기) — 줌 아웃으로 축소되지 않도록 고정
      const next = Math.min(3, Math.max(1, lastScale.current * e.nativeEvent.scale));
      lastScale.current = next;
      baseScale.setValue(next);
      pinchScale.setValue(1);
      setZoomed(next > 1);
      // 정확히 1.0 이면 팬 offset 리셋 (다시 전체 보기)
      if (next <= 1) {
        lastTx.current = 0;
        lastTy.current = 0;
        translateX.setOffset(0);
        translateY.setOffset(0);
        translateX.setValue(0);
        translateY.setValue(0);
      }
    }
  };

  const onPanEvent = Animated.event(
    [
      {
        nativeEvent: {
          translationX: translateX,
          translationY: translateY,
        },
      },
    ],
    { useNativeDriver: true }
  );

  const onPanStateChange = (e) => {
    if (e.nativeEvent.oldState === State.ACTIVE) {
      lastTx.current += e.nativeEvent.translationX;
      lastTy.current += e.nativeEvent.translationY;
      translateX.setOffset(lastTx.current);
      translateY.setOffset(lastTy.current);
      translateX.setValue(0);
      translateY.setValue(0);
    }
  };

  const resetZoom = () => {
    baseScale.setValue(1);
    pinchScale.setValue(1);
    lastScale.current = 1;
    lastTx.current = 0;
    lastTy.current = 0;
    translateX.setOffset(0);
    translateY.setOffset(0);
    translateX.setValue(0);
    translateY.setValue(0);
    setZoomed(false);
  };

  return (
    <GestureHandlerRootView style={styles.root}>
      <PanGestureHandler
        ref={panRef}
        enabled={zoomed}
        minPointers={1}
        maxPointers={2}
        // 작은 드래그는 자식(스크롤/탭) 에 양보 — 8px 이상 움직여야 팬 시작
        activeOffsetX={[-8, 8]}
        activeOffsetY={[-8, 8]}
        onGestureEvent={onPanEvent}
        onHandlerStateChange={onPanStateChange}
        simultaneousHandlers={pinchRef}
      >
        <Animated.View style={styles.root} collapsable={false}>
          <PinchGestureHandler
            ref={pinchRef}
            onGestureEvent={onPinchEvent}
            onHandlerStateChange={onPinchStateChange}
            simultaneousHandlers={panRef}
          >
            <Animated.View
              style={[
                styles.root,
                {
                  transform: [
                    { translateX },
                    { translateY },
                    { scale },
                  ],
                },
              ]}
            >
              <View style={styles.root} collapsable={false}>
                {children}
              </View>
            </Animated.View>
          </PinchGestureHandler>
        </Animated.View>
      </PanGestureHandler>
      {/* transform 바깥 — 줌과 무관하게 항상 같은 크기로 유지 */}
      {zoomed && (
        <TouchableOpacity
          style={styles.resetBtn}
          onPress={resetZoom}
          activeOpacity={0.7}
          accessibilityLabel="원래 크기로 복원"
        >
          <Text style={styles.resetBtnText}>⊖ 원래 크기</Text>
        </TouchableOpacity>
      )}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  resetBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(17, 24, 39, 0.85)',
    borderRadius: 999,
    zIndex: 9999,
    elevation: 8,
  },
  resetBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
