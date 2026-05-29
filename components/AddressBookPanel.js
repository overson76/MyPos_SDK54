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
  Keyboard,
  KeyboardAvoidingView,
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
  isDrivingMSane,
  distanceKm,
} from '../utils/geocode';
import { importAddresses, SEED_BUSINESS_ADDRESSES } from '../utils/seedAddresses';
import { downloadJson, pickJsonFile } from '../utils/jsonBackup';

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
  // 2026-05-23 (2부 후속): 편집 진입 시 그 row 가 키보드 위쪽 영역에 보이도록
  // 자동 점프. 사장님 보고 "폰에서 키보드에 가려져 열람/기입 힘들다".
  const listRef = useRef(null);
  const rowOffsetsRef = useRef({});
  // 2026-05-23 (1.0.52): 한 배달지에 여러 가족·동료가 다른 번호로 주문 거는 케이스
  // (사장님 보고). editPhones 배열로 제한 없이 추가 가능. 빈 칸은 confirmEdit 에서
  // 자동 필터. 최소 1칸은 항상 노출. "+ 전화번호 추가" 버튼으로 새 칸 추가.
  const [editPhones, setEditPhones] = useState(['']);
  const [editCustomerRequest, setEditCustomerRequest] = useState('');
  const [addingNew, setAddingNew] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newAlias, setNewAlias] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newCustomerRequest, setNewCustomerRequest] = useState('');
  const [showImport, setShowImport] = useState(false);
  // 2026-05-29: 사장님 신고 "주소록 검색 시 결과 목록이 키보드에 다 가려짐".
  //   검색칸은 상단 toolbar 라 보이지만, 검색 결과 entry 들이 키보드 아래 깔림.
  //   landscape iPhone 에서 KeyboardAvoidingView(padding) 가 키보드 높이를 부정확
  //   하게 측정하는 알려진 이슈 → 리스트가 안 줄어듦. 키보드 높이를 직접 구독해서
  //   리스트 ScrollView 하단에 그만큼 paddingBottom → 스크롤로 모든 결과 키보드 위 확인.
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const onShow = (e) => setKbHeight(e?.endCoordinates?.height || 0);
    const onHide = () => setKbHeight(0);
    const s = Keyboard.addListener('keyboardDidShow', onShow);
    const h = Keyboard.addListener('keyboardDidHide', onHide);
    return () => {
      s.remove();
      h.remove();
    };
  }, []);
  // 백업 / 복원 핸들러 — 2026-05-16 추가.
  // Export: 현재 addressBook.entries 전체를 JSON 다운로드 (사장님 컴퓨터에 저장).
  // Import: 파일 선택 → 병합(default) 또는 교체(주의). 사장님 의도 — 데이터 안전 보장.
  const handleExportBackup = () => {
    const entries = addressBook?.entries || {};
    const count = Object.keys(entries).length;
    if (count === 0) {
      Alert.alert('백업 안내', '저장된 주소록이 없습니다.');
      return;
    }
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const filename = `mypos-addressbook-${dateStr}.json`;
    const payload = {
      version: 1,
      type: 'mypos-addressbook',
      exportedAt: now.toISOString(),
      count,
      entries,
    };
    downloadJson(payload, filename);
  };

  const handleImportBackup = async () => {
    let parsed;
    try {
      parsed = await pickJsonFile();
    } catch (e) {
      Alert.alert('가져오기 실패', String(e?.message || e));
      return;
    }
    if (!parsed) return; // 취소
    // 형식 검증 — version 또는 type 또는 entries object 셋 중 하나는 있어야.
    const incoming = parsed?.entries && typeof parsed.entries === 'object'
      ? parsed.entries
      : null;
    if (!incoming) {
      Alert.alert('가져오기 실패', 'JSON 형식이 다릅니다. {entries: {...}} 형태여야 합니다.');
      return;
    }
    const incomingCount = Object.keys(incoming).length;
    if (incomingCount === 0) {
      Alert.alert('가져오기 안내', '파일에 주소록 entry 가 없습니다.');
      return;
    }
    const currentCount = Object.keys(addressBook?.entries || {}).length;
    // 병합/교체 선택 — Alert.alert 3버튼 (취소 / 병합 / 교체)
    const askMode = (cb) => {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const choice = window.prompt(
          `📥 백업 가져오기\n\n현재 ${currentCount}건 · 가져올 파일 ${incomingCount}건\n\n[병합] = 기존 + 새 (중복 key 는 새 파일 우선)\n[교체] = 기존 전부 삭제 후 새 파일만 (위험)\n\n"merge" 또는 "replace" 입력 (취소는 빈 칸):`,
          'merge'
        );
        cb(choice === 'merge' || choice === 'replace' ? choice : null);
        return;
      }
      Alert.alert(
        '📥 백업 가져오기',
        `현재 ${currentCount}건 · 가져올 ${incomingCount}건`,
        [
          { text: '취소', style: 'cancel', onPress: () => cb(null) },
          { text: '병합', onPress: () => cb('merge') },
          { text: '교체 (위험)', style: 'destructive', onPress: () => cb('replace') },
        ]
      );
    };
    askMode((mode) => {
      if (!mode) return;
      setAddressBook((prev) => {
        const baseEntries = mode === 'replace' ? {} : (prev?.entries || {});
        return {
          ...prev,
          entries: { ...baseEntries, ...incoming },
        };
      });
      const finalCount =
        mode === 'replace'
          ? incomingCount
          : Object.keys({ ...(addressBook?.entries || {}), ...incoming }).length;
      Alert.alert(
        '✅ 복원 완료',
        `${mode === 'replace' ? '교체' : '병합'} 완료 — 주소록 ${finalCount}건`
      );
    });
  };

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
        // 2026-05-28: 카카오모빌리티 응답 sanity check — 직선거리 대비 5배 또는 50km
        // 초과면 reject. 사장님 신고 "엄마선지 300km" 같은 잘못된 좌표 매칭 방어.
        const straightKm = distanceKm(
          { lat: fromLat, lng: fromLng },
          { lat: entry.lat, lng: entry.lng }
        );
        if (!isDrivingMSane(result.distanceM, straightKm)) {
          failedRef.current.add(entry.key);
          if (typeof console !== 'undefined') {
            console.warn('[AddressBookPanel] drivingM 비정상 — reject', {
              key: entry.key,
              drivingM: result.distanceM,
              straightKm,
            });
          }
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
    // phones array (신) 우선 + 옛 phone 단일 fallback. 동적 입력란에 채움.
    // 비어있어도 항상 1칸 유지 — 사용자가 새 번호 입력할 자리.
    const phones = Array.isArray(it.phones)
      ? it.phones.filter(Boolean)
      : (it.phone ? [it.phone] : []);
    setEditPhones(phones.length > 0 ? phones.map(formatPhoneDisplay) : ['']);
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
      // phones array — 빈/중복 제외. 첫 phone 은 옛 phone 필드에도 sync.
      const phones = [];
      for (const raw of editPhones) {
        const d = String(raw || '').replace(/\D/g, '');
        if (!d) continue;
        if (phones.includes(d)) continue;
        phones.push(d);
      }
      const trimmedAlias = editAlias.trim();
      const trimmedRequest = (editCustomerRequest || '').trim().slice(0, 100);
      const updated = { ...candidate };
      if (trimmedAlias) updated.alias = trimmedAlias;
      else delete updated.alias;
      if (phones.length > 0) {
        updated.phone = phones[0];
        updated.phones = phones;
      } else {
        delete updated.phone;
        delete updated.phones;
      }
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

  // 2026-05-23 (2부 후속): 편집 진입 시 그 row 가 키보드 위로 보이도록 자동 점프.
  // 폰 가로(landscape) 키보드가 화면 50% 가까이 덮어 편집 form 안 보이는 문제 처방.
  useEffect(() => {
    if (!editingKey) return;
    const y = rowOffsetsRef.current[editingKey];
    if (!listRef.current || typeof y !== 'number') return;
    // 다음 tick 에 scrollTo — onLayout 가 새 (편집 모드) row 의 정확한 y 박을 시간 확보.
    const t = setTimeout(() => {
      try {
        listRef.current?.scrollTo?.({ y: Math.max(0, y - 8), animated: true });
      } catch (_) {}
    }, 50);
    return () => clearTimeout(t);
  }, [editingKey]);

  // 2026-05-25 사장님 보고 "주소록 채팅창(검색창) 진입 시 키보드 자동 활성화 → 스크롤 막힘".
  // iOS Safari 가 첫 input 자동 포커스 기억 + RN-Web 의 mount 시 자동 포커스 결합.
  // 처방: 컴포넌트 mount 시 Keyboard.dismiss() + 검색 input ref blur() 강제.
  const searchInputRef = useRef(null);
  useEffect(() => {
    const t = setTimeout(() => {
      try { Keyboard.dismiss(); } catch (_) {}
      try { searchInputRef.current?.blur?.(); } catch (_) {}
    }, 0);
    return () => clearTimeout(t);
  }, []);

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

  // 2026-05-25 사장님 보고 "별칭 검색 목록이 너무 찌그러져 사용 불가". 처방:
  // 편집/추가 진입 시 toolbar·statusBar·sortBar·list 모두 숨기고 *전용 화면* 으로
  // 전환 — 폼만 화면 가득. 저장/취소 시 일반 화면 복귀.
  const isFocused = !!editingKey || addingNew;
  const editingEntry = editingKey
    ? items.find((e) => e.key === editingKey)
    : null;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {!isFocused && (
      <>
      {/* ── 상단 툴바 ────────────────────────────────────── */}
      <View style={[styles.toolbar, isNarrow && styles.toolbarNarrow]}>
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            ref={searchInputRef}
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
            onPress={handleExportBackup}
            accessibilityLabel="현재 주소록을 JSON 파일로 백업 다운로드"
          >
            <Text style={styles.btnSecondaryText}>📤 백업</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnSecondary]}
            onPress={handleImportBackup}
            accessibilityLabel="JSON 백업 파일에서 주소록 복원"
          >
            <Text style={styles.btnSecondaryText}>📥 복원</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnSecondary]}
            onPress={() => setShowImport(true)}
          >
            <Text style={styles.btnSecondaryText}>📦 75개 시드</Text>
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

      </>
      )}

      {/* ── 신규 추가 폼 ─────────────────────────────────── */}
      {addingNew && (
        <ScrollView
          style={{ flexGrow: 1, minHeight: 200 }}
          contentContainerStyle={[styles.addBox, { paddingBottom: 200 }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
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
        </ScrollView>
      )}

      {/* ── 2026-05-25: 편집 전용 화면 — toolbar·list 모두 숨김 + 폼만 크게 ── */}
      {!!editingKey && editingEntry && (
        <ScrollView
          style={{ flexGrow: 1, minHeight: 200 }}
          contentContainerStyle={[styles.addBox, { paddingBottom: 200 }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <Text style={styles.editHeader}>
            {editingEntry.pendingAddress
              ? `📌 ${editingEntry.alias || '키워드'} — 주소 채우기`
              : `편집: ${editingEntry.alias || editingEntry.label}`}
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
          {editPhones.map((p, idx) => (
            <View key={`ph-${idx}`} style={styles.addRow}>
              <Text style={styles.fieldLabel}>{`전화 ${idx + 1}`}</Text>
              <TextInput
                style={styles.addInput}
                value={p}
                onChangeText={(v) =>
                  setEditPhones((prev) => {
                    const next = [...prev];
                    next[idx] = v;
                    return next;
                  })
                }
                placeholder={
                  idx === 0
                    ? '예) 010-1234-5678'
                    : '예) 051-200-1234 (선택)'
                }
                placeholderTextColor="#9ca3af"
                keyboardType="phone-pad"
                maxLength={14}
              />
              {editPhones.length > 1 && (
                <TouchableOpacity
                  style={styles.phoneRemoveBtn}
                  onPress={() =>
                    setEditPhones((prev) =>
                      prev.filter((_, i) => i !== idx)
                    )
                  }
                  accessibilityLabel={`전화 ${idx + 1} 삭제`}
                >
                  <Text style={styles.phoneRemoveText}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
          <View style={styles.addRow}>
            <Text style={styles.fieldLabel}> </Text>
            <TouchableOpacity
              style={styles.phoneAddBtn}
              onPress={() => setEditPhones((prev) => [...prev, ''])}
            >
              <Text style={styles.phoneAddText}>+ 전화번호 추가</Text>
            </TouchableOpacity>
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
        </ScrollView>
      )}

      {!isFocused && (
      <>
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
        <ScrollView
          ref={listRef}
          style={styles.list}
          // 2026-05-28 (2부): 인라인 row 편집 시 마지막 entry 키보드 아래 깔림 처방.
          // 2026-05-29: 검색 시 결과 목록 가림 처방 — 키보드 높이만큼 하단 여백 추가
          //   → 스크롤로 모든 결과 키보드 위 확인. kbHeight 가 인라인 편집(300)보다
          //   크면 그 값 우선. 키보드 없으면 기본 listContent(24).
          contentContainerStyle={[
            styles.listContent,
            kbHeight > 0 && { paddingBottom: kbHeight + 24 },
            editingKey && kbHeight === 0 && { paddingBottom: 300 },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {items.map((it) => {
            const isEditing = editingKey === it.key;
            // 2026-05-28: 잠복 비정상 drivingM (옛 잘못된 좌표 매칭) 은 화면에서 차단.
            // 사장님 신고 "엄마선지 300km" 사례. 새 저장은 위 effect 가드가 막지만 이미
            // Firestore 에 박힌 entry 는 사장님이 직접 편집 전까지 그대로 → 화면 가드 필수.
            const straightKmForView =
              storeCoord && typeof it.lat === 'number' && typeof it.lng === 'number'
                ? distanceKm(storeCoord, { lat: it.lat, lng: it.lng })
                : null;
            const drivingOk = isDrivingMSane(it.drivingM, straightKmForView);
            const distText = drivingOk ? formatDrivingDistance(it.drivingM) : null;
            const distInvalid = !drivingOk && typeof it.drivingM === 'number';
            const durText =
              drivingOk && typeof it.drivingDurationSec === 'number'
                ? formatDuration(it.drivingDurationSec)
                : null;
            const distLoading =
              !distText &&
              !distInvalid &&
              storeCoord &&
              typeof it.lat === 'number' &&
              typeof it.lng === 'number';

            if (isEditing) {
              return (
                <View
                  key={it.key}
                  style={[styles.row, styles.rowEditing]}
                  onLayout={(e) => {
                    rowOffsetsRef.current[it.key] = e.nativeEvent.layout.y;
                  }}
                >
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
                    {editPhones.map((p, idx) => (
                      <View key={`ph-${idx}`} style={styles.addRow}>
                        <Text style={styles.fieldLabel}>
                          {`전화 ${idx + 1}`}
                        </Text>
                        <TextInput
                          style={styles.addInput}
                          value={p}
                          onChangeText={(v) =>
                            setEditPhones((prev) => {
                              const next = [...prev];
                              next[idx] = v;
                              return next;
                            })
                          }
                          placeholder={
                            idx === 0
                              ? '예) 010-1234-5678'
                              : '예) 051-200-1234 (선택)'
                          }
                          placeholderTextColor="#9ca3af"
                          keyboardType="phone-pad"
                          maxLength={14}
                        />
                        {editPhones.length > 1 && (
                          <TouchableOpacity
                            style={styles.phoneRemoveBtn}
                            onPress={() =>
                              setEditPhones((prev) =>
                                prev.filter((_, i) => i !== idx)
                              )
                            }
                            accessibilityLabel={`전화 ${idx + 1} 삭제`}
                          >
                            <Text style={styles.phoneRemoveText}>✕</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    ))}
                    <View style={styles.addRow}>
                      <Text style={styles.fieldLabel}> </Text>
                      <TouchableOpacity
                        style={styles.phoneAddBtn}
                        onPress={() =>
                          setEditPhones((prev) => [...prev, ''])
                        }
                      >
                        <Text style={styles.phoneAddText}>+ 전화번호 추가</Text>
                      </TouchableOpacity>
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
                onLayout={(e) => {
                  rowOffsetsRef.current[it.key] = e.nativeEvent.layout.y;
                }}
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
                    {(() => {
                      // 2026-05-16: phones array 우선 + 옛 phone fallback 모두 표시.
                      // 휴대폰 + 일반전화 두 개 있으면 "/" 로 구분해 한 줄.
                      const allPhones = Array.isArray(it.phones) && it.phones.length > 0
                        ? it.phones
                        : (it.phone ? [it.phone] : []);
                      if (allPhones.length === 0) return null;
                      const text = allPhones.map((p) => formatPhoneDisplay(p)).join(' / ');
                      return <Text style={styles.rowPhone}>☎ {text}</Text>;
                    })()}
                    {it.count > 0 && (
                      <Text style={styles.rowCount}>×{it.count}회</Text>
                    )}
                    {distText ? (
                      <Text style={styles.rowDist}>
                        🚗 {distText}
                        {durText ? ` · ${durText}` : ''}
                      </Text>
                    ) : distInvalid ? (
                      <Text style={styles.rowDistInvalid}>
                        ⚠️ 거리 오류 — 주소 재검색 필요
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
      </>
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
    </KeyboardAvoidingView>
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
      // 2026-05-25 (3차): 검색칸 보강 후 좁은 환경에서 백업 버튼들 가려짐 — wrap 보장.
      flexWrap: 'wrap',
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
      paddingHorizontal: 12,
      paddingVertical: 4,
      gap: 8,
      minWidth: 200,
      // 2026-05-25 (3차): minHeight 52→44 — 사장님 보고 "백업 가려짐" 으로 적당히 줄임
      minHeight: 44,
    },
    searchIcon: { fontSize: fp(14) },
    searchInput: {
      flex: 1,
      fontSize: fp(16),
      color: '#111827',
      // 2026-05-25 (3차): paddingV 14→10 + minHeight 48→40 — 적당히. 부모 toolbar
      // 전체 높이 줄여 백업 버튼들이 같이 가려지지 않게.
      paddingVertical: 10,
      minHeight: 40,
      outlineStyle: 'none',
    },
    clearBtn: {
      fontSize: fp(18),
      fontWeight: '700',
      color: '#9ca3af',
      paddingHorizontal: 4,
    },

    toolbarBtns: {
      flexDirection: 'row',
      gap: 6,
      // 좁은 화면에서 검색박스와 버튼들 함께 wrap 되도록 + 버튼 자체는 압축 X.
      flexWrap: 'wrap',
      flexShrink: 0,
    },
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

    // 1.0.52: 다중 전화번호 입력 — 추가/삭제 버튼.
    phoneAddBtn: {
      alignSelf: 'flex-start',
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: '#2563eb',
      borderStyle: 'dashed',
      backgroundColor: '#eff6ff',
    },
    phoneAddText: {
      fontSize: fp(11),
      color: '#2563eb',
      fontWeight: '700',
    },
    phoneRemoveBtn: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 4,
      backgroundColor: '#fee2e2',
    },
    phoneRemoveText: {
      fontSize: fp(12),
      color: '#dc2626',
      fontWeight: '900',
    },

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
    rowDistInvalid: { fontSize: fp(11), color: '#dc2626', fontWeight: '700' },
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
