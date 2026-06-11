// 클라우드 저장 실패 빨간 띠 — 쓰기가 거부되는 동안 화면 최상단에 상시 표시.
// 2026-06-11 무료 한도 차단 사고 후속: "조용한 실패" 를 1초 만에 보이게.
//
// pointerEvents="none" — 순수 표시용. 영업 중 어떤 터치도 가로채면 안 됨.
// 성공 write 가 한 번이라도 나오면 cloudHealth 가 리셋 → 배너 자동 소멸.

import { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useResponsive } from '../utils/useResponsive';
import {
  describeCloudError,
  getCloudHealth,
  subscribeCloudHealth,
} from '../utils/cloudHealth';

export default function CloudHealthBanner() {
  const [health, setHealth] = useState(getCloudHealth());
  const { scale } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);

  useEffect(() => subscribeCloudHealth(setHealth), []);

  if (!health.failing) return null;

  const desc = describeCloudError(health.code);
  const countLabel = health.count > 1 ? ` (${health.count}회)` : '';
  return (
    <View style={styles.overlay} pointerEvents="none">
      <View style={styles.banner}>
        <Text style={styles.text} numberOfLines={1}>
          ⚠️ 클라우드 저장 안 됨 — {desc}
          {countLabel} · 30초마다 자동 재시도 중
        </Text>
      </View>
    </View>
  );
}

function makeStyles(scale = 1) {
  const fp = (n) => Math.round(n * scale);
  return StyleSheet.create({
    overlay: {
      // ToastBanner 와 같은 고정 패턴. Toast(top 100/60) 와 안 겹치게 더 위 가장자리.
      position: Platform.OS === 'web' ? 'fixed' : 'absolute',
      top: Platform.OS === 'web' ? 6 : Platform.OS === 'ios' ? 64 : 24,
      left: 0,
      right: 0,
      zIndex: 12000,
      alignItems: 'center',
      paddingHorizontal: 12,
    },
    banner: {
      backgroundColor: '#dc2626',
      borderRadius: 10,
      paddingVertical: 8,
      paddingHorizontal: 16,
      maxWidth: 760,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.3,
      shadowRadius: 6,
      elevation: 9,
    },
    text: { color: '#fff', fontSize: fp(13), fontWeight: '800' },
  });
}
