import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useOrders } from '../utils/OrderContext';

// 배달 주소록 — 검색 / 핀 / 삭제 / 선택.
// pinned 우선, 그 다음 사용 횟수 desc, 그 다음 lastUsedAt desc.
// 당일 배송 완료된 항목은 회색 처리(별도 섹션 분리하지는 않음 — 한 리스트에서 시각적으로만 구분).
export default function AddressBookModal({ visible, onClose, onSelect }) {
  const { addressBook, pinAddress, deleteAddress } = useOrders();
  const [query, setQuery] = useState('');

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

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title}>배달 주소록</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Text style={styles.closeBtn}>닫기</Text>
            </TouchableOpacity>
          </View>

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
                return (
                  <View
                    key={it.key}
                    style={[styles.row, isToday && styles.rowToday]}
                  >
                    <TouchableOpacity
                      style={styles.rowMain}
                      onPress={() => handleSelect(it.label)}
                      activeOpacity={0.6}
                    >
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
                        {isToday && (
                          <Text style={styles.todayBadge}>오늘 완료</Text>
                        )}
                      </View>
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
                  </View>
                );
              })}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
  title: { fontSize: 16, fontWeight: '900', color: '#fff' },
  closeBtn: { fontSize: 13, fontWeight: '700', color: '#fff' },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    gap: 6,
  },
  searchIcon: { fontSize: 14 },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#111827',
    paddingVertical: 6,
    outlineStyle: 'none',
  },
  clearBtn: {
    fontSize: 18,
    fontWeight: '700',
    color: '#9ca3af',
    paddingHorizontal: 6,
  },
  empty: { padding: 32, alignItems: 'center', gap: 6 },
  emptyText: { fontSize: 14, color: '#6b7280', fontWeight: '600' },
  emptyHint: { fontSize: 11, color: '#9ca3af' },
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
  rowLabel: { fontSize: 13, fontWeight: '700', color: '#111827' },
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
  rowCount: { fontSize: 11, fontWeight: '700', color: '#dc2626' },
  todayBadge: {
    fontSize: 9,
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
  iconText: { fontSize: 16, opacity: 0.5 },
  iconTextActive: { opacity: 1 },
  deleteText: { fontSize: 14, opacity: 0.6 },
});
