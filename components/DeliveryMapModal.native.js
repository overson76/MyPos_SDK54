// 폰(iOS/Android) 전용 — react-native-webview 없이 주소+거리 정보만 표시.
// 지도는 EAS 빌드 후 활성화.
// RN <Modal> 사용 금지 — iOS 새 아키텍처 크래시 (memory: project_modal_native_crash.md)
import { useEffect, useRef } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

export default function DeliveryMapModal({
  visible,
  onClose,
  deliveryAddr,
  distanceLabel,
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.timing(fadeAnim, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    }
  }, [visible, fadeAnim]);

  const handleClose = () => {
    Animated.timing(fadeAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start(
      () => onClose?.()
    );
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) =>
        gs.dy > 20 && Math.abs(gs.dy) > Math.abs(gs.dx) * 2,
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > 60) handleClose();
      },
    })
  ).current;

  if (!visible) return null;

  return (
    <Animated.View
      style={[styles.overlay, { opacity: fadeAnim }]}
      pointerEvents="auto"
    >
      <View style={styles.card} {...pan.panHandlers}>
        <View style={styles.handle} />
        <Text style={styles.addr} numberOfLines={2}>
          📍 {deliveryAddr || '주소 없음'}
        </Text>
        {distanceLabel ? (
          <Text style={styles.dist}>📏 {distanceLabel}</Text>
        ) : null}
        <Text style={styles.hint}>아래로 쓸어내리면 닫힙니다</Text>
      </View>
      <TouchableOpacity style={styles.closeBtn} onPress={handleClose} hitSlop={16}>
        <Text style={styles.closeBtnText}>✕</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    elevation: 9999,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#1f2937',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 40,
    alignItems: 'center',
    gap: 12,
  },
  handle: {
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#4b5563',
    marginBottom: 8,
  },
  addr: { color: '#f9fafb', fontSize: 18, fontWeight: '600', textAlign: 'center' },
  dist: { color: '#34d399', fontSize: 22, fontWeight: '800' },
  hint: { color: '#6b7280', fontSize: 12, marginTop: 4 },
  closeBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 18,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
