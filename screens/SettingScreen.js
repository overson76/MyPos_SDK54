import { useMemo, useState } from 'react';
import {
  Alert,
  ImageBackground,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useMenu } from '../utils/MenuContext';
import { useResponsive } from '../utils/useResponsive';
import { useOrders } from '../utils/OrderContext';

// 웹: <input type=file> + FileReader → data URL
// 네이티브: expo-image-picker (Android 13+ photo picker / iOS PhotoKit) → base64 data URL
// 양쪽 모두 같은 형식 (data:image/...;base64,...) 으로 반환해 메뉴 image 필드 일관성 유지.
function pickImageFile() {
  if (Platform.OS === 'web') {
    return new Promise((resolve) => {
      if (typeof document === 'undefined') {
        resolve(null);
        return;
      }
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target?.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      };
      input.click();
    });
  }
  // 네이티브
  return (async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          '권한 필요',
          '메뉴 이미지를 변경하려면 사진 라이브러리 접근 권한이 필요합니다.'
        );
        return null;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        allowsEditing: false,
        base64: true,
        quality: 0.7,
      });
      if (result.canceled || !result.assets || !result.assets[0]) return null;
      const asset = result.assets[0];
      if (!asset.base64) return null;
      const mime = asset.mimeType || 'image/jpeg';
      return `data:${mime};base64,${asset.base64}`;
    } catch (e) {
      return null;
    }
  })();
}

// 웹: window.confirm 으로 OK/Cancel
// 네이티브: Alert.alert (RN-web 의 Alert 는 버튼 무시되어 부적합)
function confirmDialog(title, message) {
  return new Promise((resolve) => {
    if (Platform.OS === 'web') {
      const ok =
        typeof window !== 'undefined' && window.confirm(message || title);
      resolve(!!ok);
      return;
    }
    Alert.alert(title, message, [
      { text: '취소', style: 'cancel', onPress: () => resolve(false) },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => resolve(true),
      },
    ]);
  });
}

export default function SettingScreen() {
  const { scale } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);
  const {
    items,
    rows,
    categories,
    updateItem,
    updateItemImage,
    resetItemImage,
    addNewItemAt,
    deleteItem,
    toggleFavorite,
    moveItemInCategory,
  } = useMenu();
  const { addressBook, setAutoRemember } = useOrders();
  const addressCount = Object.keys(addressBook?.entries || {}).length;

  const [filter, setFilter] = useState('전체');
  const [addModal, setAddModal] = useState(null);
  // addModal = { name, price, category, position }

  const filterOptions = ['전체', ...categories.filter((c) => c !== '즐겨찾기')];
  const realCategories = categories.filter((c) => c !== '즐겨찾기');

  // 현재 필터에 해당하는 아이템을 카테고리 rows 순서대로 노출
  const getOrderedItemsForFilter = () => {
    const byId = Object.fromEntries(items.map((m) => [m.id, m]));
    const cats = filter === '전체' ? realCategories : [filter];
    const out = [];
    const seen = new Set();
    for (const cat of cats) {
      const catRows = rows[cat] || [];
      for (const row of catRows) {
        for (const id of row) {
          if (seen.has(id)) continue;
          const it = byId[id];
          if (!it) continue;
          out.push(it);
          seen.add(id);
        }
      }
    }
    // rows에 없는 남은 아이템들 (edge case)
    for (const it of items) {
      if (seen.has(it.id)) continue;
      if (filter !== '전체' && it.category !== filter) continue;
      out.push(it);
    }
    return out;
  };

  const orderedItems = getOrderedItemsForFilter();

  const handleUpload = async (id) => {
    const url = await pickImageFile();
    if (url) updateItemImage(id, url);
  };

  const cycleCategory = (item) => {
    const list = realCategories;
    const idx = list.indexOf(item.category);
    const next = list[(idx + 1) % list.length];
    updateItem(item.id, { category: next });
  };

  const handleDelete = async (id) => {
    const ok = await confirmDialog('메뉴 삭제', '이 메뉴를 삭제할까요?');
    if (ok) deleteItem(id);
  };

  const openAddModal = () => {
    const cat = filter !== '전체' ? filter : realCategories[0];
    const catRows = rows[cat] || [];
    const flatLen = catRows.reduce((s, r) => s + r.length, 0);
    setAddModal({
      name: '',
      price: '',
      category: cat,
      position: flatLen, // 맨 끝
    });
  };

  const confirmAdd = () => {
    if (!addModal) return;
    const name = addModal.name.trim() || '새 메뉴';
    const price = Number(String(addModal.price).replace(/[^0-9]/g, '')) || 0;
    addNewItemAt(
      { name, price, category: addModal.category },
      addModal.position
    );
    setAddModal(null);
  };

  const getCategoryFlatLen = (cat) =>
    (rows[cat] || []).reduce((s, r) => s + r.length, 0);

  // 아이템의 현재 카테고리 내 flat 위치
  const getItemFlatIdx = (cat, id) => {
    const catRows = rows[cat] || [];
    let idx = 0;
    for (const row of catRows) {
      for (const rid of row) {
        if (rid === id) return idx;
        idx++;
      }
    }
    return -1;
  };

  const isInFavorites = (id) =>
    (rows['즐겨찾기'] || []).some((row) => row.includes(id));

  return (
    <View style={styles.container}>
      {/* 메뉴 추가 모달 */}
      {addModal && (
        <Modal transparent animationType="fade" visible>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <TouchableOpacity
                style={styles.modalClose}
                onPress={() => setAddModal(null)}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>새 메뉴 추가</Text>

              <Text style={styles.modalLabel}>메뉴명</Text>
              <TextInput
                style={styles.modalInput}
                value={addModal.name}
                onChangeText={(v) =>
                  setAddModal((s) => ({ ...s, name: v }))
                }
                placeholder="예: 감자전"
              />

              <Text style={styles.modalLabel}>가격</Text>
              <TextInput
                style={styles.modalInput}
                value={String(addModal.price)}
                onChangeText={(v) =>
                  setAddModal((s) => ({
                    ...s,
                    price: v.replace(/[^0-9]/g, ''),
                  }))
                }
                keyboardType="numeric"
                placeholder="10000"
              />

              <Text style={styles.modalLabel}>카테고리</Text>
              <View style={styles.catChips}>
                {realCategories.map((c) => {
                  const active = addModal.category === c;
                  return (
                    <TouchableOpacity
                      key={c}
                      style={[
                        styles.catChip,
                        active && styles.catChipActive,
                      ]}
                      onPress={() =>
                        setAddModal((s) => ({
                          ...s,
                          category: c,
                          position: getCategoryFlatLen(c),
                        }))
                      }
                    >
                      <Text
                        style={[
                          styles.catChipText,
                          active && styles.catChipTextActive,
                        ]}
                      >
                        {c}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.modalLabel}>
                위치 (카테고리 내 순서) — {addModal.position + 1}번째
              </Text>
              <View style={styles.posRow}>
                <TouchableOpacity
                  style={styles.posBtn}
                  onPress={() =>
                    setAddModal((s) => ({
                      ...s,
                      position: Math.max(0, s.position - 1),
                    }))
                  }
                >
                  <Text style={styles.posBtnText}>← 앞으로</Text>
                </TouchableOpacity>
                <Text style={styles.posLabel}>
                  {addModal.position + 1} /{' '}
                  {getCategoryFlatLen(addModal.category) + 1}
                </Text>
                <TouchableOpacity
                  style={styles.posBtn}
                  onPress={() =>
                    setAddModal((s) => ({
                      ...s,
                      position: Math.min(
                        getCategoryFlatLen(s.category),
                        s.position + 1
                      ),
                    }))
                  }
                >
                  <Text style={styles.posBtnText}>뒤로 →</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => setAddModal(null)}
                >
                  <Text style={styles.modalCancelText}>취소</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalConfirmBtn}
                  onPress={confirmAdd}
                >
                  <Text style={styles.modalConfirmText}>추가</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      <View style={styles.header}>
        <Text style={styles.title}>메뉴 관리</Text>
        <Text style={styles.subtitle}>
          이름·가격·카테고리 편집, 이미지 변경, 즐겨찾기/카테고리 내 위치 이동
        </Text>
      </View>

      <View style={styles.filterBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {filterOptions.map((f) => (
            <TouchableOpacity
              key={f}
              onPress={() => setFilter(f)}
              style={[styles.filterBtn, filter === f && styles.filterBtnActive]}
            >
              <Text
                style={[
                  styles.filterText,
                  filter === f && styles.filterTextActive,
                ]}
              >
                {f}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <TouchableOpacity style={styles.addBtn} onPress={openAddModal}>
          <Text style={styles.addBtnText}>+ 메뉴 추가</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        <View style={styles.prefRow}>
          <View style={styles.prefTextWrap}>
            <Text style={styles.prefTitle}>📍 배달 주소 자동 기억</Text>
            <Text style={styles.prefDesc}>
              배달이 완료되면 주소를 주소록에 자동 저장합니다 · 현재 {addressCount}개
            </Text>
          </View>
          <TouchableOpacity
            style={[
              styles.toggleTrack,
              addressBook?.autoRemember && styles.toggleTrackOn,
            ]}
            onPress={() => setAutoRemember(!addressBook?.autoRemember)}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.toggleKnob,
                addressBook?.autoRemember && styles.toggleKnobOn,
              ]}
            />
          </TouchableOpacity>
        </View>

        {orderedItems.map((item) => {
          const catIdx = getItemFlatIdx(item.category, item.id);
          const catLen = getCategoryFlatLen(item.category);
          const inFav = isInFavorites(item.id);
          const favIdx = inFav
            ? getItemFlatIdx('즐겨찾기', item.id)
            : -1;
          const favLen = getCategoryFlatLen('즐겨찾기');
          return (
            <View key={item.id} style={styles.row}>
              <ImageBackground
                source={{ uri: item.image || undefined }}
                style={[styles.thumb, { backgroundColor: item.color }]}
                imageStyle={styles.thumbImage}
              />
              <View style={styles.info}>
                <TextInput
                  style={styles.nameInput}
                  value={item.name}
                  onChangeText={(v) => updateItem(item.id, { name: v })}
                  placeholder="메뉴명"
                />
                <View style={styles.infoBottom}>
                  <Text style={styles.label}>가격</Text>
                  <TextInput
                    style={styles.priceInput}
                    value={String(item.price)}
                    keyboardType="numeric"
                    onChangeText={(v) =>
                      updateItem(item.id, {
                        price: Number(v.replace(/[^0-9]/g, '')) || 0,
                      })
                    }
                  />
                  <Text style={styles.won}>원</Text>
                  <TouchableOpacity
                    style={styles.catBtn}
                    onPress={() => cycleCategory(item)}
                  >
                    <Text style={styles.catText}>{item.category}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.favBtn,
                      item.favorite && styles.favBtnActive,
                    ]}
                    onPress={() => toggleFavorite(item.id)}
                  >
                    <Text
                      style={[
                        styles.favText,
                        item.favorite && styles.favTextActive,
                      ]}
                    >
                      {item.favorite ? '★ 즐겨찾기' : '☆ 즐겨찾기'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* 카테고리 내 위치 이동 */}
                <View style={styles.moveRow}>
                  <Text style={styles.moveLabel}>
                    {item.category}: {catIdx + 1}/{catLen}
                  </Text>
                  <TouchableOpacity
                    style={[
                      styles.moveBtn,
                      catIdx <= 0 && styles.moveBtnDisabled,
                    ]}
                    disabled={catIdx <= 0}
                    onPress={() =>
                      moveItemInCategory(item.category, item.id, -1)
                    }
                  >
                    <Text style={styles.moveBtnText}>▲</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.moveBtn,
                      (catIdx < 0 || catIdx >= catLen - 1) &&
                        styles.moveBtnDisabled,
                    ]}
                    disabled={catIdx < 0 || catIdx >= catLen - 1}
                    onPress={() =>
                      moveItemInCategory(item.category, item.id, +1)
                    }
                  >
                    <Text style={styles.moveBtnText}>▼</Text>
                  </TouchableOpacity>

                  {inFav && (
                    <>
                      <Text style={styles.moveLabelFav}>
                        즐겨찾기: {favIdx + 1}/{favLen}
                      </Text>
                      <TouchableOpacity
                        style={[
                          styles.moveBtn,
                          styles.moveBtnFav,
                          favIdx <= 0 && styles.moveBtnDisabled,
                        ]}
                        disabled={favIdx <= 0}
                        onPress={() =>
                          moveItemInCategory('즐겨찾기', item.id, -1)
                        }
                      >
                        <Text style={styles.moveBtnText}>▲</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.moveBtn,
                          styles.moveBtnFav,
                          (favIdx < 0 || favIdx >= favLen - 1) &&
                            styles.moveBtnDisabled,
                        ]}
                        disabled={favIdx < 0 || favIdx >= favLen - 1}
                        onPress={() =>
                          moveItemInCategory('즐겨찾기', item.id, +1)
                        }
                      >
                        <Text style={styles.moveBtnText}>▼</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>

                <TextInput
                  style={styles.shortInput}
                  value={item.shortName || ''}
                  onChangeText={(v) => updateItem(item.id, { shortName: v })}
                  placeholder="음성 단축어 (예: 팥칼)"
                />
              </View>
              <View style={styles.actions}>
                <TouchableOpacity
                  style={styles.btnPrimary}
                  onPress={() => handleUpload(item.id)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.btnPrimaryText}>이미지</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.btnSecondary}
                  onPress={() => resetItemImage(item.id)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.btnSecondaryText}>기본</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.btnDanger}
                  onPress={() => handleDelete(item.id)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.btnDangerText}>삭제</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

// scale: useResponsive() 의 폰트 배율(lg=1.3, 그 외 1.0). SettingScreen 에서 useMemo 로 호출.
function makeStyles(scale = 1) {
  const fp = (n) => Math.round(n * scale);
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    backgroundColor: '#fafafa',
  },
  title: { fontSize: fp(20), fontWeight: '700', color: '#111827' },
  subtitle: { fontSize: fp(12), color: '#6b7280', marginTop: 4 },

  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    gap: 8,
  },
  filterBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 6,
    borderRadius: 14,
    backgroundColor: '#f3f4f6',
  },
  filterBtnActive: { backgroundColor: '#111827' },
  filterText: { fontSize: fp(12), color: '#374151', fontWeight: '600' },
  filterTextActive: { color: '#fff' },
  addBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#2563eb',
  },
  addBtnText: { color: '#fff', fontSize: fp(13), fontWeight: '700' },

  list: { padding: 10, gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 10,
    gap: 10,
    backgroundColor: '#fff',
  },
  thumb: {
    width: 72,
    height: 56,
    borderRadius: 6,
    overflow: 'hidden',
  },
  thumbImage: { borderRadius: 6 },

  info: { flex: 1, gap: 6 },
  nameInput: {
    fontSize: fp(15),
    fontWeight: '700',
    color: '#111827',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  infoBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
  },
  label: { fontSize: fp(12), color: '#6b7280' },
  priceInput: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    fontSize: fp(13),
    width: 80,
    textAlign: 'right',
    color: '#111827',
  },
  won: { fontSize: fp(12), color: '#374151' },
  catBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: '#eef2ff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
  },
  catText: { fontSize: fp(11), color: '#3730a3', fontWeight: '700' },
  favBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  favBtnActive: { backgroundColor: '#fef3c7', borderColor: '#f59e0b' },
  favText: { fontSize: fp(11), color: '#6b7280', fontWeight: '600' },
  favTextActive: { color: '#92400e', fontWeight: '700' },

  moveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
  },
  moveLabel: {
    fontSize: fp(11),
    color: '#3730a3',
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: '#eef2ff',
    borderRadius: 3,
  },
  moveLabelFav: {
    fontSize: fp(11),
    color: '#92400e',
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: '#fef3c7',
    borderRadius: 3,
    marginLeft: 8,
  },
  moveBtn: {
    width: 26,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    backgroundColor: '#eef2ff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
  },
  moveBtnFav: {
    backgroundColor: '#fef3c7',
    borderColor: '#fcd34d',
  },
  moveBtnDisabled: { opacity: 0.3 },
  moveBtnText: { fontSize: fp(12), color: '#1f2937', fontWeight: '700' },

  shortInput: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    fontSize: fp(12),
    color: '#374151',
  },

  actions: { flexDirection: 'column', gap: 4, alignItems: 'stretch' },
  btnPrimary: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    backgroundColor: '#2563eb',
    alignItems: 'center',
  },
  btnPrimaryText: { color: '#fff', fontSize: fp(11), fontWeight: '700' },
  btnSecondary: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    alignItems: 'center',
  },
  btnSecondaryText: { color: '#374151', fontSize: fp(11), fontWeight: '600' },
  btnDanger: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    alignItems: 'center',
  },
  btnDangerText: { color: '#b91c1c', fontSize: fp(11), fontWeight: '700' },

  // 모달
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 8,
  },
  modalClose: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseText: { fontSize: fp(20), color: '#6b7280' },
  modalTitle: {
    fontSize: fp(18),
    fontWeight: '800',
    color: '#111827',
    marginBottom: 8,
  },
  modalLabel: {
    fontSize: fp(12),
    color: '#374151',
    fontWeight: '700',
    marginTop: 6,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: fp(14),
    color: '#111827',
    backgroundColor: '#fff',
  },
  catChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  catChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  catChipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  catChipText: { fontSize: fp(12), color: '#374151', fontWeight: '600' },
  catChipTextActive: { color: '#fff', fontWeight: '800' },
  posRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  posBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#eef2ff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
  },
  posBtnText: { fontSize: fp(13), color: '#1e3a8a', fontWeight: '700' },
  posLabel: {
    fontSize: fp(14),
    color: '#111827',
    fontWeight: '800',
    minWidth: 64,
    textAlign: 'center',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 16,
  },
  modalCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  modalCancelText: { fontSize: fp(14), color: '#374151', fontWeight: '700' },
  modalConfirmBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 6,
    backgroundColor: '#2563eb',
  },
  modalConfirmText: { fontSize: fp(14), color: '#fff', fontWeight: '800' },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#fef9f0',
    borderWidth: 1,
    borderColor: '#fcd34d',
    borderRadius: 10,
    marginBottom: 12,
    gap: 12,
  },
  prefTextWrap: { flex: 1, minWidth: 0 },
  prefTitle: { fontSize: fp(14), fontWeight: '800', color: '#92400e' },
  prefDesc: { fontSize: fp(11), color: '#78716c', marginTop: 2 },
  toggleTrack: {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#d1d5db',
    padding: 2,
    justifyContent: 'center',
  },
  toggleTrackOn: { backgroundColor: '#10b981' },
  toggleKnob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  toggleKnobOn: { transform: [{ translateX: 20 }] },
  });
}
