// 자동 업데이트 진행 상황을 메인 화면 최상단에 한 줄로 표시.
//
// 표시 정책 (영업 흐름 방해 최소화):
//   - downloading: 진행률 % 표시 + "잠시 후 자동 적용" 안내. 닫기 버튼 X (사장님이 모르고 닫는 사고 방지).
//   - downloaded:  "준비 완료 — 영업 종료 후 재시작" 안내 + 닫기 버튼 (사장님이 인지했다는 뜻).
//   - error:       빨간 배너 + "지금 확인" 버튼 — 진단할 수 있게.
//   - 그 외 (idle / checking / available / upToDate / disabled): 안 보임 (화면 깔끔).
//
// 일반 브라우저 / 폰 빌드: window.mypos 없음 → subscribe 가 no-op → 절대 렌더 X.

import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  isElectronUpdateAvailable,
  getElectronUpdateStatus,
  subscribeElectronUpdate,
  checkForElectronUpdate,
} from '../utils/electronUpdate';
import { loadJSON, saveJSON } from '../utils/persistence';

// 사장님이 "준비 완료" 배너를 한 번 닫으면, 같은 버전에 한해 다시 안 보임.
// 다음 새 버전이 오면 다시 등장.
//
// version 필드가 비어 와도 dismiss 가능해야 함 — electron-updater 가 같은 버전을
// 'downloaded' 로 다시 보고하는 케이스가 있어 sentinel 값으로 처리.
const DISMISSED_KEY = 'updateBanner.dismissedVersion';
const NO_VERSION = '__no_version__';

export default function UpdateBanner() {
  const [status, setStatus] = useState(null);
  const [dismissedVersion, setDismissedVersion] = useState(null);
  // 현재 실행 중인 .exe 버전 — electron-updater 가 같은 버전을 'downloaded' 로 보고하는
  // 케이스 (자기 자신을 다시 받았을 때) 회피용. async fetch — sync sendSync 가 sandbox
  // preload 에서 freeze 회귀(1.0.5) 일으켜 invoke 형으로 변경.
  const [currentVersion, setCurrentVersion] = useState('');

  useEffect(() => {
    if (!isElectronUpdateAvailable()) return undefined;

    // mount 시 현재 상태 한 번 가져오기 + 이후 broadcast 구독.
    getElectronUpdateStatus().then(setStatus);
    loadJSON(DISMISSED_KEY, null).then(setDismissedVersion);
    if (typeof window !== 'undefined' && typeof window.mypos?.getAppVersion === 'function') {
      window.mypos.getAppVersion().then((v) => setCurrentVersion(v || ''));
    }
    const unsub = subscribeElectronUpdate((s) => setStatus(s));
    return unsub;
  }, []);

  // Electron 환경 아니거나 상태 없으면 아무것도 안 보임.
  if (!status) return null;

  const kind = status.kind;
  const version = status?.info?.version || status?.versionInfo?.version || '';
  const versionKey = version || NO_VERSION;

  // downloaded 인데 보고된 버전이 현재 실행 중인 버전과 같으면 표시 X
  // (electron-updater 가 자기 자신을 'downloaded' 로 다시 보고하는 정상 무시 케이스).
  if (kind === 'downloaded' && version && currentVersion && version === currentVersion) {
    return null;
  }

  // downloaded 이고 사장님이 이미 닫은 (같은) 버전이면 안 보임.
  // 1.0.24: NO_VERSION sentinel 매치는 무시 — 옛날 dismiss(version 정보 안 옴)가
  // 새 버전 표시를 영원히 막는 사고 방지. version 정보 있을 때만 dismiss 매치 적용.
  if (kind === 'downloaded' && dismissedVersion === versionKey && versionKey !== NO_VERSION) return null;

  // 평소엔 안 보임 — 화면 깔끔. error 도 매번 보이면 거슬리니 일단 표시 (진단 필요).
  const visibleKinds = ['downloading', 'downloaded', 'error'];
  if (!visibleKinds.includes(kind)) return null;

  if (kind === 'downloading') {
    const percent = typeof status.percent === 'number' ? Math.round(status.percent) : null;
    return (
      <View style={[styles.bar, styles.barDownloadingPink]}>
        <Text style={[styles.icon, styles.iconPink]}>⬇</Text>
        <Text style={[styles.text, styles.textPink]}>
          새 버전 다운로드 중… {percent !== null ? `${percent}%` : ''}
          {'  '}
          <Text style={styles.subtlePink}>다운로드 끝나면 알려드려요. 그때까지 평소처럼 사용 OK.</Text>
        </Text>
      </View>
    );
  }

  if (kind === 'downloaded') {
    return <ReadyBanner version={version} versionKey={versionKey} setDismissedVersion={setDismissedVersion} />;
  }

  // error
  return (
    <View style={[styles.bar, styles.barError]}>
      <Text style={styles.icon}>⚠</Text>
      <Text style={styles.text}>
        업데이트 오류 —{' '}
        <Text style={styles.subtle}>
          {trimError(status.message || status.error || '')}
        </Text>
      </Text>
      <Pressable style={styles.actionBtn} onPress={() => checkForElectronUpdate()} hitSlop={6}>
        <Text style={styles.actionText}>다시 시도</Text>
      </Pressable>
    </View>
  );
}

// 1.0.25: 새 버전 준비됨 배너 — 강화된 반짝이 효과 (1.0.23 의 opacity 만 펄스 → 사장님이
// "반짝이지도 않았다" 피드백). backgroundColor pink-200 ↔ pink-400 + scale 1.0 ↔ 1.015 +
// 사이클 1.4초 (이전 1.8초 → 빠르게). 시각적으로 명확.
function ReadyBanner({ version, versionKey, setDismissedVersion }) {
  const pulseAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: false }),
        Animated.timing(pulseAnim, { toValue: 0, duration: 700, useNativeDriver: false }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [pulseAnim]);

  // 0~1 펄스값을 backgroundColor / scale 에 매핑.
  const animatedBg = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#fbcfe8', '#f472b6'], // pink-200 ↔ pink-400 (확연히 다른 톤)
  });
  const animatedBorder = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#f472b6', '#db2777'], // pink-400 ↔ pink-600
  });
  const animatedScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.015],
  });

  return (
    <Animated.View
      style={[
        styles.bar,
        styles.barReadyPink,
        {
          backgroundColor: animatedBg,
          borderBottomColor: animatedBorder,
          transform: [{ scale: animatedScale }],
        },
      ]}
    >
      <Text style={[styles.icon, styles.iconPink]}>🎉</Text>
      <Text style={[styles.text, styles.textPink]}>
        새 버전 준비 완료{version ? ` (${version})` : ''} —{' '}
        <Text style={styles.subtlePink}>관리자 → 시스템 → "🚀 지금 적용" 버튼을 눌러주세요.</Text>
      </Text>
      <Pressable
        style={styles.closeBtnPink}
        onPress={() => {
          saveJSON(DISMISSED_KEY, versionKey);
          setDismissedVersion(versionKey);
        }}
        hitSlop={8}
      >
        <Text style={styles.closeTextPink}>알겠습니다 ✕</Text>
      </Pressable>
    </Animated.View>
  );
}

// 에러 문자열이 길어 화면 깰 수 있어 한 줄로 축약. 자세한 내용은 관리자 → 시스템 카드에서 확인.
function trimError(msg) {
  const oneline = String(msg).split('\n')[0].trim();
  if (oneline.length <= 80) return oneline;
  return oneline.slice(0, 80) + '…';
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    gap: 10,
    borderBottomWidth: 1,
  },
  barInfo: {
    backgroundColor: '#1F2937',
    borderBottomColor: '#374151',
  },
  barReady: {
    backgroundColor: '#065F46',
    borderBottomColor: '#0B7461',
  },
  // 1.0.25: 분홍 반짝이 — 새 버전 준비됨. backgroundColor 는 Animated 가 동적으로 덮어쓰니
  // 여기는 정적 fallback 색만. borderBottomWidth / 패딩만 명시.
  barReadyPink: {
    backgroundColor: '#fbcfe8',
    borderBottomColor: '#f472b6',
    borderBottomWidth: 3,
  },
  // 1.0.25: 다운로드 중 배너 — 옛 검은 띠(#1F2937) 대신 옅은 분홍 (downloaded 와 일관성).
  // 정적, 반짝임 없음 (downloading 은 진행 중 상태라 안 두드러져도 OK).
  barDownloadingPink: {
    backgroundColor: '#fce7f3', // pink-100 (가장 옅은 분홍)
    borderBottomColor: '#fbcfe8', // pink-200
    borderBottomWidth: 2,
  },
  iconPink: { color: '#9d174d', fontSize: 18 }, // pink-800
  textPink: { color: '#831843', fontWeight: '700' }, // pink-900
  subtlePink: { color: '#9d174d', fontWeight: '500' },
  closeBtnPink: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: '#ec4899', // pink-500
  },
  closeTextPink: { color: '#fff', fontSize: 12, fontWeight: '700' },
  barError: {
    backgroundColor: '#7F1D1D',
    borderBottomColor: '#991B1B',
  },
  icon: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  text: {
    flex: 1,
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  subtle: {
    color: '#d1d5db',
    fontSize: 12,
    fontWeight: '500',
  },
  closeBtn: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  closeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  actionBtn: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: '#fff',
  },
  actionText: { color: '#7F1D1D', fontSize: 12, fontWeight: '800' },
});
