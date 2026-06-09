// 메뉴 퀵에디트 모달 — 주문 화면에서 메뉴 타일 클릭(편집모드) 또는 꾹 누르면 등장.
// 2026-06-09: 사장님 요청 — 관리자 안 거치고 주문탭에서 바로 추가/수정.
//   이름 / 가격 + 카테고리 이동 + "대" 옵션(추가금) + 이미지까지 한 모달에서.
//
// iOS new architecture 크래시 회피 — absolute 오버레이 패턴 사용.

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  ImageBackground,
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
import { useMenu } from '../utils/MenuContext';
import { useResponsive } from '../utils/useResponsive';
import { sanitizeMenuName, sanitizeMenuPrice, VALIDATE_LIMITS } from '../utils/validate';
import { pickMenuImage } from '../utils/pickMenuImage';
import { findItemByName, catalogOnlyItems } from '../utils/menuCatalog';

// 2026-05-26 ⑥ fix: confirm 호출이 옛 코드의 `typeof window !== 'undefined' ? window?.confirm?.()
// : true` 는 폰에서 window.confirm 이 undefined → ok=undefined → if(!ok) return 으로
// 삭제가 작동 안 함. Platform.OS 분기 + native 는 Alert 로 정상 confirm.
function confirmDestructive(message) {
  return new Promise((resolve) => {
    if (Platform.OS === 'web') {
      const ok =
        typeof window !== 'undefined' && window.confirm
          ? window.confirm(message)
          : true;
      resolve(!!ok);
      return;
    }
    Alert.alert('확인', message, [
      { text: '취소', style: 'cancel', onPress: () => resolve(false) },
      { text: '확인', style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

// "대" 추가금 → sizeGroup 자동 매칭. 두 그룹의 라벨이 모두 "대..." 라 무난.
//   2000원 이상 = deulpatkong(들/팥/콩), 그 외 = milkalsu(밀/칼/수).
//   주문 화면은 item.sizeGroup 으로 대 버튼 노출 + item.sizeUpcharge 로 가격 부과.
function sizeGroupForUpcharge(upcharge) {
  return Number(upcharge) >= 2000 ? 'deulpatkong' : 'milkalsu';
}

// 1.0.26: addAt prop 추가 — { category, flatIndex } 면 신규 추가 모드.
//   - mode='edit' (기본, item prop): 기존 메뉴 수정
//   - mode='add' (addAt prop): 빈 슬롯 위치에 신규 메뉴 추가
// 2026-05-26 ⑥: fromCategory prop — '즐겨찾기' 면 삭제 버튼이 "즐겨찾기에서 빼기" 동작.
export default function MenuQuickEditModal({ item, addAt, onClose, fromCategory }) {
  const {
    updateItem,
    updateItemImage,
    resetItemImage,
    addNewItemAt,
    deleteItem,
    removeFromFavorite,
    removeFromOrder,
    addExistingToOrder,
    inOrderIds,
    items,
    rows,
    categories,
  } = useMenu();
  const { scale } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);

  const isAddMode = !!addAt && !item;
  const realCategories = (categories || []).filter((c) => c !== '즐겨찾기');

  const [name, setName] = useState(item?.name || '');
  const [price, setPrice] = useState(item ? String(item.price) : '');
  const [category, setCategory] = useState(
    item?.category || addAt?.category || realCategories[0] || '국수/만백'
  );
  // 대 옵션 — item.sizeGroup 있으면 ON, 추가금은 item.sizeUpcharge.
  const [sizeEnabled, setSizeEnabled] = useState(!!item?.sizeGroup);
  const [sizeUpcharge, setSizeUpcharge] = useState(
    item?.sizeUpcharge ? String(item.sizeUpcharge) : '1000'
  );
  // 이미지 — pickedImage 가 null 이면 변경 없음. '' 면 기본 복원 예약.
  const [pickedImage, setPickedImage] = useState(undefined); // undefined=미변경
  const [nameErr, setNameErr] = useState('');
  const [priceErr, setPriceErr] = useState('');
  const [saving, setSaving] = useState(false);

  // 모달 열릴 때 초기값 동기화
  useEffect(() => {
    if (item) {
      setName(item.name || '');
      setPrice(String(item.price || ''));
      setCategory(item.category || realCategories[0] || '국수/만백');
      setSizeEnabled(!!item.sizeGroup);
      setSizeUpcharge(item.sizeUpcharge ? String(item.sizeUpcharge) : '1000');
    } else if (addAt) {
      setName('');
      setPrice('');
      setCategory(addAt.category || realCategories[0] || '국수/만백');
      setSizeEnabled(false);
      setSizeUpcharge('1000');
    }
    setPickedImage(undefined);
    setNameErr('');
    setPriceErr('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, addAt?.flatIndex, addAt?.category]);

  if (!item && !addAt) return null;

  const validate = () => {
    let ok = true;
    const cleanName = sanitizeMenuName(name);
    if (!cleanName) { setNameErr('이름을 입력해주세요'); ok = false; }
    else setNameErr('');

    const numPrice = Number(price);
    if (!price || isNaN(numPrice) || numPrice < 0) {
      setPriceErr('올바른 가격을 입력해주세요'); ok = false;
    } else if (numPrice > VALIDATE_LIMITS.MENU_PRICE_MAX) {
      setPriceErr(`최대 ${VALIDATE_LIMITS.MENU_PRICE_MAX.toLocaleString()}원`); ok = false;
    } else {
      setPriceErr('');
    }
    return ok;
  };

  // 신규 추가 모드 — 같은 이름 카탈로그 메뉴 탐지(중복 방지) + 카탈로그 불러오기 후보.
  const nameMatch = isAddMode ? findItemByName(items, name) : null;
  const matchInOrder = nameMatch
    ? !!(inOrderIds && typeof inOrderIds.has === 'function' && inOrderIds.has(nameMatch.id))
    : false;
  const catalogPicks = isAddMode ? catalogOnlyItems(items, rows, category) : [];

  // 카탈로그 메뉴를 현재 카테고리 주문에 올림 (시즌 시작 / 중복 대신 불러오기).
  const bringInCatalogItem = (id) => {
    if (typeof addExistingToOrder === 'function') {
      addExistingToOrder(id, category);
    }
    onClose();
  };

  const handlePickImage = async () => {
    const url = await pickMenuImage();
    if (url) setPickedImage(url);
  };

  const handleSave = () => {
    if (!validate()) return;
    const newName = sanitizeMenuName(name);
    const newPrice = sanitizeMenuPrice(price);
    const upN = Math.max(0, Number(String(sizeUpcharge).replace(/[^0-9]/g, '')) || 0);
    // 대 옵션 필드 — ON 이면 group+추가금, OFF 면 비움('' / 0)으로 명시 제거.
    const sizeFields = sizeEnabled
      ? { sizeGroup: sizeGroupForUpcharge(upN), sizeUpcharge: upN }
      : { sizeGroup: '', sizeUpcharge: 0 };

    if (isAddMode) {
      // 중복 방지 — 같은 이름이 카탈로그에 있으면 새로 만들지 않음.
      const dup = findItemByName(items, newName);
      if (dup) {
        const dupInOrder =
          inOrderIds && typeof inOrderIds.has === 'function' && inOrderIds.has(dup.id);
        if (dupInOrder) {
          Alert.alert(
            '이미 있는 메뉴',
            `'${dup.name}' 은(는) 이미 주문에 있습니다. 기존 메뉴를 수정하거나 다른 이름을 쓰세요.`
          );
          return;
        }
        // 카탈로그(시즌 대기) 에만 있으면 그걸 불러옴.
        bringInCatalogItem(dup.id);
        return;
      }
    }

    setSaving(true);
    if (isAddMode) {
      addNewItemAt(
        {
          name: newName,
          price: newPrice,
          category,
          image: pickedImage && pickedImage !== '' ? pickedImage : undefined,
          ...(sizeEnabled ? sizeFields : {}),
        },
        addAt.flatIndex
      );
    } else {
      updateItem(item.id, {
        name: newName,
        price: newPrice,
        category,
        ...sizeFields,
      });
      // 이미지 — 새로 고른 게 있으면 적용, '' (기본 복원) 이면 reset.
      if (pickedImage && pickedImage !== '') {
        updateItemImage(item.id, pickedImage);
      } else if (pickedImage === '') {
        resetItemImage(item.id);
      }
    }
    setSaving(false);
    onClose();
  };

  // 미리보기 이미지 — 새로 고른 것 우선, 없으면 기존 item.image.
  const previewImage =
    pickedImage && pickedImage !== ''
      ? pickedImage
      : pickedImage === ''
        ? ''
        : item?.image || '';

  return (
    <View style={styles.overlay} pointerEvents="auto">
      <Pressable style={styles.backdrop} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={60}
          style={styles.keyboardAvoidWrap}
        >
        <Pressable style={styles.card} onPress={() => {}}>
          {/* 헤더 */}
          <View style={styles.header}>
            <Text style={styles.title}>
              {isAddMode ? '➕ 새 메뉴 추가' : '✏️ 메뉴 수정'}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* 이름 */}
            <Text style={styles.label}>메뉴 이름</Text>
            <TextInput
              style={[styles.input, nameErr ? styles.inputErr : null]}
              value={name}
              onChangeText={setName}
              placeholder="메뉴 이름"
              maxLength={30}
              returnKeyType="next"
              autoFocus={isAddMode}
            />
            {nameErr ? <Text style={styles.errText}>{nameErr}</Text> : null}

            {/* 같은 이름 카탈로그 메뉴 안내 — 중복 방지 + 불러오기 (신규 추가 모드) */}
            {isAddMode && nameMatch ? (
              matchInOrder ? (
                <View style={styles.dupBannerWarn}>
                  <Text style={styles.dupBannerWarnText}>
                    ⚠ '{nameMatch.name}' 은 이미 주문에 있어요. 다른 이름을 쓰거나
                    기존 메뉴를 수정하세요.
                  </Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.dupBannerLoad}
                  onPress={() => bringInCatalogItem(nameMatch.id)}
                >
                  <Text style={styles.dupBannerLoadText}>
                    📋 카탈로그에 '{nameMatch.name}' 있어요 — 눌러서 불러오기
                    (새로 안 만듦)
                  </Text>
                </TouchableOpacity>
              )
            ) : null}

            {/* 가격 */}
            <Text style={styles.label}>가격 (원)</Text>
            <TextInput
              style={[styles.input, priceErr ? styles.inputErr : null]}
              value={price}
              onChangeText={setPrice}
              placeholder="가격"
              keyboardType="number-pad"
              maxLength={8}
              returnKeyType="done"
            />
            {priceErr ? <Text style={styles.errText}>{priceErr}</Text> : null}

            {/* 카테고리 — 칩 선택. 다른 카테고리로 이동 = 메뉴 옮기기. */}
            <Text style={styles.label}>카테고리</Text>
            <View style={styles.catWrap}>
              {realCategories.map((c) => {
                const active = c === category;
                return (
                  <TouchableOpacity
                    key={c}
                    style={[styles.catChip, active && styles.catChipActive]}
                    onPress={() => setCategory(c)}
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

            {/* 카탈로그에서 불러오기 — 이 카테고리의 시즌 대기(주문에서 빠진) 메뉴.
                여름 콩국수처럼 카탈로그엔 남아있는 메뉴를 한 번에 다시 올림. */}
            {isAddMode && catalogPicks.length > 0 ? (
              <View style={styles.catalogBox}>
                <Text style={styles.catalogTitle}>
                  📋 카탈로그에서 불러오기 ({category} 시즌 대기 {catalogPicks.length})
                </Text>
                <View style={styles.catalogWrap}>
                  {catalogPicks.map((m) => (
                    <TouchableOpacity
                      key={m.id}
                      style={styles.catalogChip}
                      onPress={() => bringInCatalogItem(m.id)}
                    >
                      <Text style={styles.catalogChipText}>
                        {m.name}
                        {m.price ? ` · ${Number(m.price).toLocaleString()}` : ''}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}

            {/* 대 옵션 — 토글 + 추가금 */}
            <View style={styles.sizeRow}>
              <Text style={styles.label}>"대" 옵션 (곱빼기)</Text>
              <TouchableOpacity
                style={[styles.toggle, sizeEnabled && styles.toggleOn]}
                onPress={() => setSizeEnabled((v) => !v)}
              >
                <Text
                  style={[
                    styles.toggleText,
                    sizeEnabled && styles.toggleTextOn,
                  ]}
                >
                  {sizeEnabled ? 'ON' : 'OFF'}
                </Text>
              </TouchableOpacity>
            </View>
            {sizeEnabled ? (
              <View style={styles.sizeUpchargeRow}>
                <Text style={styles.sizeHint}>대 추가금</Text>
                <TextInput
                  style={styles.sizeInput}
                  value={sizeUpcharge}
                  onChangeText={setSizeUpcharge}
                  placeholder="1000"
                  keyboardType="number-pad"
                  maxLength={6}
                />
                <Text style={styles.sizeHint}>원</Text>
                <View style={styles.presetRow}>
                  <TouchableOpacity
                    style={styles.presetBtn}
                    onPress={() => setSizeUpcharge('1000')}
                  >
                    <Text style={styles.presetText}>+1,000</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.presetBtn}
                    onPress={() => setSizeUpcharge('2000')}
                  >
                    <Text style={styles.presetText}>+2,000</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {/* 이미지 */}
            <Text style={styles.label}>이미지</Text>
            <View style={styles.imageRow}>
              <ImageBackground
                source={{ uri: previewImage || undefined }}
                style={styles.thumb}
                imageStyle={styles.thumbImg}
              >
                {!previewImage ? (
                  <Text style={styles.thumbEmpty}>없음</Text>
                ) : null}
              </ImageBackground>
              <View style={styles.imageBtns}>
                <TouchableOpacity
                  style={styles.imgBtn}
                  onPress={handlePickImage}
                >
                  <Text style={styles.imgBtnText}>📷 이미지 선택</Text>
                </TouchableOpacity>
                {!isAddMode ? (
                  <TouchableOpacity
                    style={styles.imgBtnGhost}
                    onPress={() => setPickedImage('')}
                  >
                    <Text style={styles.imgBtnGhostText}>기본으로</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </ScrollView>

          {/* 버튼 */}
          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>취소</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={saving}
            >
              <Text style={styles.saveText}>{isAddMode ? '추가' : '저장'}</Text>
            </TouchableOpacity>
          </View>

          {/* 즐겨찾기 카테고리 — 즐겨찾기에서만 빼기 */}
          {!isAddMode && fromCategory === '즐겨찾기' ? (
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={() => {
                if (typeof removeFromFavorite === 'function') {
                  removeFromFavorite(item.id);
                }
                onClose();
              }}
            >
              <Text style={styles.deleteBtnText}>⭐ 즐겨찾기에서 빼기</Text>
            </TouchableOpacity>
          ) : null}

          {/* 일반 카테고리 — 주문에서 빼기(시즌 종료, 카탈로그 잔류) vs 완전 삭제 구분.
              사장님 정책: 메뉴목록=시즌 마스터, 주문=현재 운영분. 겨울 콩국수는 주문에서만 빠짐. */}
          {!isAddMode && fromCategory !== '즐겨찾기' ? (
            <View style={styles.removeRow}>
              <TouchableOpacity
                style={styles.seasonOutBtn}
                onPress={() => {
                  if (typeof removeFromOrder === 'function') {
                    removeFromOrder(item.id);
                  }
                  onClose();
                }}
              >
                <Text style={styles.seasonOutText}>📦 주문에서 빼기{'\n'}(시즌 종료·메뉴목록 잔류)</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.deleteBtnSm}
                onPress={async () => {
                  const ok = await confirmDestructive(
                    `'${item.name}' 을 메뉴목록(카탈로그)에서도 완전히 삭제할까요?\n시즌 보관이 목적이면 '주문에서 빼기' 를 쓰세요. 매출 이력에는 영향 없음.`
                  );
                  if (!ok) return;
                  deleteItem(item.id);
                  onClose();
                }}
              >
                <Text style={styles.deleteBtnText}>🗑️ 완전 삭제</Text>
              </TouchableOpacity>
            </View>
          ) : null}
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
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 300,
    },
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    keyboardAvoidWrap: {
      width: '100%',
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    card: {
      width: 360,
      maxHeight: '92%',
      backgroundColor: '#fff',
      borderRadius: 16,
      padding: 20,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    title: { fontSize: fp(16), fontWeight: '800', color: '#111827' },
    close: { fontSize: fp(20), color: '#6b7280', paddingHorizontal: 6 },
    scroll: { flexGrow: 0 },
    scrollContent: { paddingBottom: 4 },
    label: {
      fontSize: fp(12),
      fontWeight: '700',
      color: '#374151',
      marginBottom: 4,
      marginTop: 8,
    },
    input: {
      borderWidth: 1,
      borderColor: '#d1d5db',
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      fontSize: fp(15),
      color: '#111827',
      marginBottom: 4,
    },
    inputErr: { borderColor: '#ef4444' },
    errText: { fontSize: fp(11), color: '#ef4444', marginBottom: 6 },
    // 카테고리 칩
    catWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginBottom: 4,
    },
    catChip: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 16,
      backgroundColor: '#f3f4f6',
      borderWidth: 1,
      borderColor: '#e5e7eb',
    },
    catChipActive: { backgroundColor: '#dbeafe', borderColor: '#3b82f6' },
    catChipText: { fontSize: fp(12), fontWeight: '600', color: '#374151' },
    catChipTextActive: { color: '#1d4ed8' },
    // 대 옵션
    sizeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    toggle: {
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: 16,
      backgroundColor: '#f3f4f6',
      borderWidth: 1,
      borderColor: '#d1d5db',
      marginTop: 8,
    },
    toggleOn: { backgroundColor: '#16a34a', borderColor: '#15803d' },
    toggleText: { fontSize: fp(12), fontWeight: '800', color: '#6b7280' },
    toggleTextOn: { color: '#fff' },
    sizeUpchargeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 6,
      flexWrap: 'wrap',
    },
    sizeHint: { fontSize: fp(12), color: '#6b7280', fontWeight: '600' },
    sizeInput: {
      borderWidth: 1,
      borderColor: '#d1d5db',
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
      fontSize: fp(14),
      color: '#111827',
      width: 80,
      textAlign: 'right',
    },
    presetRow: { flexDirection: 'row', gap: 4, marginLeft: 4 },
    presetBtn: {
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: '#eff6ff',
      borderWidth: 1,
      borderColor: '#bfdbfe',
    },
    presetText: { fontSize: fp(11), fontWeight: '700', color: '#1d4ed8' },
    // 이미지
    imageRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
    thumb: {
      width: 64,
      height: 64,
      borderRadius: 8,
      backgroundColor: '#f3f4f6',
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
    },
    thumbImg: { borderRadius: 8 },
    thumbEmpty: { fontSize: fp(11), color: '#9ca3af' },
    imageBtns: { flex: 1, gap: 6 },
    imgBtn: {
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 8,
      backgroundColor: '#1F2937',
      alignItems: 'center',
    },
    imgBtnText: { color: '#fff', fontSize: fp(13), fontWeight: '700' },
    imgBtnGhost: {
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 8,
      backgroundColor: '#fff',
      borderWidth: 1,
      borderColor: '#d1d5db',
      alignItems: 'center',
    },
    imgBtnGhostText: { color: '#374151', fontSize: fp(12), fontWeight: '600' },
    // 하단 버튼
    btnRow: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 14,
    },
    cancelBtn: {
      flex: 1,
      paddingVertical: 12,
      backgroundColor: '#e5e7eb',
      borderRadius: 10,
      alignItems: 'center',
    },
    cancelText: { fontSize: fp(14), fontWeight: '700', color: '#374151' },
    saveBtn: {
      flex: 2,
      paddingVertical: 12,
      backgroundColor: '#1F2937',
      borderRadius: 10,
      alignItems: 'center',
    },
    saveBtnDisabled: { opacity: 0.5 },
    saveText: { fontSize: fp(14), fontWeight: '800', color: '#fff' },
    deleteBtn: {
      marginTop: 12,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: '#fef2f2',
      borderWidth: 1,
      borderColor: '#fecaca',
      alignItems: 'center',
    },
    deleteBtnText: { color: '#dc2626', fontWeight: '700', fontSize: fp(13) },
    // 시즌 종료 / 완전삭제 2열
    removeRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
    seasonOutBtn: {
      flex: 2,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: '#fffbeb',
      borderWidth: 1,
      borderColor: '#fde68a',
      alignItems: 'center',
    },
    seasonOutText: {
      color: '#b45309',
      fontWeight: '700',
      fontSize: fp(11),
      textAlign: 'center',
    },
    deleteBtnSm: {
      flex: 1,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: '#fef2f2',
      borderWidth: 1,
      borderColor: '#fecaca',
      alignItems: 'center',
      justifyContent: 'center',
    },
    // 중복 이름 배너
    dupBannerWarn: {
      backgroundColor: '#fef2f2',
      borderWidth: 1,
      borderColor: '#fecaca',
      borderRadius: 8,
      padding: 8,
      marginBottom: 4,
    },
    dupBannerWarnText: { color: '#b91c1c', fontSize: fp(11), fontWeight: '600' },
    dupBannerLoad: {
      backgroundColor: '#eff6ff',
      borderWidth: 1,
      borderColor: '#bfdbfe',
      borderRadius: 8,
      padding: 8,
      marginBottom: 4,
    },
    dupBannerLoadText: { color: '#1d4ed8', fontSize: fp(11), fontWeight: '700' },
    // 카탈로그 불러오기
    catalogBox: {
      marginTop: 8,
      backgroundColor: '#f9fafb',
      borderWidth: 1,
      borderColor: '#e5e7eb',
      borderRadius: 8,
      padding: 8,
    },
    catalogTitle: {
      fontSize: fp(11),
      fontWeight: '800',
      color: '#374151',
      marginBottom: 6,
    },
    catalogWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    catalogChip: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 14,
      backgroundColor: '#fff',
      borderWidth: 1,
      borderColor: '#93c5fd',
    },
    catalogChipText: { fontSize: fp(11), fontWeight: '700', color: '#1d4ed8' },
  });
}
