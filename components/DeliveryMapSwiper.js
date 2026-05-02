// 배달 카드 위로 스와이프 감지 — 모달 열기는 onSwipeUp 콜백으로 외부에 위임.
// PC/웹에서는 주소 행 🗺️ 클릭 트리거(TableScreen)와 함께 사용.
import { useRef } from 'react';
import { PanResponder, View } from 'react-native';

export default function DeliveryMapSwiper({ children, onSwipeUp }) {
  const cardPan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        gs.dy < -15 && Math.abs(gs.dy) > Math.abs(gs.dx) * 1.5,
      onPanResponderRelease: (_, gs) => {
        if (gs.dy < -40) onSwipeUp?.();
      },
    })
  ).current;

  return (
    <View {...cardPan.panHandlers} style={{ flex: 1 }}>
      {children}
    </View>
  );
}
