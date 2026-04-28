// Alert 호환 wrapper.
// react-native 의 Alert.alert 는 web 에서 silent no-op (사용자 무반응으로 보임).
// web 에서는 brower 의 native window.alert 으로 fallback.
//
// 사용법:
//   import { alert } from '../utils/alertCompat';
//   alert('제목', '본문 메시지');

import { Alert, Platform } from 'react-native';

export function alert(title, message) {
  if (Platform.OS === 'web') {
    // 브라우저 alert 는 한 줄에 제목+본문 합쳐 보여주는 게 자연스러움.
    const body = title ? `${title}\n\n${message || ''}` : message || '';
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert(body);
    }
    return;
  }
  Alert.alert(title, message);
}
