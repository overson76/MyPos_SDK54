import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import {
  BackHandler,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import OrderFlow from './components/OrderFlow';
import OrderTab from './components/OrderTab';
import PinchZoom from './components/PinchZoom';
import KitchenScreen from './screens/KitchenScreen';
import AdminScreen from './screens/AdminScreen';
import { OrderProvider } from './utils/OrderContext';
import { MenuProvider } from './utils/MenuContext';
import { LockProvider } from './utils/LockContext';
import { useResponsive } from './utils/useResponsive';
import { setSpeakAddress, setupAudioSession, setVolume } from './utils/notify';
import { loadJSON } from './utils/persistence';
import { SentryErrorBoundary } from './utils/sentry';

// 앱 트리에서 throw 된 React 렌더 에러를 Sentry 로 보고 + 매장에서 흰화면 대신 복구 UI 노출.
function CrashFallback({ error, resetError }) {
  return (
    <View style={styles.crashRoot}>
      <Text style={styles.crashTitle}>앱에 문제가 발생했습니다</Text>
      <Text style={styles.crashSubtitle}>
        오류가 자동으로 보고되었습니다. 아래 버튼으로 다시 시도하세요.
      </Text>
      {__DEV__ && error?.message ? (
        <Text style={styles.crashError} numberOfLines={4}>
          {String(error.message)}
        </Text>
      ) : null}
      <TouchableOpacity
        onPress={resetError}
        activeOpacity={0.8}
        style={styles.crashBtn}
      >
        <Text style={styles.crashBtnText}>다시 시도</Text>
      </TouchableOpacity>
    </View>
  );
}

const TAB_KEYS = ['테이블', '주문', '주문현황', '관리자'];

export default function App() {
  const [activeTab, setActiveTab] = useState('테이블');
  const [tableResetSignal, setTableResetSignal] = useState(0);
  const [selectedTable, setSelectedTable] = useState(null);
  // 최근 선택된 테이블 id — TableScreen 복귀시 하이라이트용
  const [lastSelectedTableId, setLastSelectedTableId] = useState(null);
  // 주문 탭에서 '주문' 클릭 후 테이블 선택 시 자동 확정하기 위한 의도 플래그
  const [autoConfirmIntent, setAutoConfirmIntent] = useState(false);
  const { isNarrow } = useResponsive();
  const isMobile = isNarrow;

  // iOS 무음 스위치 무시 + 오디오 세션 구성, 저장된 볼륨 / 개인정보 토글 hydrate. 1회.
  useEffect(() => {
    setupAudioSession();
    loadJSON('volume', 1).then((v) => {
      if (typeof v === 'number') setVolume(v);
    });
    loadJSON('speakAddress', false).then((v) => {
      setSpeakAddress(!!v);
    });
  }, []);

  // Android 하드웨어 뒤로가기 처리. iOS/web 은 no-op.
  // 우선순위: 비-테이블 탭 → 테이블로 / 선택된 테이블 → 해제 / 그 외 → OS 처리(종료)
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const onBack = () => {
      if (activeTab !== '테이블') {
        handleTabPress('테이블');
        return true;
      }
      if (selectedTable) {
        setSelectedTable(null);
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [activeTab, selectedTable]);

  // 테이블을 선택할 때 lastSelectedTableId도 갱신. null 로 돌아갈 때는 유지.
  const chooseTable = (t) => {
    if (t) setLastSelectedTableId(t.id);
    setSelectedTable(t);
  };

  const handleTabPress = (key) => {
    if (key === '테이블') setTableResetSignal((n) => n + 1);
    else setAutoConfirmIntent(false);
    setActiveTab(key);
  };

  // 주문 탭의 '주문' 버튼이 미선택 상태에서 눌리면 호출됨.
  // 자동 확정 의도를 세팅하고 테이블 탭으로 전환한다.
  const requestOrderViaTable = () => {
    setAutoConfirmIntent(true);
    setTableResetSignal((n) => n + 1);
    setActiveTab('테이블');
  };

  return (
    <SentryErrorBoundary fallback={CrashFallback}>
    <SafeAreaProvider>
      <LockProvider>
      <MenuProvider>
      <OrderProvider>
        <SafeAreaView
          style={styles.root}
          edges={['top', 'left', 'right', 'bottom']}
        >
          <PinchZoom>
            <View style={styles.zoomRoot}>
              <View style={styles.topTabs}>
                {TAB_KEYS.map((key) => {
                  const isActive = activeTab === key;
                  return (
                    <TouchableOpacity
                      key={key}
                      style={[
                        styles.tabBtn,
                        isMobile && styles.tabBtnMobile,
                        isActive && styles.tabBtnActive,
                      ]}
                      onPress={() => handleTabPress(key)}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[styles.tabText, isMobile && styles.tabTextMobile, isActive && styles.tabTextActive]}
                      >
                        {key}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.body}>
                <View
                  style={[
                    styles.pane,
                    activeTab !== '테이블' && styles.paneHidden,
                  ]}
                >
                  <OrderFlow
                    resetSignal={tableResetSignal}
                    selectedTable={selectedTable}
                    setSelectedTable={chooseTable}
                    lastSelectedTableId={lastSelectedTableId}
                    autoConfirmIntent={autoConfirmIntent}
                    clearAutoConfirmIntent={() => setAutoConfirmIntent(false)}
                  />
                </View>
                <View
                  style={[styles.pane, activeTab !== '주문' && styles.paneHidden]}
                >
                  <OrderTab
                    selectedTable={selectedTable}
                    setSelectedTable={chooseTable}
                    onGoToTables={() => handleTabPress('테이블')}
                    onRequestOrderWithTable={requestOrderViaTable}
                  />
                </View>
                <View
                  style={[
                    styles.pane,
                    activeTab !== '주문현황' && styles.paneHidden,
                  ]}
                >
                  <KitchenScreen />
                </View>
                <View
                  style={[
                    styles.pane,
                    activeTab !== '관리자' && styles.paneHidden,
                  ]}
                >
                  <AdminScreen />
                </View>
              </View>
            </View>
          </PinchZoom>

          <StatusBar style="dark" />
        </SafeAreaView>
      </OrderProvider>
      </MenuProvider>
      </LockProvider>
    </SafeAreaProvider>
    </SentryErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  zoomRoot: { flex: 1, backgroundColor: '#fff' },
  topTabs: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 2,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  tabBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabBtnMobile: { flex: 1, paddingHorizontal: 2, paddingVertical: 4, alignItems: 'center' },
  tabBtnActive: { borderBottomColor: '#111827' },
  tabText: { fontSize: 13, color: '#6b7280', fontWeight: '600' },
  tabTextMobile: { fontSize: 11 },
  tabTextActive: { color: '#111827', fontWeight: '800' },
  body: { flex: 1, position: 'relative', backgroundColor: '#fff' },
  pane: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  paneHidden: { display: 'none' },

  crashRoot: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  crashTitle: { fontSize: 18, fontWeight: '800', color: '#111827', marginBottom: 8 },
  crashSubtitle: { fontSize: 14, color: '#6b7280', textAlign: 'center', marginBottom: 16 },
  crashError: {
    fontSize: 12,
    color: '#b91c1c',
    backgroundColor: '#fef2f2',
    padding: 8,
    borderRadius: 6,
    marginBottom: 16,
    maxWidth: 400,
  },
  crashBtn: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  crashBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
