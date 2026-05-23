// 키보드 가림 방지 공용 wrapper.
//
// 모달 / 화면 둘 다 자식에 TextInput 있을 때 사용. 가로 모드(landscape) 마이포스 환경에서
// iOS 가로 키보드가 화면 50% 가까이 덮는 문제 처방.
//
// 동작:
// - iOS: behavior='padding' — 키보드 위로 컨텐츠가 밀려 올라감
// - Android: behavior='height' — 컨텐츠 영역 자체가 줄어듬 (RN 기본 추천)
// - ScrollView 안에 들어가 있으면 키보드 영역 밖 입력칸은 스크롤로 닿을 수 있음
// - keyboardShouldPersistTaps='handled' — 키보드 떠 있는 동안 다른 버튼 한 번에 눌림
// - keyboardDismissMode — 사용자가 스크롤 시작하면 키보드 자동 내림 (iOS interactive / Android on-drag)
//
// 사용 패턴 2가지:
// 1) 화면 단위: <SafeAreaView><KeyboardAwareContent>...</KeyboardAwareContent></SafeAreaView>
// 2) absolute overlay 모달 안: <View overlay><KeyboardAwareContent centered>...modal box...</KeyboardAwareContent></View>

import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';

export default function KeyboardAwareContent({
  children,
  style,
  contentContainerStyle,
  scrollEnabled = true,
  keyboardVerticalOffset = 0,
  centered = false,
}) {
  const behavior = Platform.OS === 'ios' ? 'padding' : 'height';

  if (!scrollEnabled) {
    return (
      <KeyboardAvoidingView
        style={[styles.flex, style]}
        behavior={behavior}
        keyboardVerticalOffset={keyboardVerticalOffset}
      >
        {children}
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.flex, style]}
      behavior={behavior}
      keyboardVerticalOffset={keyboardVerticalOffset}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          centered && styles.centered,
          contentContainerStyle,
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1 },
  centered: { justifyContent: 'center', alignItems: 'center' },
});
