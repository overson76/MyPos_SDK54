import { useWindowDimensions } from 'react-native';

export function useResponsive() {
  const { width, height } = useWindowDimensions();
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
