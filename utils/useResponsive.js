import { useContext } from 'react';
import { useWindowDimensions } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

const ZERO_INSETS = { top: 0, bottom: 0, left: 0, right: 0 };

export function useResponsive() {
  const { width: rawW, height: rawH } = useWindowDimensions();
  // 노치/홈인디케이터(SafeArea) 만큼 차감해 실제 그려지는 컨테이너 폭/높이를 반환.
  // 이 값을 기준으로 반응형 분기 / 그리드 계산을 하면 wrap 사고를 막을 수 있다.
  // useContext 직접 사용 — SafeAreaProvider 외부(App 루트 등) 호출 시에도 안전.
  const insets = useContext(SafeAreaInsetsContext) || ZERO_INSETS;
  const width = Math.max(0, rawW - insets.left - insets.right);
  const height = Math.max(0, rawH - insets.top - insets.bottom);
  const isXS = width < 600;
  const isSM = width >= 600 && width < 900;
  const isMD = width >= 900 && width < 1200;
  const isLG = width >= 1200;
  const isPortrait = height >= width;
  const isLandscape = width > height;
  const isNarrow = width < 900;
  const size = isXS ? 'xs' : isSM ? 'sm' : isMD ? 'md' : 'lg';
  // PC/대형 태블릿 가독성 향상용 폰트 배율.
  // 모바일 노치 SafeArea 가 차감된 width 가 아닌 raw width(rawW) 로 분기 —
  // 데스크톱 브라우저는 inset 이 0 이라 동일하지만, 노치 시뮬레이션 환경에서
  // viewport 1280 이 width 1192 로 떨어져 lg 진입을 놓치는 이슈를 회피.
  // 미리보기(iPhone Pro Max 가로 932)는 md 영역이라 1.0 유지 → 모바일 레이아웃 미변경.
  const scale = rawW >= 1200 ? 1.3 : 1.0;
  return {
    width,
    height,
    size,
    scale,
    isXS,
    isSM,
    isMD,
    isLG,
    isNarrow,
    isPortrait,
    isLandscape,
  };
}
