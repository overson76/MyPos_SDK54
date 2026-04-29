// 네이티브 (iOS/Android) 빌드용 — 추후 expo-sharing 도입 전에는 안내 alert.
// 매장 운영 흐름은 PC 카운터(웹) 에서 CSV 다운로드 → 회계 사무소 송부가 자연스러움.
import { Alert, Platform } from 'react-native';

export function downloadCsv() {
  if (Platform.OS === 'web') {
    // .web.js 가 우선 매칭되므로 여기 도달 X. 안전 장치.
    return;
  }
  Alert.alert(
    'CSV 다운로드',
    'CSV 익스포트는 PC 카운터(웹) 에서 사용해주세요. 파일이 PC 다운로드 폴더로 저장됩니다.'
  );
}
