// 관리자 → 주소록 풀스크린 패널. 매장 공용 데이터베이스 역할.
//
// AddressBookModal(주문화면 빠른 선택용) 과 별도 — 관리 전용 화면.
// 차이점:
//   - 모달 아닌 풀스크린 (AdminScreen 의 한 섹션)
//   - 주소(label) 자체도 편집 가능 (모달은 별칭/전화만)
//   - 매장 ↔ entry 거리 컬럼 (StoreContext.lat/lng 사용)
//   - 정렬 옵션 (최근/사용횟수/거리/가나다/미입력 먼저)
//   - pendingAddress entry 강조 — CID 신규 번호 / 미확인 임포트
//   - 백업 75개 일괄 임포트 버튼
//
// "데이터베이스 역할":
//   - 미리 주소 기입 (+ 새 주소)
//   - CID 자동 등록된 phone-only entry 가 여기 노출 → 직원이 주소 채워서 정식 entry 로
//   - 카카오 로컬 API geocode 는 useAddressBook 의 effect 가 백그라운드로 처리

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useOrders } from '../utils/OrderContext';
import { useStore } from '../utils/StoreContext';
import { useResponsive } from '../utils/useResponsive';
import {
  formatDrivingDistance,
  formatDuration,
  getDrivingDistance,
  isGeocodingAvailable,
  isNaviAvailable,
} from '../utils/geocode';
import { importAddresses, SEED_BUSINESS_ADDRESSES } from '../utils/seedAddresses';

const SORT_MODES = [
  { key: 'recent', label: '최근' },
  { key: 'count', label: '주문횟수' },
  { key: 'distance', label: '거리' },
  { key: 'alpha', label: '가나다' },
  { key: 'pending', label: '미입력 먼저' },
];

export default function AddressBookPanel() {
  const { scale, isNarrow } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);
  const {
    addressBook,
    setAddressBook,
    pinAddress,
    deleteAddress,
    setAlias,
    setPhone,
    setCustomerRequest,
    addAddress,
    editLabel,
    setAutoRemember,
  } = useOrders();
  const { storeInfo } = useStore();

  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState('pending');
  const [editingKey, setEditingKey] = useState(null);
  const [editLabelText, setEditLabelText] = useState('');
  const [editAlias, setEditAlias] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editCustomerRequest, setEditCustomerRequest] = useState('');
  const [addingNew, setAddingNew] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newAlias, setNewAlias] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newCustomerRequest, setNewCustomerRequest] = useState('');
  const [showImport, setShowImport] = useState(false);

  const storeCoord = useMemo(() => {
    if (typeof storeInfo?.lat === 'number' && typeof storeInfo?.lng === 'number') {
      return { lat: storeInfo.lat, lng: storeInfo.lng };
    }
    return null;
  }, [storeInfo]);

  // 카카오 모빌리티 길찾기 API lazy fetch — entry 당 한 번만 호출, 영구 캐시.
  // entry.drivingFromLat/Lng 가 현재 매장좌표와 다르면 재계산 (매장 이전 대응).
  // 동시 호출 폭주 방지 — inFlightRef. 일시 실패는 failedRef (앱 재시작 시 재시도).
  const inFlightRef = useRef(new Set());
  const failedRef = useRef(new Set());
  useEffect(() => {
    if (!storeCoord || !isNaviAvailable()) return;
    const fromLat = storeCoord.lat;
    const fromLng = storeCoord.lng;
    for (const entry of Object.values(addressBook.entries || {})) {
      if (typeof entry.lat !== 'number' || typeof entry.lng !== 'number') continue;
      // 이미 캐시돼있고 매장좌표 동일 — 스킵
      if (
        typeof entry.drivingM === 'number' &&
        entry.drivingFromLat === fromLat &&
        entry.drivingFromLng === fromLng
      ) {
        continue;
      }
      if (inFlightRef.current.has(entry.key)) continue;
      if (failedRef.current.has(entry.key)) continue;
      inFlightRef.current.add(entry.key);
      getDrivingDistance(
        { lat: fromLat, lng: fromLng },
        { lat: entry.lat, lng: entry.lng }
      ).then((result) => {
        inFlightRef.current.delete(entry.key);
        if (!result) {
          failedRef.current.add(entry.key);
          return;
        }
        setAddressBook((prev) => {
          const ex = prev.entries[entry.key];
          if (!ex) return prev;
          return {
            ...prev,
            entries: {
              ...prev.entries,
              [entry.key]: {
                ...ex,
                drivingM: result.distanceM,
                drivingDurationSec: result.durationSec,
                drivingFromLat: fromLat,
                drivingFromLng: fromLng,
              },
            },
          };
        });
      });
    }
  }, [addressBook.entries, storeCoord, setAddressBook]);

  // 매장 좌표가 바뀌면 inFlightRef / failedRef 도 리셋 — 옛 결과의 in-flight 무효화.
  useEffect(() => {
    inFlightRef.current.clear();
    failedRef.current.clear();
  }, [storeCoord?.lat, storeCoord?.lng]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const arr = Object.values(addressBook.entries || {});

    const filtered = q
      ? arr.filter(
          (e) =>
            (e.label || '').toLowerCase().includes(q) ||
            (e.alias || '').toLowerCase().includes(q) ||
            (e.phone || '').includes(q)
        )
      : arr;

    return filtered.sort((a, b) => {
      // 핀 우선 (정렬 모드 무관)
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;

      switch (sortMode) {
        case 'count':
          return (b.count || 0) - (a.count || 0);
        case 'distance': {
          const ad = typeof a.drivingM === 'number' ? a.drivingM : null;
          const bd = typeof b.drivingM === 'number' ? b.drivingM : null;
          if (ad == null && bd == null) return 0;
          if (ad == null) return 1;
          if (bd == null) return -1;
          return ad - bd;
        }
        case 'alpha':
          return (a.label || '').localeCompare(b.label || '', 'ko');
        case 'pending': {
          const ap = a.pendingAddress ? 0 : 1;
          const bp = b.pendingAddress ? 0 : 1;
          if (ap !== bp) return ap - bp;
          return (b.lastUsedAt || 0) - (a.lastUsedAt || 0);
        }
        case 'recent':
        default:
          return (b.lastUsedAt || 0) - (a.lastUsedAt || 0);
      }
    });
  }, [addressBook.entries, query, sortMode]);

  const pendingCount = useMemo(
    () => Object.values(addressBook.entries || {}).filter((e) => e.pendingAddress).length,
    [addressBook.entries]
  );
  const totalCount = Object.keys(addressBook.entries || {}).length;

  const geoOk = isGeocodingAvailable();

  const openEdit = (it) => {
    setEditingKey(it.key);
    setEditLabelText(it.pendingAddress ? '' : it.label || '');
    setEditAlias(it.alias || '');
    setEditPhone(it.phone ? formatPhoneDisplay(it.phone) : '');
    setEditCustomerRequest(it.customerRequest || '');
  };

  const confirmEdit = () => {
    if (!editingKey) return;
    const entry = addressBook.entries[editingKey];
    const wasPending = !!entry?.pendingAddress;
    // 1) label 이 바뀌면 editLabel — key 가 새로 잡힘 (또는 그대로)
    let nextKey = editingKey;
    const trimmedNewLabel = editLabelText.trim();
    if (trimmedNewLabel && (wasPending || trimmedNewLabel !== entry?.label)) {
      const ok = editLabel(editingKey, trimmedNewLabel);
      if (ok) {
        // 새 키 추정 — editLabel 내부 결과 받기 어려우니 setAlias/setPhone 은
        // 새 key 가 적용된 후 setAddressBook 으로 한 번에 처리하는 대신,
        // setTimeout 0 로 다음 tick 에 갱신 (간단). 더 정확하게는 setAddressBook 콜백 안에서.
        // 여기서는 editLabel 이 normalizeAddressKey 와 같은 함수를 쓰니 같은 결과.
      }
    }
    // 2) alias/phone 갱신 — pending 이었으면 새 key 기준이지만, useAddressBook 의 setAlias/setPhone
    //    은 oldKey 로 호출되면 noop. setAddressBook 으로 직접 갱신.
    setAddressBook((prev) => {
      // 새 key 또는 그대로 — entries 안에서 oldKey 또는 새 key 후보 둘 다 시도
      const candidates = Object.values(prev.entries);
      const candidate = candidates.find(
        (e) =>
          e.key === editingKey ||
          (trimmedNewLabel && e.label === trimmedNewLabel)
      );
      if (!candidate) return prev;
      const digits = (editPhone || '').replace(/\D/g, '');
      const trimmedAlias = editAlias.trim();
      const trimmedRequest = (editCustomerRequest || '').trim().slice(0, 100);
      const updated = { ...candidate };
      if (trimmedAlias) updated.alias = trimmedAlias;
      else delete updated.alias;
      if (digits) updated.phone = digits;
      else delete updated.phone;
      if (trimmedRequest) updated.customerRequest = trimmedRequest;
      else delete updated.customerRequest;
      return {
        ...prev,
        entries: { ...prev.entries, [candidate.key]: updated },
      };
    });
    setEditingKey(null);
  };

  const cancelEdit = () => setEditingKey(null);

  const confirmAdd = () => {
    if (!newLabel.trim()) return;
    const ok = addAddress(
      newLabel.trim(),
      newAlias.trim(),
      newPhone,
      newCustomerRequest.trim()
    );
    if (ok) {
      setAddingNew(false);
      setNewLabel('');
      setNewAlias('');
      setNewPhone('');
      setNewCustomerRequest('');
    }
  };

  const cancelAdd = () => {
    setAddingNew(false);
    setNewLabel('');
    setNewAlias('');
    setNewPhone('');
    setNewCustomerRequest('');
  };

  const handleImport = (mode) => {
    const result = importAddresses(setAddressBook, mode);
    setShowImport(false);
    const msg = `${result.added}건 추가 · ${result.skipped}건 스킵(중복) · 총 시도 ${result.total}건`;
    if (Platform.OS === 'web') {
      // RN-Web 에서 Alert.alert 는 confirm 다이얼로그. 단순 안내는 console + ephemeral state 가 깔끔하지만
      // 일관성을 위해 Alert 사용.
      Alert.alert('임포트 완료', msg);
    } else {
      Alert.alert('임포트 완료', msg);
    }
  };

  const handleDelete = (it) => {
    const label = it.alias || it.label || '항목';
    const confirmMsg = `"${label}" 을(를) 주소록에서 삭제할까요?`;
    if (Platform.OS === 'web') {
      // 웹에선 Alert.alert 가 confirm 이라 OK 만 누르면 삭제 — 단순화.
      // 자체 confirm
      if (typeof window !== 'undefined' && window.confirm) {
        if (!window.confirm(confirmMsg)) return;
        deleteAddress(it.key);
      } else {
        deleteAddress(it.key);
      }
    } else {
      Alert.alert('삭제', confirmMsg, [
        { text: '취소', style: 'cancel' },
        { text: '삭제', style: 'destructive', onPress: () => deleteAddress(it.key) },
      ]);
    }
  };

  return (
    <View style={styles.container}>
      {/* ── 상단 툴바 ────────────────────────────────────── */}
      <View style={[styles.toolbar, isNarrow && styles.toolbarNarrow]}>
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="주소 · 별칭 · 전화 검색"
            placeholderTextColor="#9ca3af"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
              <Text style={styles.clearBtn}>×</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.toolbarBtns}>
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary]}
            onPress={() => setAddingNew((v) => !v)}
          >
            <Text style={styles.btnPrimaryText}>{addingNew ? '입력 취소' : '+ 새 주소'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnSecondary]}
            onPress={() => setShowImport(true)}
          >
            <Text style={styles.btnSecondaryText}>📥 임포트</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── 상태 표시줄 ──────────────────────────────────── */}
      <View style={styles.statusBar}>
        <Text style={styles.statusText}>
          전체 <Text style={styles.statusNum}>{totalCount}</Text>건
          {pendingCount > 0 && (
            <>
              {'  ·  '}
              <Text style={styles.statusPending}>
                주소 미입력 {pendingCount}건
              </Text>
            </>
          )}
          {!storeCoord && (
            <>
              {'  ·  '}
              <Text style={styles.statusWarn}>매장 좌표 미설정 → 거리 계산 OFF</Text>
            </>
          )}
          {!geoOk && (
            <>
              {'  ·  '}
              <Text style={styles.statusWarn}>카카오 KEY 미설정 → 좌표 변환 OFF</Text>
            </>
          )}
          {geoOk && storeCoord && (
            <>
              {'  ·  '}
              <Text style={styles.statusHint}>🚗 카카오 모빌리티 도로 실거리</Text>
            </>
          )}
        </Text>

        <View style={styles.autoRow}>
          <Text style={styles.autoLabel}>자동 기억</Text>
          <Switch
            value={!!addressBook.autoRemember}
            onValueChange={setAutoRemember}
            trackColor={{ true: '#2563eb', false: '#d1d5db' }}
            thumbColor="#fff"
          />
        </View>
      </View>

      {/* ── 정렬 칩 ──────────────────────────────────────── */}
      <View style={styles.sortBar}>
        <Text style={styles.sortLabel}>정렬:</Text>
        {SORT_MODES.map((m) => {
          const active = sortMode === m.key;
          return (
            <TouchableOpacity
              key={m.key}
              style={[styles.sortChip, active && styles.sortChipActive]}
              onPress={() => setSortMode(m.key)}
            >
              <Text style={[styles.sortChipText, active && styles.sortChipTextActive]}>
                {m.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── 신규 추가 폼 ─────────────────────────────────── */}
      {addingNew && (
        <View style={styles.addBox}>
          <View style={styles.addRow}>
            <Text style={styles.fieldLabel}>주소</Text>
            <TextInput
              style={styles.addInput}
              value={newLabel}
              onChangeText={setNewLabel}
              placeholder="예) 부산 사하구 사하로 47"
              placeholderTextColor="#9ca3af"
              maxLength={100}
              autoFocus
            />
          </View>
          <View style={styles.addRow}>
            <Text style={styles.fieldLabel}>별칭</Text>
            <TextInput
              style={styles.addInput}
              value={newAlias}
              onChangeText={setNewAlias}
              placeholder="예) 김사장 · 동원카센터 (선택)"
              placeholderTextColor="#9ca3af"
              maxLength={20}
            />
          </View>
          <View style={styles.addRow}>
            <Text style={styles.fieldLabel}>전화</Text>
            <TextInput
              style={styles.addInput}
              value={newPhone}
              onChangeText={setNewPhone}
              placeholder="예) 010-1234-5678 (선택)"
              placeholderTextColor="#9ca3af"
              keyboardType="phone-pad"
              maxLength={14}
            />
          </View>
          <View style={styles.addRow}>
            <Text style={styles.fieldLabel}>단골요청</Text>
            <TextInput
              style={styles.addInput}
              value={newCustomerRequest}
              onChangeText={setNewCustomerRequest}
              placeholder="예) 다진고추, 김치많이 (주방·라이더 자동 노출)"
              placeholderTextColor="#9ca3af"
              maxLength={100}
            />
          </View>
          <View style={styles.addActions}>
            <TouchableOpacity style={styles.addConfirmBtn} onPress={confirmAdd}>
              <Text style={styles.addConfirmText}>등록</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.addCancelBtn} onPress={cancelAdd}>
              <Text style={styles.addCancelText}>취소</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── 행 목록 ──────────────────────────────────────── */}
      {items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            {query ? '검색 결과가 없습니다' : '저장된 주소가 없습니다'}
          </Text>
          <Text style={styles.emptyHint}>
            {query
              ? '검색어를 바꿔보거나 + 새 주소 로 직접 등록하세요'
              : '+ 새 주소 또는 📥 임포트 로 시작'}
          </Text>
        </View>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {items.map((it) => {
            const isEditing = editingKey === it.key;
            const distText =
              typeof it.drivingM === 'number' ? formatDrivingDistance(it.drivingM) : null;
            const durText =
              typeof it.drivingDurationSec === 'number'
                ? formatDuration(it.drivingDurationSec)
                : null;
            const distLoading =
              !distText &&
              storeCoord &&
              typeof it.lat === 'number' &&
              typeof it.lng === 'number';

            if (isEditing) {
              return (
                <View key={it.key} style={[styles.row, styles.rowEditing]}>
                  <View style={styles.editBox}>
                    <Text style={styles.editHeader}>
                      {it.pendingAddress
                        ? `📌 ${it.alias || '키워드'} — 주소 채우기`
                        : `편집: ${it.alias || it.label}`}
                    </Text>
                    <View style={styles.addRow}>
                      <Text style={styles.fieldLabel}>주소</Text>
                      <TextInput
                        style={styles.addInput}
                        value={editLabelText}
                        onChangeText={setEditLabelText}
                        placeholder="예) 부산 사하구 사하로 47"
                        placeholderTextColor="#9ca3af"
                        maxLength={100}
                        autoFocus
                      />
                    </View>
                    <View style={styles.addRow}>
                      <Text style={styles.fieldLabel}>별칭</Text>
                      <TextInput
                        style={styles.addInput}
                        value={editAlias}
                        onChangeText={setEditAlias}
                        placeholder="예) 김사장"
                        placeholderTextColor="#9ca3af"
                        maxLength={20}
                      />
                    </View>
                    <View style={styles.addRow}>
                      <Text style={styles.fieldLabel}>전화</Text>
                      <TextInput
                        style={styles.addInput}
                        value={editPhone}
                        onChangeText={setEditPhone}
                        placeholder="예) 010-1234-5678"
                        placeholderTextColor="#9ca3af"
                        keyboardType="phone-pad"
                        maxLength={14}
                      />
                    </View>
                    <View style={styles.addRow}>
                      <Text style={styles.fieldLabel}>단골요청</Text>
                      <TextInput
                        style={styles.addInput}
                        value={editCustomerRequest}
                        onChangeText={setEditCustomerRequest}
                        placeholder="예) 다진고추, 김치많이"
                        placeholderTextColor="#9ca3af"
                        maxLength={100}
                      />
                    </View>
                    <View style={styles.addActions}>
                      <TouchableOpacity style={styles.addConfirmBtn} onPress={confirmEdit}>
                        <Text style={styles.addConfirmText}>저장</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.addCancelBtn} onPress={cancelEdit}>
                        <Text style={styles.addCancelText}>취소</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            }

            return (
              <View
                key={it.key}
                style={[styles.row, it.pendingAddress && styles.rowPending]}
              >
                <View style={styles.rowMain}>
                  <View style={styles.rowTitleLine}>
                    {it.alias ? (
                      <Text style={styles.rowAlias} numberOfLines={1}>
                        👤 {it.alias}
                      </Text>
                    ) : null}
                    {it.pendingAddress && (
                      <View style={styles.pendingBadge}>
                        <Text style={styles.pendingBadgeText}>주소 미입력</Text>
                      </View>
                    )}
                  </View>
                  <Text
                    style={[
                      styles.rowLabel,
                      it.pendingAddress && styles.rowLabelPending,
                    ]}
                    numberOfLines={2}
                  >
                    {it.label}
                  </Text>
                  <View style={styles.rowMeta}>
                    {it.phone && (
                      <Text style={styles.rowPhone}>
                        ☎ {formatPhoneDisplay(it.phone)}
                      </Text>
                    )}
                    {it.count > 0 && (
                      <Text style={styles.rowCount}>×{it.count}회</Text>
                    )}
                    {distText ? (
                      <Text style={styles.rowDist}>
                        🚗 {distText}
                        {durText ? ` · ${durText}` : ''}
                      </Text>
                    ) : distLoading ? (
                      <Text style={styles.rowDistLoading}>🚗 계산 중…</Text>
                    ) : null}
                  </View>
                  {it.customerRequest ? (
                    <Text style={styles.rowRequest} numberOfLines={2}>
                      🌟 단골요청: {it.customerRequest}
                    </Text>
                  ) : null}
                </View>

                <View style={styles.rowActions}>
                  <TouchableOpacity
                    style={styles.iconBtn}
                    onPress={() => openEdit(it)}
                    hitSlop={6}
                  >
                    <Text style={styles.iconText}>✏️</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.iconBtn}
                    onPress={() => pinAddress(it.key, !it.pinned)}
                    hitSlop={6}
                  >
                    <Text
                      style={[styles.iconText, it.pinned && styles.iconTextActive]}
                    >
                      {it.pinned ? '📌' : '📍'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.iconBtn}
                    onPress={() => handleDelete(it)}
                    hitSlop={6}
                  >
                    <Text style={styles.deleteText}>🗑</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* ── 임포트 모달 ──────────────────────────────────── */}
      {showImport && (
        <View style={styles.importOverlay} pointerEvents="auto">
          <Pressable style={styles.importBackdrop} onPress={() => setShowImport(false)}>
            <Pressable style={styles.importSheet} onPress={() => {}}>
              <Text style={styles.importTitle}>주소록 임포트</Text>
              <Text style={styles.importDesc}>
                4월 말 카카오 로컬 API 검색 결과 ({SEED_BUSINESS_ADDRESSES.length}건).
                기존 항목(주소 또는 전화 일치) 은 자동 스킵.
              </Text>
              <View style={styles.importOptions}>
                <TouchableOpacity
                  style={[styles.importBtn, styles.importBtnPrimary]}
                  onPress={() => handleImport('foundOnly')}
                >
                  <Text style={styles.importBtnPrimaryText}>
                    확인된 주소 56건만 추가
                  </Text>
                  <Text style={styles.importBtnPrimarySub}>
                    상호·주소·전화 다 검증됨
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.importBtn, styles.importBtnSecondary]}
                  onPress={() => handleImport('all')}
                >
                  <Text style={styles.importBtnSecondaryText}>
                    전체 75건 추가 (미확인 19건은 키워드만)
                  </Text>
                  <Text style={styles.importBtnSecondarySub}>
                    미확인 19건은 "주소 미입력" 상태로 등록 — 직원이 채움
                  </Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={styles.importClose} onPress={() => setShowImport(false)}>
                <Text style={styles.importCloseText}>닫기</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function formatPhoneDisplay(digits) {
  const d = (digits || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('010')) {
    return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  }
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
  return d;
}

function makeStyles(scale = 1) {
  const fp = (n) => Math.round(n * scale);
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff' },

    toolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: '#e5e7eb',
      backgroundColor: '#f9fafb',
    },
    toolbarNarrow: { flexDirection: 'column', alignItems: 'stretch', gap: 6 },
    searchBox: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#fff',
      borderWidth: 1,
      borderColor: '#d1d5db',
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 4,
      gap: 6,
      minWidth: 200,
    },
    searchIcon: { fontSize: fp(14) },
    searchInput: {
      flex: 1,
      fontSize: fp(14),
      color: '#111827',
      paddingVertical: 6,
      outlineStyle: 'none',
    },
    clearBtn: {
      fontSize: fp(18),
      fontWeight: '700',
      color: '#9ca3af',
      paddingHorizontal: 4,
    },

    toolbarBtns: { flexDirection: 'row', gap: 6 },
    btn: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
    },
    btnPrimary: { backgroundColor: '#2563eb' },
    btnPrimaryText: { color: '#fff', fontSize: fp(13), fontWeight: '800' },
    btnSecondary: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d1d5db' },
    btnSecondaryText: { color: '#374151', fontSize: fp(13), fontWeight: '700' },

    statusBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderBottomWidth: 1,
      borderBottomColor: '#f3f4f6',
      backgroundColor: '#fff',
      gap: 8,
      flexWrap: 'wrap',
    },
    statusText: { fontSize: fp(12), color: '#6b7280' },
    statusNum: { color: '#111827', fontWeight: '800' },
    statusPending: { color: '#d97706', fontWeight: '800' },
    statusWarn: { color: '#dc2626', fontWeight: '700' },
    statusHint: { color: '#0891b2', fontWeight: '700' },
    autoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    autoLabel: { fontSize: fp(12), color: '#374151', fontWeight: '700' },

    sortBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: '#f3f4f6',
      flexWrap: 'wrap',
    },
    sortLabel: { fontSize: fp(11), color: '#6b7280', fontWeight: '700' },
    sortChip: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 12,
      backgroundColor: '#f3f4f6',
      borderWidth: 1,
      borderColor: '#e5e7eb',
    },
    sortChipActive: { backgroundColor: '#dbeafe', borderColor: '#2563eb' },
    sortChipText: { fontSize: fp(11), color: '#6b7280', fontWeight: '700' },
    sortChipTextActive: { color: '#1d4ed8' },

    addBox: {
      padding: 12,
      backgroundColor: '#f0fdf4',
      borderBottomWidth: 1,
      borderBottomColor: '#bbf7d0',
      gap: 6,
    },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    fieldLabel: {
      fontSize: fp(12),
      color: '#374151',
      fontWeight: '700',
      width: 44,
    },
    addInput: {
      flex: 1,
      fontSize: fp(13),
      color: '#111827',
      backgroundColor: '#fff',
      borderWidth: 1,
      borderColor: '#d1d5db',
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 6,
      outlineStyle: 'none',
    },
    addActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 8,
      marginTop: 2,
    },
    addConfirmBtn: {
      backgroundColor: '#16a34a',
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: 6,
    },
    addConfirmText: { color: '#fff', fontSize: fp(12), fontWeight: '800' },
    addCancelBtn: { paddingHorizontal: 10, paddingVertical: 6 },
    addCancelText: { color: '#9ca3af', fontSize: fp(12), fontWeight: '700' },

    empty: { padding: 40, alignItems: 'center', gap: 8 },
    emptyText: { fontSize: fp(14), color: '#6b7280', fontWeight: '700' },
    emptyHint: { fontSize: fp(12), color: '#9ca3af' },

    list: { flex: 1 },
    listContent: { paddingBottom: 24 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: '#f3f4f6',
      gap: 6,
    },
    rowPending: {
      backgroundColor: '#fffbeb',
      borderLeftWidth: 3,
      borderLeftColor: '#f59e0b',
    },
    rowEditing: {
      backgroundColor: '#eff6ff',
      borderLeftWidth: 3,
      borderLeftColor: '#2563eb',
    },
    rowMain: { flex: 1, minWidth: 0, gap: 2 },
    rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    rowAlias: {
      fontSize: fp(13),
      fontWeight: '800',
      color: '#2563eb',
    },
    pendingBadge: {
      backgroundColor: '#f59e0b',
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: 4,
    },
    pendingBadgeText: { fontSize: fp(9), color: '#fff', fontWeight: '900' },
    rowLabel: { fontSize: fp(13), fontWeight: '700', color: '#111827' },
    rowLabelPending: { color: '#a16207', fontStyle: 'italic' },
    rowMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 2,
      flexWrap: 'wrap',
    },
    rowPhone: { fontSize: fp(11), color: '#059669', fontWeight: '600' },
    rowCount: { fontSize: fp(11), color: '#dc2626', fontWeight: '700' },
    rowDist: { fontSize: fp(11), color: '#2563eb', fontWeight: '700' },
    rowDistLoading: { fontSize: fp(11), color: '#9ca3af', fontWeight: '600', fontStyle: 'italic' },
    rowRequest: {
      fontSize: fp(12),
      color: '#9a3412',
      fontWeight: '800',
      backgroundColor: '#fff7ed',
      paddingHorizontal: 6,
      paddingVertical: 3,
      borderRadius: 4,
      marginTop: 4,
      alignSelf: 'flex-start',
    },
    rowActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    iconBtn: { paddingHorizontal: 8, paddingVertical: 6 },
    iconText: { fontSize: fp(16), opacity: 0.5 },
    iconTextActive: { opacity: 1 },
    deleteText: { fontSize: fp(14), opacity: 0.6 },

    editBox: { flex: 1, gap: 6 },
    editHeader: {
      fontSize: fp(12),
      color: '#1d4ed8',
      fontWeight: '800',
      marginBottom: 4,
    },

    importOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 9999,
      elevation: 9999,
    },
    importBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 16,
    },
    importSheet: {
      width: '100%',
      maxWidth: 480,
      backgroundColor: '#fff',
      borderRadius: 12,
      padding: 20,
      gap: 12,
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },
    importTitle: { fontSize: fp(16), fontWeight: '900', color: '#111827' },
    importDesc: { fontSize: fp(12), color: '#6b7280', lineHeight: 18 },
    importOptions: { gap: 8 },
    importBtn: {
      borderRadius: 8,
      padding: 12,
      gap: 4,
    },
    importBtnPrimary: { backgroundColor: '#2563eb' },
    importBtnPrimaryText: { color: '#fff', fontSize: fp(14), fontWeight: '800' },
    importBtnPrimarySub: { color: 'rgba(255,255,255,0.8)', fontSize: fp(11) },
    importBtnSecondary: { backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: '#d1d5db' },
    importBtnSecondaryText: { color: '#111827', fontSize: fp(14), fontWeight: '800' },
    importBtnSecondarySub: { color: '#6b7280', fontSize: fp(11) },
    importClose: {
      alignSelf: 'flex-end',
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    importCloseText: { color: '#6b7280', fontSize: fp(13), fontWeight: '700' },
  });
}
