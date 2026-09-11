// 유령 매장 경고 띠 — 이 기기가 보는 매장이 서버에서 삭제됐을 때 상시 표시.
//
// 2026-09-11 사고: Firestore 는 부모 문서를 지워도 하위 컬렉션을 같이 지우지 않는다.
// 보안 규칙의 isMember() 가 stores/{id}/members 하위만 보기 때문에, 매장 문서가
// 삭제된 뒤에도 그 기기는 읽기·쓰기가 전부 허용돼 멀쩡히 장사를 계속한다.
// 다른 기기는 살아있는 매장에서 장사한다 → 주문·열린 테이블이 영영 안 합쳐진다.
// 재시작해도 각자 자기 매장을 정상적으로 불러올 뿐이라 증상이 "기기끼리 다름" 뿐이고,
// 클라우드 오류도 아니라서 기존 배너(쓰기 실패)로는 절대 안 잡혔다.
//
// 그래서 이 배너의 역할은 "조용한 정상" 을 깨는 것이다. 자동 복구는 하지 않는다 —
// 오탐 한 번이 영업 중 전 기기를 내쫓는 사고가 되므로, 판단은 사장님이 한다.
//
// pointerEvents="none" — 순수 표시용. 영업 중 어떤 터치도 가로채면 안 됨.

import { useMemo } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useStore } from '../utils/StoreContext';
import { useResponsive } from '../utils/useResponsive';

export default function StoreMissingBanner() {
  const { storeInfo } = useStore();
  const { scale } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);

  const ghost = !!storeInfo?.storeDocMissing;
  const denied = !!storeInfo?.accessDenied;
  if (!ghost && !denied) return null;

  // 유령 매장에서는 매장 이름/코드가 비어 있다 (매장 문서가 없으므로).
  // 끝 8자리라도 띄워 어느 기기가 어디에 붙어 있는지 사장님이 대조할 수 있게 한다.
  const tail = String(storeInfo.storeId || '').slice(-8) || '?';

  return (
    <View style={styles.overlay} pointerEvents="none">
      <View style={styles.banner}>
        <Text style={styles.title} numberOfLines={1}>
          {ghost
            ? `🔴 삭제된 매장에 연결됨 (…${tail}) — 다른 기기와 합쳐지지 않습니다`
            : `🔴 이 기기가 매장 접근 권한을 잃었습니다 (…${tail}) — 서버와 단절됨`}
        </Text>
        <Text style={styles.body} numberOfLines={1}>
          {ghost
            ? '관리자 → 매장 관리 → 매장 떠나기 → 살아있는 매장 코드로 재가입'
            : '이 기기의 주문·매출이 저장되지 않습니다. 매장 떠나기 → 매장 코드로 재가입'}
        </Text>
      </View>
    </View>
  );
}

function makeStyles(scale = 1) {
  const fp = (n) => Math.round(n * scale);
  return StyleSheet.create({
    overlay: {
      position: Platform.OS === 'web' ? 'fixed' : 'absolute',
      // 상단은 탭 바 자리 — 가리면 영업 중 탭이 안 보인다. 하단에 띄운다.
      // (CloudHealthBanner 는 상단이므로 둘이 겹치지도 않는다.)
      bottom: Platform.OS === 'web' ? 8 : Platform.OS === 'ios' ? 28 : 12,
      left: 0,
      right: 0,
      zIndex: 12500,
      alignItems: 'center',
      paddingHorizontal: 12,
    },
    banner: {
      backgroundColor: '#7f1d1d',
      borderWidth: 2,
      borderColor: '#fecaca',
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 18,
      maxWidth: 860,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.4,
      shadowRadius: 8,
      elevation: 11,
    },
    title: { color: '#fff', fontSize: fp(15), fontWeight: '900' },
    body: { color: '#fecaca', fontSize: fp(12), fontWeight: '700', marginTop: 3 },
  });
}
