// Firestore DocumentSnapshot 호환 헬퍼.
// @react-native-firebase v22+ 부터 DocumentSnapshot.exists 가 속성(boolean) → 메소드(boolean) 로 변경.
// 옛 버전 / 새 버전 / 웹 stub(null) 모두 안전하게 처리.

export function snapExists(snap) {
  if (!snap) return false;
  return typeof snap.exists === 'function' ? snap.exists() : !!snap.exists;
}
