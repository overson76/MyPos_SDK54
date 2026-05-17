// 네이티브 (iOS/Android) 빌드용 stub — 폰에서 파일 시스템 접근 안내.
// 사장님이 PC 카운터에서 백업/복원하도록 유도.

import { Alert } from 'react-native';

export function downloadJson(/* data, filename */) {
  Alert.alert(
    '백업 안내',
    '주소록 백업은 PC 매장카운터에서 다운로드해주세요. 파일 시스템 직접 저장은 폰에서 제한적입니다.'
  );
}

export function pickJsonFile() {
  return new Promise((resolve) => {
    Alert.alert(
      '복원 안내',
      '주소록 복원은 PC 매장카운터에서 진행해주세요.'
    );
    resolve(null);
  });
}
