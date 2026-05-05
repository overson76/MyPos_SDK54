// 자동 업데이트 진행 상황을 메인 화면 최상단에 한 줄로 표시.
//
// 표시 정책 (영업 흐름 방해 최소화):
//   - downloading: 진행률 % 표시 + "잠시 후 자동 적용" 안내. 닫기 버튼 X (사장님이 모르고 닫는 사고 방지).
//   - downloaded:  "준비 완료 — 영업 종료 후 재시작" 안내 + 닫기 버튼 (사장님이 인지했다는 뜻).
//   - error:       빨간 배너 + "지금 확인" 버튼 — 진단할 수 있게.
//   - 그 외 (idle / checking / available / upToDate / disabled): 안 보임 (화면 깔끔).
//
// 일반 브라우저 / 폰 빌드: window.mypos 없음 → subscribe 가 no-op → 절대 렌더 X.

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
  // version 이 비어와도 dismiss 가능하도록 sentinel(__no_version__) 사용.
  if (kind === 'downloaded' && dismissedVersion === versionKey) return null;

  // 평소엔 안 보임 — 화면 깔끔. error 도 매번 보이면 거슬리니 일단 표시 (진단 필요).
  const visibleKinds = ['downloading', 'downloaded', 'error'];
  if (!visibleKinds.includes(kind)) return null;

  if (kind === 'downloading') {
    const percent = typeof status.percent === 'number' ? Math.round(status.percent) : null;
    return (
      <View style={[styles.bar, styles.barInfo]}>
        <Text style={styles.icon}>⬇</Text>
        <Text style={styles.text}>
          새 버전 다운로드 중… {percent !== null ? `${percent}%` : ''}
          {'  '}
          <Text style={styles.subtle}>다운로드 끝나면 알려드려요. 그때까지 평소처럼 사용 OK.</Text>
        </Text>
        {/* downloading 중엔 닫기 버튼 X — 모르고 종료 시 처음부터 재다운로드 되는 것 방지 알림. */}
      </View>
    );
  }

  if (kind === 'downloaded') {
    return (
      <View style={[styles.bar, styles.barReady]}>
        <Text style={styles.icon}>✓</Text>
        <Text style={styles.text}>
          새 버전 준비 완료{version ? ` (${version})` : ''} —{' '}
          <Text style={styles.subtle}>영업 종료 후 앱을 닫고 다시 열면 자동 적용됩니다.</Text>
        </Text>
        <Pressable
          style={styles.closeBtn}
          onPress={() => {
            saveJSON(DISMISSED_KEY, versionKey);
            setDismissedVersion(versionKey);
          }}
          hitSlop={8}
        >
          <Text style={styles.closeText}>알겠습니다 ✕</Text>
        </Pressable>
      </View>
    );
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
