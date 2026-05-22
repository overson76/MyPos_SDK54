// 자주 쓰는 주문 메모 칩을 관리자에서 편집.
// - SettingScreen(메뉴 관리) 하단에 섹션으로 mount
// - 추가 / 삭제 / 순서 이동 / 기본값 복원
// - 저장은 즉시 (debounce 안 함 — 한 손가락 단위 액션이라 폭주 불가)
import { useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  loadMemoTemplates,
  saveMemoTemplates,
  addMemoTemplate,
  removeMemoTemplate,
  moveMemoTemplate,
  DEFAULT_MEMO_TEMPLATES,
  MEMO_TEMPLATE_LIMITS,
} from '../utils/memoTemplates';

// 웹은 confirm, 네이티브는 Alert. (SettingScreen 의 confirmDialog 와 동일 패턴)
function confirmRestore() {
  return new Promise((resolve) => {
    if (Platform.OS === 'web') {
      const ok =
        typeof window !== 'undefined' &&
        window.confirm('메모 템플릿을 기본값으로 되돌릴까요?');
      resolve(!!ok);
      return;
    }
    Alert.alert('기본값 복원', '메모 템플릿을 기본값으로 되돌릴까요?', [
      { text: '취소', style: 'cancel', onPress: () => resolve(false) },
      { text: '복원', onPress: () => resolve(true) },
    ]);
  });
}

export default function MemoTemplatesEditor() {
  const [list, setList] = useState([]);
  const [input, setInput] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    loadMemoTemplates().then((v) => {
      if (!alive) return;
      setList(v);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 저장은 항상 normalize 거친 cleaned 결과를 다시 state 로 끌어옴 — 중복/길이초과를 화면에 즉시 반영.
  const persist = async (next) => {
    const cleaned = await saveMemoTemplates(next);
    setList(cleaned);
  };

  const onAdd = () => {
    if (!input.trim()) return;
    const next = addMemoTemplate(list, input);
    if (next.length === list.length) {
      // 중복 or 상한 도달 — 입력 비우고 끝
      setInput('');
      return;
    }
    setInput('');
    persist(next);
  };

  const onRemove = (idx) => {
    persist(removeMemoTemplate(list, idx));
  };

  const onMove = (idx, delta) => {
    const to = idx + delta;
    persist(moveMemoTemplate(list, idx, to));
  };

  const onRestore = async () => {
    const ok = await confirmRestore();
    if (!ok) return;
    persist(DEFAULT_MEMO_TEMPLATES);
  };

  if (!loaded) return null;

  const full = list.length >= MEMO_TEMPLATE_LIMITS.CHIP_MAX_COUNT;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>📝 자주 쓰는 메모</Text>
        <TouchableOpacity style={styles.restoreBtn} onPress={onRestore}>
          <Text style={styles.restoreText}>기본값 복원</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.subtitle}>
        주문 메모 모달의 칩으로 노출됩니다. 한 칩 최대{' '}
        {MEMO_TEMPLATE_LIMITS.CHIP_MAX_LEN}자 · 최대{' '}
        {MEMO_TEMPLATE_LIMITS.CHIP_MAX_COUNT}개
      </Text>

      <View style={styles.addRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="예: 덜 맵게"
          placeholderTextColor="#9ca3af"
          maxLength={MEMO_TEMPLATE_LIMITS.CHIP_MAX_LEN}
          onSubmitEditing={onAdd}
          returnKeyType="done"
          editable={!full}
        />
        <TouchableOpacity
          style={[styles.addBtn, (!input.trim() || full) && styles.addBtnOff]}
          onPress={onAdd}
          disabled={!input.trim() || full}
        >
          <Text style={styles.addBtnText}>+ 추가</Text>
        </TouchableOpacity>
      </View>
      {full ? (
        <Text style={styles.fullHint}>
          최대 {MEMO_TEMPLATE_LIMITS.CHIP_MAX_COUNT}개까지 등록할 수 있어요.
          삭제 후 추가하세요.
        </Text>
      ) : null}

      <View style={styles.list}>
        {list.length === 0 ? (
          <Text style={styles.empty}>등록된 메모 칩이 없습니다.</Text>
        ) : (
          list.map((chip, idx) => (
            <View key={`${chip}-${idx}`} style={styles.row}>
              <Text style={styles.chipLabel}>{chip}</Text>
              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.iconBtn, idx === 0 && styles.iconBtnOff]}
                  disabled={idx === 0}
                  onPress={() => onMove(idx, -1)}
                >
                  <Text style={styles.iconText}>▲</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.iconBtn,
                    idx === list.length - 1 && styles.iconBtnOff,
                  ]}
                  disabled={idx === list.length - 1}
                  onPress={() => onMove(idx, +1)}
                >
                  <Text style={styles.iconText}>▼</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.deleteBtn}
                  onPress={() => onRemove(idx)}
                >
                  <Text style={styles.deleteBtnText}>삭제</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#f9fafb',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 16, fontWeight: '700', color: '#111827' },
  restoreBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
  },
  restoreText: { color: '#374151', fontSize: 12, fontWeight: '700' },
  subtitle: { fontSize: 12, color: '#6b7280', marginBottom: 4 },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    height: 38,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
    fontSize: 14,
    color: '#111827',
  },
  addBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#2563eb',
  },
  addBtnOff: { backgroundColor: '#93c5fd' },
  addBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  fullHint: { fontSize: 11, color: '#b45309', marginTop: 2 },
  list: { marginTop: 6, gap: 6 },
  empty: {
    fontSize: 13,
    color: '#9ca3af',
    fontStyle: 'italic',
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  chipLabel: { fontSize: 14, color: '#111827', fontWeight: '600', flex: 1 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnOff: { opacity: 0.4 },
  iconText: { fontSize: 12, color: '#374151', fontWeight: '700' },
  deleteBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#fca5a5',
  },
  deleteBtnText: { color: '#b91c1c', fontSize: 12, fontWeight: '700' },
});
