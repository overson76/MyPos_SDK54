// 클라우드 이상 알림 띠 — 화면 최상단에 상시 표시.
//
// 2026-06-11 무료 한도 차단 사고 후속: 쓰기 "조용한 실패" 를 1초 만에 보이게 (빨강).
// 2026-09-11 리스너 사망 사고 후속: 읽기(실시간 구독) 끊김도 보이게 (주황).
//   쓰기만 감시하던 탓에, 리스너가 죽어 기기끼리 어긋나는 동안 이 배너는 조용했다.
//   쓰기는 멀쩡히 성공하고 화면도 마지막 값으로 정상이라 신호가 어디에도 없었다.
//
// pointerEvents="none" — 순수 표시용. 영업 중 어떤 터치도 가로채면 안 됨.
// 성공 write / 정상 snapshot 이 한 번이라도 나오면 cloudHealth 가 리셋 → 자동 소멸.

import { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useResponsive } from '../utils/useResponsive';
import {
  describeCloudError,
  getCloudHealth,
  getListenerHealth,
  subscribeCloudHealth,
  subscribeListenerHealth,
} from '../utils/cloudHealth';

export default function CloudHealthBanner() {
  const [health, setHealth] = useState(getCloudHealth());
  const [listeners, setListeners] = useState(getListenerHealth());
  const [nowTs, setNowTs] = useState(() => Date.now());
  const { scale } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);

  useEffect(() => subscribeCloudHealth(setHealth), []);
  useEffect(() => subscribeListenerHealth(setListeners), []);

  // 재연결 카운트다운 — 끊겨 있는 동안에만 1초 틱. 정상일 땐 타이머 자체가 없다.
  const retryAt = listeners.failing ? listeners.retryAt : null;
  useEffect(() => {
    if (!retryAt) return undefined;
    const id = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [retryAt]);

  if (!health.failing && !listeners.failing) return null;

  const secsLeft = retryAt ? Math.max(0, Math.ceil((retryAt - nowTs) / 1000)) : null;

  return (
    <View style={styles.overlay} pointerEvents="none">
      {health.failing ? (
        <View style={[styles.banner, styles.write]}>
          <Text style={styles.text} numberOfLines={1}>
            ⚠️ 클라우드 저장 안 됨 — {describeCloudError(health.code)}
            {health.count > 1 ? ` (${health.count}회)` : ''} · 30초마다 자동 재시도 중
          </Text>
        </View>
      ) : null}
      {listeners.failing ? (
        <View style={[styles.banner, styles.read]}>
          <Text style={styles.text} numberOfLines={1}>
            🔌 실시간 동기화 끊김 {listeners.ctxs.length}건 —{' '}
            {describeCloudError(listeners.code)} · 자동 재연결
            {secsLeft != null ? ` ${secsLeft}초 전` : ' 중'}
          </Text>
        </View>
      ) : null}
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
      borderRadius: 10,
      paddingVertical: 8,
      paddingHorizontal: 16,
      maxWidth: 760,
      marginBottom: 6,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.3,
      shadowRadius: 6,
      elevation: 9,
    },
    // 쓰기 실패 = 데이터가 안 남는다. 가장 심각 — 빨강.
    write: { backgroundColor: '#dc2626' },
    // 읽기 끊김 = 내 저장은 되는데 남의 변경이 안 온다. 주황.
    read: { backgroundColor: '#d97706' },
    text: { color: '#fff', fontSize: fp(13), fontWeight: '800' },
  });
}
