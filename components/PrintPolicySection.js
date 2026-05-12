// 관리자 → 시스템 탭의 "주문지 출력" 섹션.
// 글로벌 정책(매장 단위, 4종 체크박스) + 자동 출력 토글(PC .exe 전용).
//
// 정책 변경은 즉시 AsyncStorage 저장. Firestore 동기화는 차후 단계에서 추가.
// 자동 출력 토글은 기기별 — PC .exe 에서만 의미. 폰/iPad 에서 토글해도 효과 X.

import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useResponsive } from '../utils/useResponsive';
import {
  DEFAULT_AUTO_TYPES,
  DEFAULT_POLICY,
  loadAutoOn,
  loadAutoTypes,
  loadPolicy,
  ORDER_TYPES,
  POLICY_KINDS,
  saveAutoOn,
  saveAutoTypes,
  savePolicy,
} from '../utils/printPolicy';

const KIND_META = {
  all:      { label: '모두',   desc: '전체 항목 출력' },
  added:    { label: '추가',   desc: '새로 추가된 항목만' },
  changed:  { label: '변경',   desc: '수량·옵션 변경 항목 + 취소' },
  delivery: { label: '배달지', desc: '영수증에 배달 주소 줄 포함' },
};

// 1.0.41: 자동 출력할 주문 종류 — 사장님 신고 "배달만 체크했는데 테이블 주문도 인쇄됨" fix
const TYPE_META = {
  regular:     { label: '매장 테이블', desc: 't01, r10 같은 매장 자리' },
  delivery:    { label: '배달',         desc: 'd1, d2 같은 배달 슬롯' },
  takeout:     { label: '포장',         desc: 'p1, p2 같은 포장 슬롯' },
  reservation: { label: '예약',         desc: 'y1, y2 같은 예약 슬롯' },
};

function isElectronEnv() {
  return typeof window !== 'undefined' && !!window.mypos?.isElectron;
}

export default function PrintPolicySection() {
  const { scale } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);

  const [kinds, setKinds] = useState(() => new Set(DEFAULT_POLICY.kinds));
  const [autoOn, setAutoOn] = useState(false);
  // 1.0.41: 자동 출력할 주문 종류 (매장/배달/포장/예약 4종)
  const [autoTypes, setAutoTypes] = useState(() => new Set(DEFAULT_AUTO_TYPES));
  const [hydrated, setHydrated] = useState(false);

  const electron = isElectronEnv();

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadPolicy(), loadAutoOn(), loadAutoTypes()]).then(
      ([p, a, t]) => {
        if (cancelled) return;
        setKinds(new Set(p.kinds || DEFAULT_POLICY.kinds));
        setAutoOn(!!a);
        setAutoTypes(new Set(t));
        setHydrated(true);
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // 정책 변경 — 즉시 저장. all ↔ added/changed 상호배타는 savePolicy 안에서 정리.
  const toggleKind = (key) => {
    const next = new Set(kinds);
    if (key === 'all') {
      if (next.has('all')) next.delete('all');
      else {
        next.add('all');
        next.delete('added');
        next.delete('changed');
      }
    } else if (key === 'added' || key === 'changed') {
      if (next.has(key)) next.delete(key);
      else {
        next.add(key);
        next.delete('all');
      }
    } else {
      // delivery — 다른 키와 독립
      if (next.has(key)) next.delete(key);
      else next.add(key);
    }
    setKinds(next);
    savePolicy({ kinds: [...next] });
  };

  const toggleAuto = (next) => {
    setAutoOn(next);
    saveAutoOn(next);
  };

  // 1.0.41: 주문 종류별 자동 출력 토글
  const toggleType = (type) => {
    const next = new Set(autoTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    setAutoTypes(next);
    saveAutoTypes([...next]);
  };

  if (!hydrated) return null;

  return (
    <>
      <Text style={styles.sectionTitle}>주문지 출력 정책</Text>
      <Text style={styles.helper}>
        🖨️ 버튼 또는 자동 출력 시 이 정책으로 출력 범위가 결정됩니다. 매장 단위 설정 — 모든 기기에 동일 적용.
      </Text>

      <View style={styles.kindList}>
        {POLICY_KINDS.map((key) => {
          const meta = KIND_META[key];
          const checked = kinds.has(key);
          const isDelivery = key === 'delivery';
          return (
            <TouchableOpacity
              key={key}
              style={[styles.kindRow, isDelivery && styles.kindRowDelivery]}
              onPress={() => toggleKind(key)}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.checkbox,
                  checked && (isDelivery ? styles.checkboxDelivery : styles.checkboxChecked),
                ]}
              >
                {checked ? <Text style={styles.checkmark}>✓</Text> : null}
              </View>
              <View style={styles.kindTextWrap}>
                <Text style={styles.kindLabel}>{meta.label}</Text>
                <Text style={styles.kindDesc}>{meta.desc}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {electron ? (
        <>
          <View style={styles.autoRow}>
            <View style={styles.autoText}>
              <Text style={styles.autoLabel}>자동 출력 (이 기기)</Text>
              <Text style={styles.autoHelper}>
                ON: 주문 확정 시 자동 출력. OFF: 🖨️ 버튼으로 수동 출력만.
                {'\n'}매장 약속에 따라 카운터 PC 만 ON, 주방 PC 는 OFF 권장 — 두 PC 다 ON 하면 영수증 두 장 출력.
              </Text>
            </View>
            <Switch
              value={autoOn}
              onValueChange={toggleAuto}
              accessibilityLabel="자동 출력 토글"
            />
          </View>

          {/* 1.0.41: 자동 출력할 주문 종류 — 사장님 신고 fix */}
          <Text style={styles.sectionTitle}>어떤 주문 종류를 자동 출력?</Text>
          <Text style={styles.helper}>
            체크된 종류의 주문만 자동 출력됩니다. 자동 출력 토글이 ON 일 때만 적용 — 토글 OFF 면 이 설정은 무시.
          </Text>
          <View style={styles.kindList}>
            {ORDER_TYPES.map((type) => {
              const meta = TYPE_META[type];
              const checked = autoTypes.has(type);
              return (
                <TouchableOpacity
                  key={type}
                  style={styles.kindRow}
                  onPress={() => toggleType(type)}
                  activeOpacity={0.7}
                >
                  <View
                    style={[
                      styles.checkbox,
                      checked && styles.checkboxChecked,
                    ]}
                  >
                    {checked ? <Text style={styles.checkmark}>✓</Text> : null}
                  </View>
                  <View style={styles.kindTextWrap}>
                    <Text style={styles.kindLabel}>{meta.label}</Text>
                    <Text style={styles.kindDesc}>{meta.desc}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      ) : null}
    </>
  );
}

function makeStyles(scale) {
  const fp = (n) => Math.round(n * scale);
  return StyleSheet.create({
    sectionTitle: {
      fontSize: fp(13),
      fontWeight: '700',
      color: '#374151',
      marginTop: 20,
      marginBottom: 4,
    },
    helper: {
      fontSize: fp(11),
      color: '#6b7280',
      marginBottom: 10,
      lineHeight: fp(15),
    },
    kindList: { gap: 8, marginBottom: 12 },
    kindRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#f9fafb',
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 12,
      gap: 12,
      borderWidth: 1,
      borderColor: '#e5e7eb',
    },
    kindRowDelivery: { borderColor: '#3b82f6' },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: '#9ca3af',
      justifyContent: 'center',
      alignItems: 'center',
    },
    checkboxChecked: { backgroundColor: '#10b981', borderColor: '#10b981' },
    checkboxDelivery: { backgroundColor: '#3b82f6', borderColor: '#3b82f6' },
    checkmark: { fontSize: fp(12), color: '#fff', fontWeight: '800' },
    kindTextWrap: { flex: 1 },
    kindLabel: { fontSize: fp(13), fontWeight: '700', color: '#111827' },
    kindDesc: { fontSize: fp(10), color: '#6b7280', marginTop: 1 },

    autoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 4,
      gap: 12,
    },
    autoText: { flex: 1 },
    autoLabel: { fontSize: fp(13), fontWeight: '700', color: '#111827' },
    autoHelper: { fontSize: fp(11), color: '#6b7280', marginTop: 2, lineHeight: fp(15) },
  });
}
