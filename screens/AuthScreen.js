// 매장 가입/참여 게이트 화면.
// StoreContext.state 가 UNJOINED 또는 PENDING_APPROVAL 일 때만 표시됨.
// 모드:
//   HOME           — 두 큰 옵션 카드 (대표/직원)
//   CREATE         — 새 매장: 상호 + 대표 이름 입력
//   JOIN_INPUT     — 매장 참여: 8자리 매장 코드 입력
//   JOIN_CONFIRM   — 매장 미리보기 + 본인 이름 입력 → 가입 요청
//   CREATED        — 매장 생성 직후: 매장 코드 큰 글씨로 표시 (직원에게 전달용)
//   (state === PENDING_APPROVAL 시 별도 대기 화면)

import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStore, STORE_STATE } from '../utils/StoreContext';
import {
  createStore,
  findStoreByCode,
  requestJoin,
  cancelJoinRequest,
  formatStoreCode,
  normalizeStoreCode,
} from '../utils/storeOps';
import { migrateLocalToCloud } from '../utils/migrateLocalToCloud';

const MODE = {
  HOME: 'home',
  CREATE: 'create',
  JOIN_INPUT: 'joinInput',
  JOIN_CONFIRM: 'joinConfirm',
  CREATED: 'created',
  MIGRATING: 'migrating',
};

export default function AuthScreen() {
  const { state, storeInfo, markJoined, markPending, cancelPending } = useStore();
  const [mode, setMode] = useState(MODE.HOME);
  const [busy, setBusy] = useState(false);

  // 새 매장 입력
  const [storeName, setStoreName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [createdResult, setCreatedResult] = useState(null);

  // 매장 참여 입력
  const [code, setCode] = useState('');
  const [staffName, setStaffName] = useState('');
  const [previewStore, setPreviewStore] = useState(null);

  // ── 가입 승인 대기 화면 (별도 분기) ──────────────────────────
  if (state === STORE_STATE.PENDING_APPROVAL) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
        <View style={styles.center}>
          <Text style={styles.brand}>승인 대기 중</Text>
          <Text style={styles.tagline}>대표가 승인하면 자동으로 시작됩니다</Text>
          <Text style={styles.pendingName}>{storeInfo?.displayName || ''}</Text>
          <ActivityIndicator size="large" color="#2563eb" style={{ marginTop: 24 }} />
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={async () => {
              try {
                if (storeInfo?.storeId) {
                  await cancelJoinRequest({ storeId: storeInfo.storeId });
                }
              } catch (e) {}
              cancelPending();
              setMode(MODE.HOME);
            }}
          >
            <Text style={styles.cancelBtnText}>요청 취소</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── 액션 핸들러 ──────────────────────────────────────────────
  const handleCreate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await createStore({ name: storeName, displayName: ownerName });
      setCreatedResult(result);
      setMode(MODE.CREATED);
    } catch (e) {
      Alert.alert('오류', e.message || '매장 생성에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleFindStore = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const store = await findStoreByCode(code);
      setPreviewStore(store);
      setMode(MODE.JOIN_CONFIRM);
    } catch (e) {
      Alert.alert('매장 없음', e.message || '매장을 찾을 수 없습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleRequestJoin = async () => {
    if (busy || !previewStore) return;
    setBusy(true);
    try {
      await requestJoin({ storeId: previewStore.storeId, displayName: staffName });
      markPending({ storeId: previewStore.storeId, displayName: staffName });
    } catch (e) {
      Alert.alert('오류', e.message || '가입 요청에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  // ── 메인 분기 ────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {mode === MODE.HOME && (
            <HomeView
              onCreate={() => setMode(MODE.CREATE)}
              onJoin={() => setMode(MODE.JOIN_INPUT)}
            />
          )}
          {mode === MODE.CREATE && (
            <CreateView
              storeName={storeName}
              setStoreName={setStoreName}
              ownerName={ownerName}
              setOwnerName={setOwnerName}
              busy={busy}
              onSubmit={handleCreate}
              onBack={() => setMode(MODE.HOME)}
            />
          )}
          {mode === MODE.JOIN_INPUT && (
            <JoinInputView
              code={code}
              setCode={setCode}
              busy={busy}
              onSubmit={handleFindStore}
              onBack={() => setMode(MODE.HOME)}
            />
          )}
          {mode === MODE.JOIN_CONFIRM && previewStore && (
            <JoinConfirmView
              previewStore={previewStore}
              code={code}
              staffName={staffName}
              setStaffName={setStaffName}
              busy={busy}
              onSubmit={handleRequestJoin}
              onBack={() => setMode(MODE.JOIN_INPUT)}
            />
          )}
          {mode === MODE.CREATED && createdResult && (
            <CreatedView result={createdResult} onContinue={() => setMode(MODE.MIGRATING)} />
          )}
          {mode === MODE.MIGRATING && createdResult && (
            <MigratingView result={createdResult} onDone={() => markJoined(createdResult)} />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── 홈: 두 옵션 카드 ────────────────────────────────────────────
function HomeView({ onCreate, onJoin }) {
  return (
    <View style={styles.center}>
      <Text style={styles.brand}>MyPos</Text>
      <Text style={styles.tagline}>매장을 시작하거나 참여하세요</Text>

      <View style={styles.optionRow}>
        <TouchableOpacity style={styles.primaryCard} onPress={onCreate} activeOpacity={0.85}>
          <Text style={styles.primaryCardTitle}>새 매장 만들기</Text>
          <Text style={styles.primaryCardSub}>대표용</Text>
          <Text style={styles.primaryCardDetail}>
            상호 입력 → 매장 코드 발급{'\n'}직원에게 코드 전달
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryCard} onPress={onJoin} activeOpacity={0.85}>
          <Text style={styles.secondaryCardTitle}>매장 참여</Text>
          <Text style={styles.secondaryCardSub}>직원용</Text>
          <Text style={styles.secondaryCardDetail}>
            대표가 알려준 매장 코드로{'\n'}가입 요청 보내기
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── 새 매장 만들기 폼 ────────────────────────────────────────────
function CreateView({
  storeName,
  setStoreName,
  ownerName,
  setOwnerName,
  busy,
  onSubmit,
  onBack,
}) {
  const canSubmit = storeName.trim() && ownerName.trim() && !busy;
  return (
    <View style={styles.formCenter}>
      <BackBtn onPress={onBack} />
      <Text style={styles.formTitle}>새 매장 만들기</Text>
      <Text style={styles.formSub}>매장 정보를 입력하세요</Text>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>상호</Text>
        <TextInput
          style={styles.input}
          value={storeName}
          onChangeText={setStoreName}
          placeholder="예: 행복 분식"
          placeholderTextColor="#9ca3af"
          maxLength={30}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>대표 이름</Text>
        <TextInput
          style={styles.input}
          value={ownerName}
          onChangeText={setOwnerName}
          placeholder="예: 홍길동"
          placeholderTextColor="#9ca3af"
          maxLength={20}
        />
      </View>
      <TouchableOpacity
        style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
        onPress={onSubmit}
        disabled={!canSubmit}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitBtnText}>매장 만들기</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

// ── 매장 코드 입력 ───────────────────────────────────────────────
function JoinInputView({ code, setCode, busy, onSubmit, onBack }) {
  const normalized = normalizeStoreCode(code);
  const canSubmit = normalized.length === 8 && !busy;
  return (
    <View style={styles.formCenter}>
      <BackBtn onPress={onBack} />
      <Text style={styles.formTitle}>매장 참여</Text>
      <Text style={styles.formSub}>대표가 알려준 8자리 매장 코드를 입력하세요</Text>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>매장 코드</Text>
        <TextInput
          style={[styles.input, styles.codeInput]}
          value={code}
          onChangeText={setCode}
          placeholder="ABCD-1234"
          placeholderTextColor="#cbd5e1"
          autoCapitalize="characters"
          maxLength={9}
        />
      </View>
      <TouchableOpacity
        style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
        onPress={onSubmit}
        disabled={!canSubmit}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitBtnText}>매장 확인</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

// ── 매장 미리보기 + 본인 이름 입력 ───────────────────────────────
function JoinConfirmView({
  previewStore,
  code,
  staffName,
  setStaffName,
  busy,
  onSubmit,
  onBack,
}) {
  const canSubmit = staffName.trim() && !busy;
  return (
    <View style={styles.formCenter}>
      <BackBtn onPress={onBack} />
      <Text style={styles.formTitle}>{previewStore.name}</Text>
      <Text style={styles.formSub}>이 매장에 가입하시겠습니까?</Text>
      <View style={styles.codeBadge}>
        <Text style={styles.codeBadgeText}>{formatStoreCode(normalizeStoreCode(code))}</Text>
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>본인 표시 이름</Text>
        <TextInput
          style={styles.input}
          value={staffName}
          onChangeText={setStaffName}
          placeholder="예: 김알바"
          placeholderTextColor="#9ca3af"
          maxLength={20}
        />
      </View>
      <Text style={styles.note}>대표가 승인하면 자동으로 매장에 들어옵니다.</Text>
      <TouchableOpacity
        style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
        onPress={onSubmit}
        disabled={!canSubmit}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitBtnText}>가입 요청 보내기</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

// ── 매장 생성 직후: 코드 표시 ────────────────────────────────────
function CreatedView({ result, onContinue }) {
  return (
    <View style={styles.formCenter}>
      <Text style={styles.successTitle}>매장이 생성되었습니다</Text>
      <Text style={styles.successStoreName}>{result.name}</Text>
      <View style={styles.bigCodeBox}>
        <Text style={styles.bigCodeLabel}>매장 코드</Text>
        <Text style={styles.bigCodeText}>{formatStoreCode(result.code)}</Text>
      </View>
      <Text style={styles.note}>
        이 코드를 직원들에게 알려주세요.{'\n'}직원이 이 코드로 가입 요청을 보내면{'\n'}
        관리자 화면에서 승인할 수 있습니다.
      </Text>
      <TouchableOpacity style={styles.submitBtn} onPress={onContinue}>
        <Text style={styles.submitBtnText}>시작하기</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── 매장 생성 직후: 기존 로컬 데이터 → Firestore 업로드 ─────────
// 진행률 표시. 완료되면 onDone() → markJoined → 메인 앱 진입.
// 실패 시에도 "그래도 시작" 버튼으로 빈 매장 진입 허용 (매장 자체는 이미 생성됨).
function MigratingView({ result, onDone }) {
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState(null);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await migrateLocalToCloud({
          storeId: result.storeId,
          onProgress: (p) => {
            if (!cancelled) setProgress(p);
          },
        });
        if (cancelled) return;
        setFinished(true);
        // 완료 표시를 잠깐 보여주고 입장
        setTimeout(() => {
          if (!cancelled) onDone();
        }, 700);
      } catch (e) {
        if (!cancelled) setError(e?.message || '데이터 업로드 실패');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [result.storeId, onDone]);

  if (error) {
    return (
      <View style={styles.formCenter}>
        <Text style={styles.errorTitle}>업로드 실패</Text>
        <Text style={styles.note}>{error}</Text>
        <Text style={styles.note}>
          매장은 이미 만들어졌습니다. 그대로 시작하면 빈 매장으로 들어가며, 메뉴/매출 등은 새로
          입력해야 합니다.
        </Text>
        <TouchableOpacity style={styles.submitBtn} onPress={onDone}>
          <Text style={styles.submitBtnText}>그래도 시작</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <View style={styles.formCenter}>
      <Text style={styles.formTitle}>
        {finished ? '업로드 완료' : '기존 데이터 업로드 중...'}
      </Text>
      <Text style={styles.formSub}>
        {finished
          ? '잠시 후 시작합니다'
          : progress.total > 0
            ? `${progress.done} / ${progress.total} 항목 (${pct}%)`
            : '준비 중...'}
      </Text>
      {!finished && (
        <ActivityIndicator size="large" color="#2563eb" style={{ marginTop: 16 }} />
      )}
      {progress.total > 0 && (
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${pct}%` }]} />
        </View>
      )}
    </View>
  );
}

function BackBtn({ onPress }) {
  return (
    <TouchableOpacity style={styles.backBtn} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.backBtnText}>← 처음으로</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  scroll: { flexGrow: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 24,
  },
  formCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 24,
    maxWidth: 480,
    alignSelf: 'center',
    width: '100%',
  },

  brand: {
    fontSize: 36,
    fontWeight: '900',
    color: '#111827',
    letterSpacing: -1,
    marginBottom: 8,
  },
  tagline: { fontSize: 14, color: '#6b7280', marginBottom: 32 },

  optionRow: {
    flexDirection: 'row',
    gap: 16,
    width: '100%',
    maxWidth: 720,
  },
  primaryCard: {
    flex: 1,
    backgroundColor: '#2563eb',
    borderRadius: 14,
    padding: 20,
    minHeight: 140,
  },
  primaryCardTitle: { fontSize: 18, fontWeight: '800', color: '#fff', marginBottom: 4 },
  primaryCardSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    marginBottom: 12,
  },
  primaryCardDetail: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.95)',
    lineHeight: 18,
  },

  secondaryCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#e5e7eb',
    borderRadius: 14,
    padding: 20,
    minHeight: 140,
  },
  secondaryCardTitle: { fontSize: 18, fontWeight: '800', color: '#111827', marginBottom: 4 },
  secondaryCardSub: { fontSize: 12, color: '#6b7280', marginBottom: 12 },
  secondaryCardDetail: { fontSize: 13, color: '#374151', lineHeight: 18 },

  formTitle: { fontSize: 22, fontWeight: '800', color: '#111827', marginBottom: 6 },
  formSub: { fontSize: 13, color: '#6b7280', marginBottom: 20 },

  field: { width: '100%', marginBottom: 16 },
  fieldLabel: { fontSize: 12, color: '#6b7280', fontWeight: '600', marginBottom: 6 },
  input: {
    width: '100%',
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
  },
  codeInput: {
    fontSize: 20,
    letterSpacing: 4,
    textAlign: 'center',
    fontWeight: '700',
  },

  codeBadge: {
    backgroundColor: '#eff6ff',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 16,
  },
  codeBadgeText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2563eb',
    letterSpacing: 3,
  },

  submitBtn: {
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 10,
    width: '100%',
    alignItems: 'center',
    marginTop: 8,
  },
  submitBtnDisabled: { backgroundColor: '#9ca3af' },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  backBtn: { alignSelf: 'flex-start', paddingVertical: 6, marginBottom: 12 },
  backBtnText: { fontSize: 14, color: '#6b7280', fontWeight: '600' },

  note: {
    fontSize: 12,
    color: '#6b7280',
    lineHeight: 18,
    textAlign: 'center',
    marginVertical: 12,
  },

  successTitle: { fontSize: 22, fontWeight: '800', color: '#059669', marginBottom: 8 },
  successStoreName: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 20 },
  bigCodeBox: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 32,
    paddingVertical: 20,
    borderRadius: 14,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#f59e0b',
  },
  bigCodeLabel: { fontSize: 12, color: '#92400e', fontWeight: '600', marginBottom: 6 },
  bigCodeText: { fontSize: 32, fontWeight: '900', color: '#92400e', letterSpacing: 4 },

  pendingName: { fontSize: 16, color: '#374151', marginTop: 12, fontWeight: '600' },
  cancelBtn: {
    marginTop: 32,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
  },
  cancelBtnText: { fontSize: 14, color: '#6b7280', fontWeight: '600' },

  errorTitle: { fontSize: 20, fontWeight: '800', color: '#b91c1c', marginBottom: 12 },
  progressBar: {
    width: '100%',
    height: 8,
    backgroundColor: '#e5e7eb',
    borderRadius: 4,
    marginTop: 20,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#2563eb',
    borderRadius: 4,
  },
});
