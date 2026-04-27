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
  return {
    width,
    height,
    size,
    isXS,
    isSM,
    isMD,
    isLG,
    isNarrow,
    isPortrait,
    isLandscape,
  };
}
