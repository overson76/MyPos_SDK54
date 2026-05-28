// 2026-05-28: Toast 알림 — 화면 상단 가운데에 표시. 4초 후 자동 사라짐.
// 사장님이 ✕ 클릭해 즉시 닫기 가능. 색상은 종류별 (success/warn/info).

import { useMemo } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useResponsive } from '../utils/useResponsive';
import { useToast } from '../utils/ToastContext';

const COLORS = {
  success: { bg: '#16a34a', text: '#fff' },
  warn: { bg: '#d97706', text: '#fff' },
  info: { bg: '#2563eb', text: '#fff' },
};

export default function ToastBanner() {
  const { toast, dismissToast } = useToast();
  const { scale } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);
  if (!toast) return null;
  const c = COLORS[toast.kind] || COLORS.info;
  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <View style={[styles.banner, { backgroundColor: c.bg }]}>
        <Text style={[styles.text, { color: c.text }]} numberOfLines={2}>
          {toast.text}
        </Text>
        <TouchableOpacity onPress={dismissToast} hitSlop={8} style={styles.closeBtn}>
          <Text style={[styles.closeText, { color: c.text }]}>✕</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function makeStyles(scale = 1) {
  const fp = (n) => Math.round(n * scale);
  return StyleSheet.create({
    overlay: {
      // 웹은 fixed (스크롤과 무관하게 viewport 상단 고정) — 사장님이 어떤 화면 어느
      // 스크롤 위치든 Toast 가 즉시 보임. 네이티브는 absolute 그대로 (App.js 안에서
      // SafeAreaView 의 상대 위치).
      position: Platform.OS === 'web' ? 'fixed' : 'absolute',
      top: Platform.OS === 'ios' ? 100 : 60,
      left: 0,
      right: 0,
      zIndex: 11000,
      alignItems: 'center',
      paddingHorizontal: 12,
    },
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 18,
      gap: 12,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 10,
      minWidth: 320,
      maxWidth: 720,
    },
    text: { flex: 1, fontSize: fp(15), fontWeight: '700', lineHeight: fp(22) },
    closeBtn: { padding: 4 },
    closeText: { fontSize: fp(18), fontWeight: '800' },
  });
}
