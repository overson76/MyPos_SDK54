// 메뉴 이미지 선택 — 웹/네이티브 공용. SettingScreen 인라인 패턴을 공유 util 로 추출.
// 웹: <input type=file> + FileReader → data URL
// 네이티브: expo-image-picker → base64 data URL
// 양쪽 모두 같은 형식 (data:image/...;base64,...) 으로 반환해 메뉴 image 필드 일관성 유지.
import { Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

export function pickMenuImage() {
  if (Platform.OS === 'web') {
    return new Promise((resolve) => {
      if (typeof document === 'undefined') {
        resolve(null);
        return;
      }
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target?.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      };
      input.click();
    });
  }
  // 네이티브
  return (async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          '권한 필요',
          '메뉴 이미지를 변경하려면 사진 라이브러리 접근 권한이 필요합니다.'
        );
        return null;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        allowsEditing: false,
        base64: true,
        quality: 0.7,
      });
      if (result.canceled || !result.assets || !result.assets[0]) return null;
      const asset = result.assets[0];
      if (!asset.base64) return null;
      const mime = asset.mimeType || 'image/jpeg';
      return `data:${mime};base64,${asset.base64}`;
    } catch (e) {
      return null;
    }
  })();
}
