// 메뉴 퀵에디트 모달 — 주문 화면에서 메뉴 타일을 꾹 누르면 등장.
// 이름 / 가격만 빠르게 수정. 이미지·카테고리 등 상세 수정은 관리자 → 메뉴관리로.
//
// iOS new architecture 크래시 회피 — absolute 오버레이 패턴 사용.

import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useMenu } from '../utils/MenuContext';
import { useResponsive } from '../utils/useResponsive';
import { sanitizeMenuName, sanitizeMenuPrice, VALIDATE_LIMITS } from '../utils/validate';

// 1.0.26: addAt prop 추가 — { category, flatIndex } 면 신규 추가 모드.
//   - mode='edit' (기본, item prop): 기존 메뉴 이름/가격 빠른 수정
//   - mode='add' (addAt prop): 빈 슬롯 클릭 시 그 위치에 신규 메뉴 추가 (addNewItemAt)
export default function MenuQuickEditModal({ item, addAt, onClose }) {
  const { updateItem, addNewItemAt, deleteItem } = useMenu();
  const { scale } = useResponsive();
  const styles = useMemo(() => makeStyles(scale), [scale]);

  const isAddMode = !!addAt && !item;

  const [name, setName] = useState(item?.name || '');
  const [price, setPrice] = useState(item ? String(item.price) : '');
  const [nameErr, setNameErr] = useState('');
  const [priceErr, setPriceErr] = useState('');
  const [saving, setSaving] = useState(false);

  // 모달 열릴 때 초기값 동기화
  useEffect(() => {
    if (item) {
      setName(item.name || '');
      setPrice(String(item.price || ''));
      setNameErr('');
      setPriceErr('');
    } else if (addAt) {
      setName('');
      setPrice('');
      setNameErr('');
      setPriceErr('');
    }
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

  const handleSave = () => {
    if (!validate()) return;
    const newName = sanitizeMenuName(name);
    const newPrice = sanitizeMenuPrice(price);

    setSaving(true);
    if (isAddMode) {
      // 신규 추가 — addAt 의 category + flatIndex 위치에 메뉴 생성.
      addNewItemAt({ name: newName, price: newPrice, category: addAt.category }, addAt.flatIndex);
    } else {
      // 변경 없으면 그냥 닫기
      if (newName === item.name && newPrice === item.price) {
        setSaving(false);
        onClose();
        return;
      }
      updateItem(item.id, { name: newName, price: newPrice });
    }
    setSaving(false);
    onClose();
  };

  return (
    <View style={styles.overlay} pointerEvents="auto">
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          {/* 헤더 */}
          <View style={styles.header}>
            <Text style={styles.title}>
              {isAddMode ? '➕ 새 메뉴 추가' : '✏️ 빠른 메뉴 수정'}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.subtitle} numberOfLines={1}>
            {isAddMode ? `카테고리: ${addAt.category}` : item.name}
          </Text>

          {/* 이름 */}
          <Text style={styles.label}>메뉴 이름</Text>
          <TextInput
            style={[styles.input, nameErr ? styles.inputErr : null]}
            value={name}
            onChangeText={setName}
            placeholder="메뉴 이름"
            maxLength={30}
            returnKeyType="next"
            autoFocus
          />
          {nameErr ? <Text style={styles.errText}>{nameErr}</Text> : null}

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
            onSubmitEditing={handleSave}
          />
          {priceErr ? <Text style={styles.errText}>{priceErr}</Text> : null}

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

          {/* 1.0.26: 삭제 버튼 — 수정 모드에서만 노출. confirm 필수. */}
          {!isAddMode ? (
            <TouchableOpacity
              style={{
                marginTop: 12,
                paddingVertical: 8,
                borderRadius: 8,
                backgroundColor: '#fef2f2',
                borderWidth: 1,
                borderColor: '#fecaca',
                alignItems: 'center',
              }}
              onPress={() => {
                const ok =
                  typeof window !== 'undefined'
                    ? window?.confirm?.(
                        `'${item.name}' 메뉴를 삭제할까요?\n매출 이력에는 영향 없음. 격자 슬롯이 비워집니다.`
                      )
                    : true;
                if (!ok) return;
                deleteItem(item.id);
                onClose();
              }}
            >
              <Text style={{ color: '#dc2626', fontWeight: '700', fontSize: 13 }}>
                🗑️ 메뉴 삭제
              </Text>
            </TouchableOpacity>
          ) : null}

          {/* 상세 수정 안내 */}
          <Text style={styles.hint}>
            {isAddMode
              ? '이미지·색상 등 추가 설정 → 저장 후 관리자 → 메뉴 관리'
              : '이미지·카테고리 등 상세 수정 → 관리자 → 메뉴 관리'}
          </Text>
        </Pressable>
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
    card: {
      width: 320,
      backgroundColor: '#fff',
      borderRadius: 16,
      padding: 20,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    title: { fontSize: fp(16), fontWeight: '800', color: '#111827' },
    close: { fontSize: fp(20), color: '#6b7280', paddingHorizontal: 6 },
    subtitle: {
      fontSize: fp(12),
      color: '#6b7280',
      marginBottom: 14,
    },
    label: {
      fontSize: fp(12),
      fontWeight: '700',
      color: '#374151',
      marginBottom: 4,
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
    btnRow: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 16,
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
    hint: {
      fontSize: fp(11),
      color: '#9ca3af',
      textAlign: 'center',
      marginTop: 10,
    },
  });
}
