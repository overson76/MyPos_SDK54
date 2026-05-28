// 2026-05-25 사장님 요청 — 주문 확정 직전 별칭 입력 + 자동 매칭/주소 검색 풀세트.
//
// 단계:
//   1) input  : 별칭 입력 (이미 있으면 채움) + 건너뛰기 / 다음
//   2) similar: findSimilarAliases 후보 있으면 표시 — "그 손님" 선택 또는 "새 손님"
//   3) search : 주소 비어있고 새 손님 선택 시 카카오 로컬 키워드 검색 (매장 반경 5km)
//               결과 있으면 "이 주소 맞나요?" confirm. 못 찾으면 즉시 완료.
//   완료 → onConfirm({ alias, mergeIntoKey, autoAddress })
//     - alias: 사장님이 입력한 별칭 (skip 시 null)
//     - mergeIntoKey: 유사 매칭 후보 선택 시 그 entry.key (없으면 null = 새 entry)
//     - autoAddress: 카카오 검색 자동 채움 주소 (있으면 entry.label 로)

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useResponsive } from '../utils/useResponsive';
import { findSimilarAliases, isLandlinePhone } from '../utils/addressBookLookup';
import { searchKeywordNearby } from '../utils/geocode';

export default function AliasPromptModal({
  visible,
  initialAlias = '',
  currentPhone = '',
  currentAddress = '',
  addressBook,
  storeCoord,
  onConfirm,
  onCancel,
}) {
  const { scale } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);

  const [step, setStep] = useState('input'); // 'input' | 'similar' | 'search'
  const [alias, setAlias] = useState(initialAlias);
  const [similarCandidates, setSimilarCandidates] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState(null); // { lat, lng, formatted, name } | null
  const aliasRef = useRef(null);

  // visible 변경 시 초기화
  useEffect(() => {
    if (visible) {
      setStep('input');
      setAlias(initialAlias || '');
      setSimilarCandidates([]);
      setSearchResult(null);
      setSearching(false);
    }
  }, [visible, initialAlias]);

  if (!visible) return null;

  const handleSkip = () => {
    onConfirm?.({ alias: null, mergeIntoKey: null, autoAddress: null });
  };

  const handleNext = () => {
    const a = alias.trim();
    if (!a) {
      handleSkip();
      return;
    }
    const cands = findSimilarAliases(a, addressBook);
    if (cands.length > 0) {
      setSimilarCandidates(cands);
      setStep('similar');
      return;
    }
    // 후보 없음 — 새 손님. 주소 비어있으면 카카오 검색.
    if (!currentAddress && storeCoord) {
      runAddressSearch(a, null);
    } else {
      onConfirm?.({ alias: a, mergeIntoKey: null, autoAddress: null });
    }
  };

  const handleSelectCandidate = (entryKey) => {
    onConfirm?.({ alias: alias.trim(), mergeIntoKey: entryKey, autoAddress: null });
  };

  const handleNewCustomer = () => {
    const a = alias.trim();
    if (!currentAddress && storeCoord) {
      runAddressSearch(a, null);
    } else {
      onConfirm?.({ alias: a, mergeIntoKey: null, autoAddress: null });
    }
  };

  const runAddressSearch = async (kw, mergeKey) => {
    setStep('search');
    setSearching(true);
    setSearchResult(null);
    try {
      // 1차: 별칭 키워드 검색
      let result = await searchKeywordNearby(kw, storeCoord, 5000);
      // 2차 fallback: phone 이 일반전화/대표번호면 phone 으로 재시도.
      // 사장님 운영 — 상호 있는 가게는 카카오 장소 DB 에 전화 등록되어 있어 매칭 가능.
      // 휴대폰 (010 등) 은 개인 번호라 카카오 DB 미등록 → skip.
      if (!result && currentPhone && isLandlinePhone(currentPhone)) {
        result = await searchKeywordNearby(currentPhone, storeCoord, 5000);
      }
      setSearchResult(result);
    } catch (_) {
      setSearchResult(null);
    } finally {
      setSearching(false);
    }
  };

  const handleAcceptAddress = () => {
    onConfirm?.({
      alias: alias.trim(),
      mergeIntoKey: null,
      autoAddress: searchResult?.formatted || null,
    });
  };

  const handleRejectAddress = () => {
    onConfirm?.({ alias: alias.trim(), mergeIntoKey: null, autoAddress: null });
  };

  return (
    <View style={styles.overlay} pointerEvents="auto">
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.kavWrap}
        >
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.header}>
              <Text style={styles.title}>
                {step === 'input'
                  ? '손님 별칭 등록'
                  : step === 'similar'
                  ? '같은 손님이세요?'
                  : '주소 자동 검색'}
              </Text>
              <TouchableOpacity onPress={onCancel} hitSlop={8}>
                <Text style={styles.closeBtn}>닫기</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              style={{ flexGrow: 1, minHeight: 200 }}
              contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
            >
              {step === 'input' && (
                <>
                  <Text style={styles.hint}>
                    이 주문의 손님 별칭을 입력하세요. 입력하면 주소록에 자동
                    저장됩니다. 별칭이 필요 없으면 "건너뛰기".
                  </Text>
                  {currentPhone ? (
                    <Text style={styles.metaLine}>📞 {currentPhone}</Text>
                  ) : null}
                  {currentAddress ? (
                    <Text style={styles.metaLine}>📍 {currentAddress}</Text>
                  ) : (
                    <Text style={styles.metaWarn}>
                      📍 주소 미입력 — 별칭 입력 후 카카오 자동 검색 시도
                    </Text>
                  )}
                  <TextInput
                    ref={aliasRef}
                    style={styles.aliasInput}
                    value={alias}
                    onChangeText={setAlias}
                    placeholder="예) 진실보석, 김사장"
                    placeholderTextColor="#9ca3af"
                    maxLength={30}
                    autoFocus
                  />
                  <View style={styles.actions}>
                    <TouchableOpacity style={styles.confirmBtn} onPress={handleNext}>
                      <Text style={styles.confirmText}>다음</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.skipBtn} onPress={handleSkip}>
                      <Text style={styles.skipText}>건너뛰기</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {step === 'similar' && (
                <>
                  <Text style={styles.hint}>
                    입력한 "{alias}" 과 비슷한 별칭의 손님이 이미 있어요. 같은
                    손님이면 선택 → 이 전화번호를 그 손님에 추가합니다.
                  </Text>
                  {similarCandidates.map((c) => {
                    // 2026-05-28: alias 비면 label 을 식별자로 표시 — findSimilarAliases 가
                    // 이제 label 도 매칭하므로 alias 없는 entry 도 후보로 들어옴.
                    const headLabel = (c.alias || '').trim() || (c.label || '').trim();
                    const phoneText = c.phone || (Array.isArray(c.phones) ? c.phones[0] : '');
                    return (
                      <TouchableOpacity
                        key={c.key}
                        style={styles.candidate}
                        onPress={() => handleSelectCandidate(c.key)}
                      >
                        <Text style={styles.candidateAlias}>👤 {headLabel}</Text>
                        {c.label && c.label !== headLabel ? (
                          <Text style={styles.candidateAddr} numberOfLines={1}>
                            📍 {c.label}
                          </Text>
                        ) : null}
                        {phoneText ? (
                          <Text style={styles.candidateAddr} numberOfLines={1}>
                            ☎ {phoneText}
                          </Text>
                        ) : null}
                        {c.count > 0 ? (
                          <Text style={styles.candidateCount}>×{c.count}회 주문</Text>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                  <TouchableOpacity style={styles.newCustomerBtn} onPress={handleNewCustomer}>
                    <Text style={styles.newCustomerText}>+ 새 손님 (모두 다름)</Text>
                  </TouchableOpacity>
                </>
              )}

              {step === 'search' && (
                <>
                  {searching ? (
                    <View style={styles.searchingBox}>
                      <ActivityIndicator size="large" color="#2563eb" />
                      <Text style={styles.hint}>
                        매장 반경 5km 내 "{alias}" 검색 중…
                      </Text>
                    </View>
                  ) : searchResult ? (
                    <>
                      <Text style={styles.hint}>
                        매장 근처에서 "{searchResult.name}" 발견. 이 주소가
                        맞나요?
                      </Text>
                      <View style={styles.foundBox}>
                        <Text style={styles.foundName}>🏪 {searchResult.name}</Text>
                        <Text style={styles.foundAddr}>📍 {searchResult.formatted}</Text>
                      </View>
                      <View style={styles.actions}>
                        <TouchableOpacity style={styles.confirmBtn} onPress={handleAcceptAddress}>
                          <Text style={styles.confirmText}>맞아요 (등록)</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.skipBtn} onPress={handleRejectAddress}>
                          <Text style={styles.skipText}>아니에요 (별칭만)</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  ) : (
                    <>
                      <Text style={styles.hint}>
                        매장 근처에서 "{alias}" 못 찾았어요. 별칭만 등록하고
                        주소는 관리자 → 주소록에서 채우시면 됩니다.
                      </Text>
                      <View style={styles.actions}>
                        <TouchableOpacity style={styles.confirmBtn} onPress={handleRejectAddress}>
                          <Text style={styles.confirmText}>확인</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  )}
                </>
              )}
            </ScrollView>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </View>
  );
}

function makeStyles(scale = 1) {
  const fp = (n) => Math.round(n * scale);
  return StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 10000,
    },
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 16,
    },
    kavWrap: {
      width: '100%',
      maxWidth: 520,
      justifyContent: 'center',
      alignItems: 'center',
    },
    sheet: {
      width: '100%',
      maxWidth: 520,
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
    hint: {
      fontSize: fp(13),
      color: '#374151',
      marginBottom: 12,
      lineHeight: fp(20),
    },
    metaLine: {
      fontSize: fp(13),
      color: '#111827',
      fontWeight: '700',
      marginBottom: 4,
    },
    metaWarn: {
      fontSize: fp(12),
      color: '#dc2626',
      fontWeight: '700',
      marginBottom: 8,
    },
    aliasInput: {
      borderWidth: 1,
      borderColor: '#d1d5db',
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 12,
      minHeight: 48,
      fontSize: fp(16),
      color: '#111827',
      marginBottom: 12,
      backgroundColor: '#fff',
    },
    actions: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 8,
    },
    confirmBtn: {
      flex: 1,
      backgroundColor: '#2563eb',
      paddingVertical: 14,
      borderRadius: 8,
      alignItems: 'center',
    },
    confirmText: { color: '#fff', fontSize: fp(14), fontWeight: '800' },
    skipBtn: {
      flex: 1,
      borderWidth: 1,
      borderColor: '#9ca3af',
      paddingVertical: 14,
      borderRadius: 8,
      alignItems: 'center',
    },
    skipText: { color: '#374151', fontSize: fp(14), fontWeight: '700' },
    candidate: {
      borderWidth: 1,
      borderColor: '#2563eb',
      backgroundColor: '#eff6ff',
      borderRadius: 8,
      padding: 12,
      marginBottom: 8,
      gap: 4,
    },
    candidateAlias: { fontSize: fp(15), fontWeight: '800', color: '#1e40af' },
    candidateAddr: { fontSize: fp(12), color: '#374151' },
    candidateCount: { fontSize: fp(11), color: '#6b7280' },
    newCustomerBtn: {
      borderWidth: 1,
      borderColor: '#9ca3af',
      borderStyle: 'dashed',
      backgroundColor: '#f9fafb',
      borderRadius: 8,
      padding: 12,
      alignItems: 'center',
      marginTop: 4,
    },
    newCustomerText: { fontSize: fp(13), fontWeight: '700', color: '#374151' },
    searchingBox: {
      alignItems: 'center',
      gap: 12,
      padding: 20,
    },
    foundBox: {
      borderWidth: 1,
      borderColor: '#16a34a',
      backgroundColor: '#f0fdf4',
      borderRadius: 8,
      padding: 12,
      marginBottom: 8,
      gap: 4,
    },
    foundName: { fontSize: fp(15), fontWeight: '800', color: '#15803d' },
    foundAddr: { fontSize: fp(12), color: '#374151' },
  });
}
