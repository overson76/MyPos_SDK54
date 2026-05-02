// 매장 생성 직후 1회 — AsyncStorage 의 기존 메뉴/주문/매출/주소록을 Firestore 로 업로드.
// 모델은 Phase 4 의 listener 와 동일 형태로 정규화.
// 이미 마이그레이션된 storeId 면 재실행되지 않도록 'migratedToStore' 플래그 저장.

import { loadJSON, loadMany, saveJSON } from './persistence';
import { getFirestore } from './firebase';
import { addBreadcrumb } from './sentry';
import {
  defaultCategoryRows,
  defaultEditableOptions,
  menuItems as defaultMenuItems,
} from './menuData';

const MIGRATED_KEY = 'migratedToStore';

// Firestore 제약:
//   - WriteBatch 는 최대 500 작업 → 여유 두고 450
//   - 단일 문서는 1MiB → 여유 두고 900KB. 메뉴 이미지 dataURL 이 큰 경우 skip.
const FIRESTORE_BATCH_LIMIT = 450;
const FIRESTORE_DOC_BYTES_LIMIT = 900_000;

function approxBytes(obj) {
  try {
    return JSON.stringify(obj).length;
  } catch {
    return Infinity;
  }
}

// Firestore document ID 제약: '/' 사용 불가, 1500 byte 이하.
// 한글/영숫자는 허용되니 그대로 두고 '/' 만 치환.
function safeDocId(key) {
  if (!key) return '_';
  return String(key).replace(/\//g, '__').slice(0, 1400);
}

// 이 storeId 에 대해 이미 마이그레이션됐는지.
export async function isMigratedToStore(storeId) {
  const v = await loadJSON(MIGRATED_KEY, null);
  return v?.storeId === storeId;
}

// 메인 마이그레이션. 진행률은 onProgress({ done, total }) 콜백으로 전달.
// 빈 로컬 데이터(신규 사용자) 인 경우에도 플래그를 남겨 재호출되지 않게 함.
export async function migrateLocalToCloud({ storeId, onProgress }) {
  if (!storeId) throw new Error('storeId 가 없습니다.');
  const db = getFirestore();
  if (!db) throw new Error('Firebase 가 초기화되지 않았습니다.');

  const data = await loadMany([
    'menu_items',
    'menu_rows',
    'editable_options',
    'orders',
    'splits',
    'groups',
    'revenue',
    'addressBook',
  ]);

  // 신규 사용자(완전 깨끗한 상태) 감지 — 마이그레이션할 사용자 데이터 자체 없음.
  // 이 경우 업로드 자체를 건너뛰고 플래그만 남김.
  // 기본 메뉴/카테고리/옵션은 각 기기의 MenuContext 가 로컬에서 로드.
  // (RNFirebase v24 + 새 아키텍처에서 다수 sequential set 도 크래시 가능성 있어 회피)
  const hasUserMenu = Array.isArray(data.menu_items) && data.menu_items.length > 0;
  const hasUserRows = data.menu_rows && typeof data.menu_rows === 'object' && Object.keys(data.menu_rows).length > 0;
  const hasUserOptions = Array.isArray(data.editable_options) && data.editable_options.length > 0;
  const hasUserOrders = data.orders && typeof data.orders === 'object' && Object.keys(data.orders).length > 0;
  const hasUserRevenue = data.revenue && typeof data.revenue === 'object' && (Number(data.revenue.total) > 0 || (Array.isArray(data.revenue.history) && data.revenue.history.length > 0));
  const hasUserAddrBook = data.addressBook && typeof data.addressBook === 'object' && data.addressBook.entries && Object.keys(data.addressBook.entries).length > 0;
  const hasAnyUserData = hasUserMenu || hasUserRows || hasUserOptions || hasUserOrders || hasUserRevenue || hasUserAddrBook;

  if (!hasAnyUserData) {
    addBreadcrumb('store.migrate.skipFreshUser', { storeId });
    await saveJSON(MIGRATED_KEY, { storeId, at: Date.now(), total: 0, skipped: 0, skippedAll: true });
    return { total: 0, skipped: 0, skippedDetails: [] };
  }

  // 기존 사용자가 일부 데이터만 누락된 경우에만 default 보충 (덮어쓰기 방지).
  if (!hasUserMenu) data.menu_items = defaultMenuItems;
  if (!hasUserRows) data.menu_rows = defaultCategoryRows;
  if (!hasUserOptions) data.editable_options = defaultEditableOptions;

  const storeRef = db.collection('stores').doc(storeId);
  const ops = [];
  const skipped = [];

  // 1. 메뉴 카탈로그 — 정규화
  if (Array.isArray(data.menu_items)) {
    for (const item of data.menu_items) {
      if (!item?.id) continue;
      const bytes = approxBytes(item);
      if (bytes > FIRESTORE_DOC_BYTES_LIMIT) {
        // 이미지 dataURL 이 큰 메뉴는 skip — 추후 Storage 업로드로 분리.
        skipped.push({ kind: 'menu', id: item.id, name: item.name, bytes });
        continue;
      }
      ops.push({ ref: storeRef.collection('menu').doc(String(item.id)), data: item });
    }
  }

  // 2. 메뉴 메타 (정렬 행 + 옵션 카탈로그) — 단일 문서
  if (data.menu_rows != null) {
    ops.push({
      ref: storeRef.collection('state').doc('menu_rows'),
      data: { value: data.menu_rows },
    });
  }
  if (data.editable_options != null) {
    ops.push({
      ref: storeRef.collection('state').doc('editable_options'),
      data: { value: data.editable_options },
    });
  }

  // 3. 진행 중 주문 — 테이블 단위 정규화
  if (data.orders && typeof data.orders === 'object') {
    for (const [tableId, order] of Object.entries(data.orders)) {
      ops.push({
        ref: storeRef.collection('orders').doc(safeDocId(tableId)),
        data: order,
      });
    }
  }

  // 4. 분할/그룹 — 단일 문서
  if (data.splits != null) {
    ops.push({
      ref: storeRef.collection('state').doc('splits'),
      data: { value: data.splits },
    });
  }
  if (data.groups != null) {
    ops.push({
      ref: storeRef.collection('state').doc('groups'),
      data: { value: data.groups },
    });
  }

  // 5. 매출 — total 은 단일, history 는 정규화
  if (data.revenue && typeof data.revenue === 'object') {
    ops.push({
      ref: storeRef.collection('state').doc('revenueTotal'),
      data: { total: Number(data.revenue.total) || 0 },
    });
    if (Array.isArray(data.revenue.history)) {
      for (const entry of data.revenue.history) {
        if (!entry?.id) continue;
        ops.push({
          ref: storeRef.collection('history').doc(String(entry.id)),
          data: entry,
        });
      }
    }
  }

  // 6. 주소록 — entries 는 정규화, 메타는 단일 문서
  if (data.addressBook && typeof data.addressBook === 'object') {
    const { entries, ...meta } = data.addressBook;
    if (entries && typeof entries === 'object') {
      for (const [key, addr] of Object.entries(entries)) {
        ops.push({
          ref: storeRef.collection('addresses').doc(safeDocId(key)),
          // _key 보존 — '/' 치환된 경우에도 원본 정규화 키를 보관해 정확한 매칭 가능.
          data: { _key: key, ...addr },
        });
      }
    }
    ops.push({
      ref: storeRef.collection('state').doc('addressBookMeta'),
      data: meta,
    });
  }

  const total = ops.length;

  // 빈 데이터 — 플래그만 남기고 종료
  if (total === 0) {
    await saveJSON(MIGRATED_KEY, { storeId, at: Date.now(), total: 0, skipped: 0 });
    addBreadcrumb('store.migrated', { storeId, total: 0 });
    return { total: 0, skipped: 0, skippedDetails: [] };
  }

  // 순차 set — RNFirebase v24 + 새 아키텍처에서 batch.commit 네이티브 크래시 회피.
  // 신규 매장 마이그레이션은 한 번만 일어나니 성능 영향 미미.
  let done = 0;
  for (const op of ops) {
    try {
      await op.ref.set(op.data);
    } catch (e) {
      // 일부 항목 실패해도 계속 — 사용자가 매장 못 들어가는 상황만 피함
      addBreadcrumb('migrate.itemFail', { error: String(e?.message || e) });
    }
    done++;
    onProgress?.({ done, total });
  }

  await saveJSON(MIGRATED_KEY, {
    storeId,
    at: Date.now(),
    total,
    skipped: skipped.length,
  });

  addBreadcrumb('store.migrated', { storeId, total, skipped: skipped.length });

  return { total, skipped: skipped.length, skippedDetails: skipped };
}
