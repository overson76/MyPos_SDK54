import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  SafeAreaInsetsContext,
  SafeAreaProvider,
  SafeAreaView,
} from 'react-native-safe-area-context';

import OrderFlow from './components/OrderFlow';
import OrderTab from './components/OrderTab';
import PinchZoom from './components/PinchZoom';
import KitchenScreen from './screens/KitchenScreen';
import UndoScreen from './screens/UndoScreen';
import AdminScreen from './screens/AdminScreen';
import AuthScreen from './screens/AuthScreen';
import { OrderProvider } from './utils/OrderContext';
import { MenuProvider } from './utils/MenuContext';
import { LockProvider } from './utils/LockContext';
import { StoreProvider, useStore, STORE_STATE } from './utils/StoreContext';
import { useResponsive } from './utils/useResponsive';
import { setSpeakAddress, setupAudioSession, setVolume } from './utils/notify';
import { loadJSON } from './utils/persistence';
import { SentryErrorBoundary } from './utils/sentry';
import { setupPwa } from './utils/pwaSetup';
import { checkForUpdates } from './utils/otaUpdates';
import { useCidHandler } from './utils/useCidHandler';
import { useIncomingCall } from './utils/useIncomingCall';
import IncomingCallBanner from './components/IncomingCallBanner';
import UpdateBanner from './components/UpdateBanner';

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

const TAB_KEYS = ['테이블', '주문', '주문현황', '되돌리기', '관리자'];

// dev 모드 web 미리보기에서만 iPhone 15 Pro Max 가로의 SafeArea 인셋(노치/홈인디케이터)을
// 강제 주입. 실 iPhone 에서는 OS 가 보고하므로 native 빌드는 그대로 동작.
// production web 빌드(매장 PC 운영용)에서는 시뮬을 꺼서 풀스크린으로 그려지게 한다.
// SafeAreaProvider 의 initialMetrics 와 안쪽 SafeAreaInsetsContext.Provider 를 같은 값으로
// 두 곳에 주입하는 이유: SafeAreaProvider 가 web 측정값(0)을 동적으로 덮어쓰기 때문에
// 안쪽 Provider 한 겹 더 두어 시뮬 값이 유지되게 한다.
const SIMULATE_IPHONE_WEB_INSETS = Platform.OS === 'web' && __DEV__;
const IPHONE_15_PROMAX_LANDSCAPE_INSETS = {
  top: 0,
  bottom: 21,
  left: 59,
  right: 59,
};
const IPHONE_15_PROMAX_LANDSCAPE_FRAME = {
  x: 0,
  y: 0,
  width: 932,
  height: 430,
};
const SIMULATED_INITIAL_METRICS = SIMULATE_IPHONE_WEB_INSETS
  ? {
      frame: IPHONE_15_PROMAX_LANDSCAPE_FRAME,
      insets: IPHONE_15_PROMAX_LANDSCAPE_INSETS,
    }
  : undefined;

// web 에서는 SafeAreaView 가 자체 padding 으로 inset 영역을 만든다. 외부 wrapper 는
// 검은 배경만 깔아두어 그 padding 영역에 비쳐 노치/홈인디케이터 시뮬이 그려지게 한다.
// 직접 padding 을 주면 SafeAreaView 와 이중 차감되어 컨텐츠 폭이 너무 작아짐.
function WebInsetsOverride({ children }) {
  if (!SIMULATE_IPHONE_WEB_INSETS) return children;
  return (
    <View style={styles.webInsetsBezel}>
      <SafeAreaInsetsContext.Provider value={IPHONE_15_PROMAX_LANDSCAPE_INSETS}>
        {children}
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

// App 의 최상위는 Provider 트리 + Gate. Gate 가 매장 가입 상태에 따라 분기:
//   loading                → SplashView
//   unjoined / pendingApproval → AuthScreen
//   joined                 → 기존 LockProvider/MenuProvider/OrderProvider + MainApp
// 가입 안 된 상태에서는 LockProvider 등이 mount 안 됨 → AsyncStorage 읽기 폭주 방지.
//
// web 의 Gate 토글:
//   - .env 에 EXPO_PUBLIC_FIREBASE_API_KEY 가 있으면 = 실 매장 운영 모드 (카운터 PC).
//     Gate 활성 → 매장 가입 화면 → 폰들과 동기화.
//   - 키가 없으면 = 디자인/레이아웃 검증 모드. Gate 우회해서 데모 데이터로 메인 트리 진입.
// native(iOS/Android) 는 google-services 파일이 자동 init 하므로 항상 Gate.
const WEB_FIREBASE_ENABLED = !!process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
const USE_GATE = Platform.OS !== 'web' || WEB_FIREBASE_ENABLED;

export default function App() {
  useEffect(() => {
    // 웹에서만 매니페스트 / theme-color / apple-touch-icon 동적 주입.
    // 네이티브 빌드에선 utils/pwaSetup.js 가 no-op.
    setupPwa();

    // 네이티브 빌드에서만 OTA 체크. 새 번들 있으면 백그라운드 다운로드 → 다음 시작 시 적용.
    // 영업 중 reload 강제 안 함 — 사장님이 자연스럽게 앱 재시작하는 시점에 갱신.
    // dev 빌드 / Expo Go / 웹은 utils/otaUpdates.web.js 가 no-op.
    checkForUpdates({
      onStatus: (status) => {
        if (status === 'downloaded') {
          // 영업 중 갑작스러운 reload는 없음 — 알림만.
          if (Platform.OS !== 'web') {
            const { Alert } = require('react-native');
            Alert.alert(
              '✅ 업데이트 완료',
              '새 버전이 준비됐습니다.\n앱을 완전히 종료 후 재시작하면 적용됩니다.',
              [{ text: '확인' }]
            );
          }
        }
      },
    });
  }, []);

  return (
    <SentryErrorBoundary fallback={CrashFallback}>
      <SafeAreaProvider initialMetrics={SIMULATED_INITIAL_METRICS}>
        <WebInsetsOverride>
          {/* StoreProvider 는 web 에서도 항상 mount — useOrderFirestoreSync 등이
              useStore() 를 호출하므로 context 자체는 살아있어야 한다.
              Firebase 미설정 web 에서는 firebase.web.js 가 null 반환 → subscribe noop. */}
          <StoreProvider>
            {USE_GATE ? <Gate /> : <JoinedAppTree />}
          </StoreProvider>
        </WebInsetsOverride>
      </SafeAreaProvider>
    </SentryErrorBoundary>
  );
}

// joined 상태에서 mount 되는 Provider 트리 + MainApp. Gate 의 joined 분기와 web 분기에서
// 같은 트리를 공유하기 위해 별도 컴포넌트로 분리.
function JoinedAppTree() {
  return (
    <LockProvider>
      <MenuProvider>
        <OrderProvider>
          <MainApp />
        </OrderProvider>
      </MenuProvider>
    </LockProvider>
  );
}

function Gate() {
  const { state } = useStore();
  if (state === STORE_STATE.LOADING) {
    return <SplashView />;
  }
  if (state !== STORE_STATE.JOINED) {
    return <AuthScreen />;
  }
  return <JoinedAppTree />;
}

function SplashView() {
  return (
    <View style={styles.splash}>
      <ActivityIndicator size="large" color="#2563eb" />
    </View>
  );
}

function MainApp() {
  const [activeTab, setActiveTab] = useState('테이블');
  const [tableResetSignal, setTableResetSignal] = useState(0);
  const [selectedTable, setSelectedTable] = useState(null);
  const { storeInfo } = useStore();
  const storeId = storeInfo?.storeId || null;

  // CID — Electron PC 에서 SIP 착신 → Firebase 기록 (다른 기기도 동시 수신)
  useCidHandler(storeId);
  // 모든 기기: Firebase 착신 이벤트 수신 → 팝업 표시
  const incomingCall = useIncomingCall(storeId);
  // 최근 선택된 테이블 id — TableScreen 복귀시 하이라이트용
  const [lastSelectedTableId, setLastSelectedTableId] = useState(null);
  // 주문 탭에서 '주문' 클릭 후 테이블 선택 시 자동 확정하기 위한 의도 플래그
  const [autoConfirmIntent, setAutoConfirmIntent] = useState(false);
  const { isNarrow, scale } = useResponsive();
  const isMobile = isNarrow;
  // 4탭 헤더 폰트도 PC(>=1200)에서 1.3 배. styles.tabText 는 정적이라 인라인으로만 곱함.
  const tabFontSize = Math.round((isMobile ? 11 : 13) * scale);

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
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right', 'bottom']}>
      {/* 착신 팝업 — 전화 오면 화면 상단에 표시. Electron PC + 폰/iPad 모두 동시. */}
      <IncomingCallBanner
        call={incomingCall}
        onDismiss={() => {/* 타이머 자동 해제, 별도 동작 불필요 */}}
        onOrderPress={() => {
          // "주문받기" 탭 → 주문 탭으로 이동 (배달 주문 시작)
          handleTabPress('주문');
        }}
      />
      {/* 자동 업데이트 진행/완료/오류 배너 — Electron(.exe) 환경에서만, downloading/downloaded/error 시만 표시.
          PinchZoom 밖에 둬서 사장님이 화면 줌해도 배너는 고정 크기 유지. */}
      <UpdateBanner />
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
                    style={[
                      styles.tabText,
                      isMobile && styles.tabTextMobile,
                      isActive && styles.tabTextActive,
                      { fontSize: tabFontSize },
                    ]}
                  >
                    {key}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.body}>
            <View
              style={[styles.pane, activeTab !== '테이블' && styles.paneHidden]}
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
                activeTab !== '되돌리기' && styles.paneHidden,
              ]}
            >
              <UndoScreen />
            </View>
            <View
              style={[styles.pane, activeTab !== '관리자' && styles.paneHidden]}
            >
              <AdminScreen />
            </View>
          </View>
        </View>
      </PinchZoom>

      <StatusBar style="dark" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  zoomRoot: { flex: 1, backgroundColor: '#fff' },
  // 검은 배경만 깔아두면 안쪽 SafeAreaView 가 자체 padding 으로 inset 영역을 만들 때
  // 그 영역에 이 검은 배경이 비쳐 노치/홈인디케이터 시뮬이 자연스럽게 그려진다.
  // 직접 padding 을 주면 SafeAreaView 와 이중으로 차감되어 컨텐츠 폭이 너무 작아진다.
  webInsetsBezel: { flex: 1, backgroundColor: '#000' },
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

  splash: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },

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
