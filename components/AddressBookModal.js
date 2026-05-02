import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useOrders } from '../utils/OrderContext';
import { useResponsive } from '../utils/useResponsive';

// 배달 주소록 — 검색 / 핀 / 삭제 / 선택.
// pinned 우선, 그 다음 사용 횟수 desc, 그 다음 lastUsedAt desc.
// 당일 배송 완료된 항목은 회색 처리(별도 섹션 분리하지는 않음 — 한 리스트에서 시각적으로만 구분).
export default function AddressBookModal({ visible, onClose, onSelect }) {
  const { scale } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);
  const { addressBook, pinAddress, deleteAddress, setAlias, setPhone, addAddress } = useOrders();
  const [query, setQuery] = useState('');
  // 편집 중인 항목 key. null = 편집 없음.
  const [editingKey, setEditingKey] = useState(null);
  const [editAlias, setEditAlias] = useState('');
  const [editPhone, setEditPhone] = useState('');
  // 새 주소 추가 폼
  const [addingNew, setAddingNew] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newAlias, setNewAlias] = useState('');
  const [newPhone, setNewPhone] = useState('');

  const todaySet = useMemo(
    () => new Set(addressBook.todayDeliveredKeys || []),
    [addressBook.todayDeliveredKeys]
  );

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const arr = Object.values(addressBook.entries || {});
    const filtered = q
      ? arr.filter((e) => (e.label || '').toLowerCase().includes(q))
      : arr;
    return filtered.sort((a, b) => {
      // 오늘 완료된 항목은 무조건 뒤로 (핀 고정이라도)
      const at = todaySet.has(a.key);
      const bt = todaySet.has(b.key);
      if (at !== bt) return at ? 1 : -1;
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      const ca = a.count || 0;
      const cb = b.count || 0;
      if (cb !== ca) return cb - ca;
      return (b.lastUsedAt || 0) - (a.lastUsedAt || 0);
    });
  }, [addressBook.entries, query, todaySet]);

  const handleSelect = (label) => {
    onSelect && onSelect(label);
    onClose && onClose();
  };

  const openEdit = (it) => {
    setEditingKey(it.key);
    setEditAlias(it.alias || '');
    setEditPhone(it.phone ? formatPhoneDisplay(it.phone) : '');
  };

  const confirmEdit = () => {
    if (!editingKey) return;
    setAlias(editingKey, editAlias);
    setPhone(editingKey, editPhone);
    setEditingKey(null);
  };

  const cancelEdit = () => setEditingKey(null);

  const confirmAdd = () => {
    if (!newLabel.trim()) return;
    addAddress(newLabel.trim(), newAlias.trim(), newPhone);
    setAddingNew(false);
    setNewLabel('');
    setNewAlias('');
    setNewPhone('');
  };

  const cancelAdd = () => {
    setAddingNew(false);
    setNewLabel('');
    setNewAlias('');
    setNewPhone('');
  };

  if (!visible) return null;

  return (
    <View style={styles.overlay} pointerEvents="auto">
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title}>배달 주소록</Text>
            <View style={styles.headerRight}>
              <TouchableOpacity
                style={styles.addBtn}
                onPress={() => setAddingNew(true)}
                hitSlop={6}
              >
                <Text style={styles.addBtnText}>+ 추가</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onClose} hitSlop={8}>
                <Text style={styles.closeBtn}>닫기</Text>
              </TouchableOpacity>
            </View>
          </View>

          {addingNew && (
            <View style={styles.newBox}>
              <View style={styles.editRow}>
                <Text style={styles.editFieldLabel}>주소</Text>
                <TextInput
                  style={styles.editInput}
                  value={newLabel}
                  onChangeText={setNewLabel}
                  placeholder="예) 부산 사하구 사하로 47"
                  placeholderTextColor="#9ca3af"
                  maxLength={100}
                  autoFocus
                />
              </View>
              <View style={styles.editRow}>
                <Text style={styles.editFieldLabel}>별칭</Text>
                <TextInput
                  style={styles.editInput}
                  value={newAlias}
                  onChangeText={setNewAlias}
                  placeholder="예) 김사장 (선택)"
                  placeholderTextColor="#9ca3af"
                  maxLength={20}
                />
              </View>
              <View style={styles.editRow}>
                <Text style={styles.editFieldLabel}>전화번호</Text>
                <TextInput
                  style={styles.editInput}
                  value={newPhone}
                  onChangeText={setNewPhone}
                  placeholder="예) 010-1234-5678 (선택)"
                  placeholderTextColor="#9ca3af"
                  keyboardType="phone-pad"
                  maxLength={14}
                />
              </View>
              <View style={styles.editActions}>
                <TouchableOpacity style={styles.editConfirmBtn} onPress={confirmAdd}>
                  <Text style={styles.editConfirmText}>등록</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.editCancelBtn} onPress={cancelAdd}>
                  <Text style={styles.editCancelText}>취소</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View style={styles.searchRow}>
            <Text style={styles.searchIcon}>🔍</Text>
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="주소 검색"
              placeholderTextColor="#9ca3af"
              autoFocus={false}
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
                <Text style={styles.clearBtn}>×</Text>
              </TouchableOpacity>
            )}
          </View>

          {items.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                {query
                  ? '검색 결과가 없습니다'
                  : '저장된 배달 주소가 없습니다'}
              </Text>
              <Text style={styles.emptyHint}>
                배달이 완료되면 자동으로 등록됩니다
              </Text>
            </View>
          ) : (
            <ScrollView style={styles.list}>
              {items.map((it) => {
                const isToday = todaySet.has(it.key);
                const isEditing = editingKey === it.key;
                return (
                  <View
                    key={it.key}
                    style={[styles.row, isToday && styles.rowToday]}
                  >
                    {isEditing ? (
                      // ── 편집 모드 ──────────────────────────────────────
                      <View style={styles.editBox}>
                        <Text style={styles.editLabel} numberOfLines={1}>{it.label}</Text>
                        <View style={styles.editRow}>
                          <Text style={styles.editFieldLabel}>별칭</Text>
                          <TextInput
                            style={styles.editInput}
                            value={editAlias}
                            onChangeText={setEditAlias}
                            placeholder="예) 김사장"
                            placeholderTextColor="#9ca3af"
                            maxLength={20}
                            autoFocus
                          />
                        </View>
                        <View style={styles.editRow}>
                          <Text style={styles.editFieldLabel}>전화번호</Text>
                          <TextInput
                            style={styles.editInput}
                            value={editPhone}
                            onChangeText={setEditPhone}
                            placeholder="예) 010-1234-5678"
                            placeholderTextColor="#9ca3af"
                            keyboardType="phone-pad"
                            maxLength={14}
                          />
                        </View>
                        <View style={styles.editActions}>
                          <TouchableOpacity style={styles.editConfirmBtn} onPress={confirmEdit}>
                            <Text style={styles.editConfirmText}>저장</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.editCancelBtn} onPress={cancelEdit}>
                            <Text style={styles.editCancelText}>취소</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      // ── 일반 모드 ──────────────────────────────────────
                      <>
                        <TouchableOpacity
                          style={styles.rowMain}
                          onPress={() => handleSelect(it.label)}
                          activeOpacity={0.6}
                        >
                          {it.alias ? (
                            <Text style={styles.rowAlias} numberOfLines={1}>
                              👤 {it.alias}
                            </Text>
                          ) : null}
                          <Text
                            style={[
                              styles.rowLabel,
                              isToday && styles.rowLabelToday,
                            ]}
                            numberOfLines={2}
                          >
                            {it.label}
                          </Text>
                          <View style={styles.rowMeta}>
                            <Text style={styles.rowCount}>×{it.count || 0}</Text>
                            {it.phone ? (
                              <Text style={styles.rowPhone}>
                                {formatPhoneDisplay(it.phone)}
                              </Text>
                            ) : null}
                            {isToday && (
                              <Text style={styles.todayBadge}>오늘 완료</Text>
                            )}
                          </View>
                        </TouchableOpacity>
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
                            style={[
                              styles.iconText,
                              it.pinned && styles.iconTextActive,
                            ]}
                          >
                            {it.pinned ? '📌' : '📍'}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.iconBtn}
                          onPress={() => deleteAddress(it.key)}
                          hitSlop={6}
                        >
                          <Text style={styles.deleteText}>🗑</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </View>
  );
}

// 저장된 digits → 표시용 포맷 (01012341234 → 010-1234-1234)
function formatPhoneDisplay(digits) {
  const d = (digits || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('010')) {
    return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  }
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
  return d;
}

// scale: useResponsive() 의 폰트 배율(lg=1.3, 그 외 1.0).
function makeStyles(scale = 1) {
  const fp = (n) => Math.round(n * scale);
  return StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    elevation: 9999,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  sheet: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '90%',
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
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#ef4444',
  },
  title: { fontSize: fp(16), fontWeight: '900', color: '#fff' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  addBtn: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  addBtnText: { fontSize: fp(12), fontWeight: '800', color: '#fff' },
  closeBtn: { fontSize: fp(13), fontWeight: '700', color: '#fff' },
  newBox: {
    padding: 12,
    backgroundColor: '#f0fdf4',
    borderBottomWidth: 1,
    borderBottomColor: '#bbf7d0',
    gap: 6,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    gap: 6,
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
    paddingHorizontal: 6,
  },
  empty: { padding: 32, alignItems: 'center', gap: 6 },
  emptyText: { fontSize: fp(14), color: '#6b7280', fontWeight: '600' },
  emptyHint: { fontSize: fp(11), color: '#9ca3af' },
  list: { maxHeight: 420 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    gap: 4,
  },
  rowToday: { backgroundColor: '#f9fafb' },
  rowMain: { flex: 1, minWidth: 0, paddingHorizontal: 4, paddingVertical: 2 },
  rowLabel: { fontSize: fp(13), fontWeight: '700', color: '#111827' },
  rowLabelToday: {
    color: '#9ca3af',
    textDecorationLine: 'line-through',
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  rowCount: { fontSize: fp(11), fontWeight: '700', color: '#dc2626' },
  todayBadge: {
    fontSize: fp(9),
    color: '#fff',
    fontWeight: '900',
    backgroundColor: '#9ca3af',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    overflow: 'hidden',
  },
  iconBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  iconText: { fontSize: fp(16), opacity: 0.5 },
  iconTextActive: { opacity: 1 },
  deleteText: { fontSize: fp(14), opacity: 0.6 },
  rowAlias: {
    fontSize: fp(12),
    fontWeight: '800',
    color: '#2563eb',
    marginBottom: 1,
  },
  rowPhone: {
    fontSize: fp(10),
    color: '#6b7280',
    fontWeight: '500',
  },
  // 편집 모드
  editBox: {
    flex: 1,
    paddingHorizontal: 4,
    paddingVertical: 6,
    gap: 6,
  },
  editLabel: {
    fontSize: fp(11),
    color: '#9ca3af',
    fontWeight: '500',
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  editFieldLabel: {
    fontSize: fp(11),
    color: '#6b7280',
    fontWeight: '700',
    width: 50,
  },
  editInput: {
    flex: 1,
    fontSize: fp(13),
    color: '#111827',
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    outlineStyle: 'none',
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 2,
  },
  editConfirmBtn: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
  },
  editConfirmText: {
    color: '#fff',
    fontSize: fp(12),
    fontWeight: '800',
  },
  editCancelBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  editCancelText: {
    color: '#9ca3af',
    fontSize: fp(12),
    fontWeight: '700',
  },
  });
}
