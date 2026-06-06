// 주소록 자동 정리 모달 — 2026-06-04 사장님 요청.
//   "클릭 한 번으로 오타/잘못 기입/조작 미숙 실수를 효율적으로 정리".
//
// 분석(utils/addressBookCleanup) → 사장님 확인 → 통합 적용.
//   - 같은 전화번호 그룹: 기본 선택 ON (같은 손님 = 안전). 주문횟수 합산 + 별칭/주소 보존.
//   - 비슷한 상호 쌍: 기본 OFF (다른 가게일 수 있음). 사장님이 "같은 곳" 체크 시만.
//
// iOS 새 아키텍처 크래시 영구 처방 — <Modal> 대신 absolute overlay (프로젝트 정책).

import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useResponsive } from '../utils/useResponsive';
import {
  findPhoneDuplicates,
  findSimilarAliasPairs,
  findIncompleteEntries,
  realAlias,
  hasRealAddress,
} from '../utils/addressBookCleanup';

function fmtPhone(d) {
  const s = String(d || '').replace(/\D/g, '');
  if (s.length === 11) return `${s.slice(0, 3)}-${s.slice(3, 7)}-${s.slice(7)}`;
  if (s.length === 10) return `${s.slice(0, 3)}-${s.slice(3, 6)}-${s.slice(6)}`;
  return s;
}

export default function AddressBookCleanupModal({ visible, entries, ignoredPairs, onApply, onIgnore, onClose }) {
  const { scale } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);

  const phoneGroups = useMemo(
    () => (visible ? findPhoneDuplicates(entries || {}) : []),
    [visible, entries]
  );
  const aliasPairs = useMemo(
    () => (visible ? findSimilarAliasPairs(entries || {}, ignoredPairs) : []),
    [visible, entries, ignoredPairs]
  );
  // phoneOnlyEntries: 번호만/별칭만/주소만(불완전) 항목 모두 — 일괄 삭제 대상.
  const phoneOnlyEntries = useMemo(
    () => (visible ? findIncompleteEntries(entries || {}) : []),
    [visible, entries]
  );

  // 선택 상태 — phone 그룹 기본 ON(undefined=ON), alias 쌍 기본 OFF.
  const [phoneOff, setPhoneOff] = useState({}); // idx → true 면 제외
  const [aliasOn, setAliasOn] = useState({}); // idx → true 면 포함
  const [phoneOnlyDel, setPhoneOnlyDel] = useState({}); // idx → true 면 삭제

  if (!visible) return null;

  // entry 한 줄 표시명 — 별칭 > 주소 > key.
  const nameOf = (key) => {
    const e = entries?.[key];
    if (!e) return key;
    const a = realAlias(e);
    if (a) return a;
    if (hasRealAddress(e)) return e.label;
    return e.label || key;
  };

  const selectedCount =
    phoneGroups.filter((_, i) => !phoneOff[i]).length +
    aliasPairs.filter((_, i) => aliasOn[i]).length +
    phoneOnlyEntries.filter((_, i) => phoneOnlyDel[i]).length;

  const handleApply = () => {
    const merges = [];
    phoneGroups.forEach((g, i) => {
      if (!phoneOff[i]) merges.push({ survivorKey: g.survivorKey, mergeKeys: g.mergeKeys });
    });
    aliasPairs.forEach((p, i) => {
      if (aliasOn[i]) merges.push({ survivorKey: p.survivorKey, mergeKeys: [p.mergeKey] });
    });
    const deleteKeys = phoneOnlyEntries
      .filter((_, i) => phoneOnlyDel[i])
      .map((e) => e.key);
    onApply?.(merges, deleteKeys);
  };

  const allPhoneOnlySelected =
    phoneOnlyEntries.length > 0 &&
    phoneOnlyEntries.every((_, i) => phoneOnlyDel[i]);
  const toggleAllPhoneOnly = () => {
    if (allPhoneOnlySelected) {
      setPhoneOnlyDel({});
    } else {
      const m = {};
      phoneOnlyEntries.forEach((_, i) => {
        m[i] = true;
      });
      setPhoneOnlyDel(m);
    }
  };

  const nothing =
    phoneGroups.length === 0 &&
    aliasPairs.length === 0 &&
    phoneOnlyEntries.length === 0;

  return (
    <View style={styles.overlay} pointerEvents="auto">
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title}>🧹 주소록 정리</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Text style={styles.closeBtn}>닫기</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={{ maxHeight: 420 }}
            contentContainerStyle={{ padding: 14, paddingBottom: 24 }}
          >
            {nothing && (
              <Text style={styles.emptyText}>정리할 중복이 없습니다 ✓</Text>
            )}

            {phoneGroups.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>
                  📞 같은 전화번호 — {phoneGroups.length}건
                </Text>
                <Text style={styles.sectionHint}>
                  같은 번호 = 같은 손님. 하나로 합치고 주문횟수 합산 + 별칭/주소 보존.
                  체크된 것만 적용됩니다 (기본 전부 ON).
                </Text>
                {phoneGroups.map((g, i) => {
                  const on = !phoneOff[i];
                  return (
                    <TouchableOpacity
                      key={g.phone}
                      style={[styles.card, on && styles.cardOn]}
                      activeOpacity={0.8}
                      onPress={() => setPhoneOff((p) => ({ ...p, [i]: on }))}
                    >
                      <View style={styles.cardRow}>
                        <Text style={[styles.check, on && styles.checkOn]}>
                          {on ? '☑' : '☐'}
                        </Text>
                        <Text style={styles.cardPhone}>{fmtPhone(g.phone)}</Text>
                      </View>
                      <Text style={styles.survivorText}>
                        ✓ 남길 항목: <Text style={styles.survivorName}>{nameOf(g.survivorKey)}</Text>
                      </Text>
                      {g.mergeKeys.map((mk) => (
                        <Text key={mk} style={styles.mergeText} numberOfLines={1}>
                          → 합쳐서 삭제: {nameOf(mk)}
                        </Text>
                      ))}
                    </TouchableOpacity>
                  );
                })}
              </>
            )}

            {aliasPairs.length > 0 && (
              <>
                <Text style={[styles.sectionTitle, { marginTop: 16 }]}>
                  🏪 비슷한 상호 — {aliasPairs.length}건
                </Text>
                <Text style={styles.sectionHint}>
                  같은 가게면 체크 → 합침. 다른 가게면 "다른 가게" 를 눌러 다음부터 숨김.
                </Text>
                {aliasPairs.map((p, i) => {
                  const on = !!aliasOn[i];
                  return (
                    <TouchableOpacity
                      key={`${p.keyA}__${p.keyB}`}
                      style={[styles.card, on && styles.cardOnAmber]}
                      activeOpacity={0.8}
                      onPress={() => setAliasOn((s) => ({ ...s, [i]: !on }))}
                    >
                      <View style={styles.cardRow}>
                        <Text style={[styles.check, on && styles.checkOnAmber]}>
                          {on ? '☑' : '☐'}
                        </Text>
                        <Text style={styles.pairText}>
                          {p.a}　↔　{p.b}
                        </Text>
                        <TouchableOpacity
                          style={styles.otherStoreBtn}
                          onPress={() => onIgnore?.(p.keyA, p.keyB)}
                          hitSlop={6}
                        >
                          <Text style={styles.otherStoreBtnText}>다른 가게</Text>
                        </TouchableOpacity>
                      </View>
                      {on && (
                        <Text style={styles.survivorText}>
                          ✓ "{nameOf(p.survivorKey)}" 로 합침
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </>
            )}

            {phoneOnlyEntries.length > 0 && (
              <>
                <View style={styles.sectionHeaderRow}>
                  <Text style={[styles.sectionTitle, { marginTop: 16 }]}>
                    📵 번호만·별칭만·주소만 — {phoneOnlyEntries.length}건
                  </Text>
                  <TouchableOpacity
                    style={styles.selectAllBtn}
                    onPress={toggleAllPhoneOnly}
                    hitSlop={6}
                  >
                    <Text style={styles.selectAllText}>
                      {allPhoneOnlySelected ? '전체 해제' : '전체 선택'}
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.sectionHint}>
                  전화·별칭·주소 중 하나만 있는 불완전 항목. 지울 것만 체크하세요 (기본 OFF).
                  "N회" 는 주문 이력 있는 단골 — 신중히.
                </Text>
                {phoneOnlyEntries.map((e, i) => {
                  const on = !!phoneOnlyDel[i];
                  const icon =
                    e.kind === 'phone' ? '📞' : e.kind === 'alias' ? '👤' : '📍';
                  const text = e.kind === 'phone' ? fmtPhone(e.display) : e.display;
                  return (
                    <TouchableOpacity
                      key={e.key}
                      style={[styles.card, on && styles.cardOnRed]}
                      activeOpacity={0.8}
                      onPress={() => setPhoneOnlyDel((s) => ({ ...s, [i]: !on }))}
                    >
                      <View style={styles.cardRow}>
                        <Text style={[styles.check, on && styles.checkOnRed]}>
                          {on ? '🗑' : '☐'}
                        </Text>
                        <Text style={styles.cardPhone} numberOfLines={1}>
                          {icon} {text}
                        </Text>
                        {e.count > 0 ? (
                          <Text style={styles.countBadge}>{e.count}회</Text>
                        ) : null}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </>
            )}
          </ScrollView>

          {!nothing && (
            <View style={styles.footer}>
              <TouchableOpacity
                style={[styles.applyBtn, selectedCount === 0 && styles.applyBtnDisabled]}
                disabled={selectedCount === 0}
                onPress={handleApply}
              >
                <Text style={styles.applyText}>
                  {selectedCount > 0 ? `${selectedCount}건 정리 적용` : '선택 없음'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
                <Text style={styles.cancelText}>취소</Text>
              </TouchableOpacity>
            </View>
          )}
        </Pressable>
      </Pressable>
    </View>
  );
}

function makeStyles(scale = 1) {
  const fp = (n) => Math.round(n * scale);
  return StyleSheet.create({
    overlay: { ...StyleSheet.absoluteFillObject, zIndex: 10000 },
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 16,
    },
    sheet: {
      width: '100%',
      maxWidth: 560,
      backgroundColor: '#fff',
      borderRadius: 12,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 14,
      backgroundColor: '#2563eb',
    },
    title: { fontSize: fp(16), fontWeight: '900', color: '#fff' },
    closeBtn: { fontSize: fp(13), fontWeight: '700', color: '#fff' },
    emptyText: { fontSize: fp(15), color: '#15803d', fontWeight: '700', textAlign: 'center', paddingVertical: 24 },
    sectionTitle: { fontSize: fp(14), fontWeight: '900', color: '#111827', marginBottom: 4 },
    sectionHint: { fontSize: fp(11), color: '#6b7280', marginBottom: 8, lineHeight: fp(16) },
    card: {
      borderWidth: 1,
      borderColor: '#e5e7eb',
      borderRadius: 8,
      padding: 10,
      marginBottom: 8,
      backgroundColor: '#f9fafb',
    },
    cardOn: { borderColor: '#2563eb', backgroundColor: '#eff6ff' },
    cardOnAmber: { borderColor: '#d97706', backgroundColor: '#fffbeb' },
    cardOnRed: { borderColor: '#dc2626', backgroundColor: '#fef2f2' },
    cardRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
    check: { fontSize: fp(18), color: '#9ca3af' },
    checkOn: { color: '#2563eb' },
    checkOnAmber: { color: '#d97706' },
    checkOnRed: { color: '#dc2626' },
    cardPhone: { fontSize: fp(15), fontWeight: '800', color: '#111827' },
    countBadge: { fontSize: fp(11), color: '#15803d', fontWeight: '800', marginLeft: 'auto' },
    sectionHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    selectAllBtn: {
      borderWidth: 1,
      borderColor: '#dc2626',
      borderRadius: 6,
      paddingHorizontal: 10,
      paddingVertical: 4,
      marginTop: 16,
    },
    selectAllText: { fontSize: fp(11), color: '#dc2626', fontWeight: '800' },
    pairText: { fontSize: fp(14), fontWeight: '700', color: '#111827', flex: 1 },
    // "다른 가게" 버튼 — 누르면 그 쌍 무시 목록에 → 다음부터 후보에서 숨김.
    otherStoreBtn: {
      borderWidth: 1,
      borderColor: '#9ca3af',
      borderRadius: 6,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    otherStoreBtnText: { fontSize: fp(11), color: '#6b7280', fontWeight: '800' },
    survivorText: { fontSize: fp(12), color: '#15803d', fontWeight: '700', marginLeft: 26 },
    survivorName: { fontWeight: '900' },
    mergeText: { fontSize: fp(11), color: '#b91c1c', marginLeft: 26 },
    footer: {
      flexDirection: 'row',
      gap: 8,
      padding: 12,
      borderTopWidth: 1,
      borderTopColor: '#e5e7eb',
    },
    applyBtn: {
      flex: 2,
      backgroundColor: '#2563eb',
      paddingVertical: 14,
      borderRadius: 8,
      alignItems: 'center',
    },
    applyBtnDisabled: { backgroundColor: '#9ca3af' },
    applyText: { color: '#fff', fontSize: fp(14), fontWeight: '800' },
    cancelBtn: {
      flex: 1,
      borderWidth: 1,
      borderColor: '#9ca3af',
      paddingVertical: 14,
      borderRadius: 8,
      alignItems: 'center',
    },
    cancelText: { color: '#374151', fontSize: fp(14), fontWeight: '700' },
  });
}
