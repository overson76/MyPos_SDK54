// 메뉴 카탈로그 + 카테고리 격자 + 편집 가능 옵션의 매장 단위 동기화.
//
// 패턴:
//   - source-of-truth = Firestore (stores/{storeId}/menu, state/menu_rows, state/editable_options)
//   - 모든 mutation = 옵티미스틱 setState + Firestore write (offline cache 가 즉시 반영)
//   - read-modify-write (격자 위치 변경) = 클라이언트의 현재 state 사용 → last-write-wins
//     (POS 매장에서 같은 메뉴를 동시에 편집할 일은 매우 드뭄)
//   - rowsRef / itemsRef = useCallback 의 stale closure 회피용 (ref 만 deps 에서 제외)

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  categories,
  defaultCategoryRows,
  defaultEditableOptions,
  menuItems as defaultMenuItems,
  sizeOptions,
} from './menuData';
import {
  sanitizeImageDataUrl,
  sanitizeMenuName,
  sanitizeMenuPrice,
  sanitizeMenuShortName,
} from './validate';
import { useStore } from './StoreContext';
import { getFirestore } from './firebase';
import { reportError } from './sentry';

const MenuContext = createContext(null);

// 모든 카테고리에 적용되는 격자 규격 (6열 × 4행, 빈 칸은 null)
const GRID_COLS = 6;
const GRID_ROWS = 4;
const GRID_TOTAL = GRID_COLS * GRID_ROWS;
const FAV_COLS = GRID_COLS;
const FAV_ROWS = GRID_ROWS;

function cloneRows(rows) {
  const out = {};
  for (const cat of Object.keys(rows)) {
    out[cat] = rows[cat].map((row) => [...row]);
  }
  return out;
}

// 단일 카테고리 배열을 GRID_ROWS × GRID_COLS 고정 격자로 정규화.
function gridifyCategory(catRows) {
  const src = catRows || [];
  const alreadyGrid =
    src.length === GRID_ROWS &&
    src.every((r) => Array.isArray(r) && r.length === GRID_COLS);
  if (alreadyGrid) {
    return src.map((row) => [...row]);
  }
  const flat = [].concat(...src);
  const grid = new Array(GRID_TOTAL).fill(null);
  let p = 0;
  for (let i = 0; i < flat.length && p < GRID_TOTAL; i++) {
    const v = flat[i];
    if (v != null) {
      grid[p++] = v;
    }
  }
  const rebuilt = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    rebuilt.push(grid.slice(r * GRID_COLS, (r + 1) * GRID_COLS));
  }
  return rebuilt;
}

function normalizeAllToGrid(rows) {
  const next = { ...rows };
  for (const cat of Object.keys(next)) {
    next[cat] = gridifyCategory(next[cat]);
  }
  return next;
}

const normalizeFav = normalizeAllToGrid;

export function MenuProvider({ children }) {
  const { storeInfo } = useStore();
  const storeId = storeInfo?.storeId || null;

  const [items, setItems] = useState(() =>
    defaultMenuItems.map((m) => ({ ...m }))
  );
  const [rows, setRows] = useState(() =>
    normalizeFav(cloneRows(defaultCategoryRows))
  );
  const [editableOptions, setEditableOptions] = useState(() =>
    defaultEditableOptions.map((o) => ({ ...o }))
  );

  // useCallback closure 의 stale 문제 회피 — ref 는 deps 에 안 넣어도 됨.
  const itemsRef = useRef(items);
  const rowsRef = useRef(rows);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  // ── Firestore write 헬퍼 ────────────────────────────────────
  const writeMenuItemFs = useCallback(
    (id, data) => {
      if (!storeId) return;
      const db = getFirestore();
      if (!db) return;
      db.collection('stores')
        .doc(storeId)
        .collection('menu')
        .doc(String(id))
        .set(data, { merge: true })
        .catch((e) => reportError(e, { ctx: 'menu.writeMenuItem', id }));
    },
    [storeId]
  );

  const setMenuItemFs = useCallback(
    (id, data) => {
      if (!storeId) return;
      const db = getFirestore();
      if (!db) return;
      db.collection('stores')
        .doc(storeId)
        .collection('menu')
        .doc(String(id))
        .set(data)
        .catch((e) => reportError(e, { ctx: 'menu.setMenuItem', id }));
    },
    [storeId]
  );

  const deleteMenuItemFs = useCallback(
    (id) => {
      if (!storeId) return;
      const db = getFirestore();
      if (!db) return;
      db.collection('stores')
        .doc(storeId)
        .collection('menu')
        .doc(String(id))
        .delete()
        .catch((e) => reportError(e, { ctx: 'menu.deleteMenuItem', id }));
    },
    [storeId]
  );

  const writeMenuRowsFs = useCallback(
    (newRows) => {
      if (!storeId) return;
      const db = getFirestore();
      if (!db) return;
      db.collection('stores')
        .doc(storeId)
        .collection('state')
        .doc('menu_rows')
        .set({ value: newRows })
        .catch((e) => reportError(e, { ctx: 'menu.writeMenuRows' }));
    },
    [storeId]
  );

  const writeEditableOptionsFs = useCallback(
    (newOptions) => {
      if (!storeId) return;
      const db = getFirestore();
      if (!db) return;
      db.collection('stores')
        .doc(storeId)
        .collection('state')
        .doc('editable_options')
        .set({ value: newOptions })
        .catch((e) => reportError(e, { ctx: 'menu.writeEditableOptions' }));
    },
    [storeId]
  );

  // ── Firestore listeners — source-of-truth ───────────────────
  // 매장 가입 후 storeId 가 정해지면 등록. 다른 사용자의 변경이 즉시 반영.
  useEffect(() => {
    if (!storeId) return;
    const db = getFirestore();
    if (!db) return;

    const storeRef = db.collection('stores').doc(storeId);

    const unsubItems = storeRef.collection('menu').onSnapshot(
      (snap) => {
        const list = snap.docs
          .map((d) => d.data())
          .filter((m) => m && m.id != null);
        if (list.length === 0) return;
        // shortName 누락 마이그레이션 — 옛 데이터 호환.
        const defaultByName = new Map(
          defaultMenuItems.map((m) => [m.name, m])
        );
        const defaultById = new Map(
          defaultMenuItems.map((m) => [m.id, m])
        );
        const migrated = list.map((m) => {
          const sn = (m.shortName || '').trim();
          if (sn) return m;
          const def = defaultById.get(m.id) || defaultByName.get(m.name);
          if (def?.shortName) return { ...m, shortName: def.shortName };
          return m;
        });
        setItems(migrated);
      },
      (err) => reportError(err, { ctx: 'menu.itemsListener' })
    );

    const unsubRows = storeRef.collection('state').doc('menu_rows').onSnapshot(
      (snap) => {
        const data = snap.data();
        if (data?.value && typeof data.value === 'object') {
          setRows(normalizeFav(cloneRows(data.value)));
        }
      },
      (err) => reportError(err, { ctx: 'menu.rowsListener' })
    );

    const unsubOpts = storeRef
      .collection('state')
      .doc('editable_options')
      .onSnapshot(
        (snap) => {
          const data = snap.data();
          if (Array.isArray(data?.value)) {
            const cleaned = data.value
              .filter((o) => o && typeof o.id === 'string')
              .map((o) => ({
                id: o.id,
                label: typeof o.label === 'string' ? o.label : '',
              }));
            if (cleaned.length > 0) setEditableOptions(cleaned);
          }
        },
        (err) => reportError(err, { ctx: 'menu.optionsListener' })
      );

    return () => {
      unsubItems();
      unsubRows();
      unsubOpts();
    };
  }, [storeId]);

  // ── Mutations: 옵티미스틱 setState + Firestore write ────────

  const updateItem = useCallback(
    (id, fields) => {
      const safe = { ...fields };
      if ('name' in safe) safe.name = sanitizeMenuName(safe.name);
      if ('shortName' in safe)
        safe.shortName = sanitizeMenuShortName(safe.shortName);
      if ('price' in safe) safe.price = sanitizeMenuPrice(safe.price);

      setItems((prev) =>
        prev.map((m) => (m.id === id ? { ...m, ...safe } : m))
      );
      writeMenuItemFs(id, safe);

      if (fields.category) {
        const next = normalizeAllToGrid(cloneRows(rowsRef.current));
        for (const cat of Object.keys(next)) {
          if (cat === '즐겨찾기') continue;
          next[cat] = next[cat].map((row) =>
            row.map((i) => (i === id ? null : i))
          );
        }
        const target = fields.category;
        if (!next[target]) next[target] = gridifyCategory([]);
        const flat = [].concat(...next[target]);
        const emptyIdx = flat.indexOf(null);
        if (emptyIdx >= 0) flat[emptyIdx] = id;
        const rebuilt = [];
        for (let r = 0; r < GRID_ROWS; r++) {
          rebuilt.push(flat.slice(r * GRID_COLS, (r + 1) * GRID_COLS));
        }
        next[target] = rebuilt;
        setRows(next);
        writeMenuRowsFs(next);
      }
    },
    [writeMenuItemFs, writeMenuRowsFs]
  );

  const updateItemImage = useCallback(
    (id, image) => {
      const safe = sanitizeImageDataUrl(image);
      if (!safe) return;
      setItems((prev) =>
        prev.map((m) => (m.id === id ? { ...m, image: safe } : m))
      );
      writeMenuItemFs(id, { image: safe });
    },
    [writeMenuItemFs]
  );

  const resetItemImage = useCallback(
    (id) => {
      const orig = defaultMenuItems.find((m) => m.id === id);
      const newImage = orig?.image ?? '';
      setItems((prev) =>
        prev.map((m) => (m.id === id ? { ...m, image: newImage } : m))
      );
      writeMenuItemFs(id, { image: newImage });
    },
    [writeMenuItemFs]
  );

  const addNewItem = useCallback(
    (partial = {}) => {
      const currentItems = itemsRef.current;
      const maxId = currentItems.reduce((m, i) => Math.max(m, i.id), 0);
      const nextId = maxId + 1;
      const cat = partial.category || '국수/만백';
      const safeName = sanitizeMenuName(partial.name) || '새 메뉴';
      const safeShort =
        sanitizeMenuShortName(partial.shortName || partial.name) || '새';
      const newItem = {
        id: nextId,
        name: safeName,
        shortName: safeShort,
        price: sanitizeMenuPrice(partial.price),
        color: partial.color || '#9CA3AF',
        category: cat,
        favorite: !!partial.favorite,
        image: sanitizeImageDataUrl(partial.image) || '',
      };

      const nextRows = normalizeAllToGrid(cloneRows(rowsRef.current));
      if (!nextRows[cat]) nextRows[cat] = gridifyCategory([]);
      const flat = [].concat(...nextRows[cat]);
      const emptyIdx = flat.indexOf(null);
      if (emptyIdx >= 0) {
        flat[emptyIdx] = nextId;
        const rebuilt = [];
        for (let r = 0; r < GRID_ROWS; r++) {
          rebuilt.push(flat.slice(r * GRID_COLS, (r + 1) * GRID_COLS));
        }
        nextRows[cat] = rebuilt;
      }
      // 빈 슬롯이 없으면 격자에는 안 들어감 (items 만 추가)

      setItems((prev) => [...prev, newItem]);
      setRows(nextRows);
      setMenuItemFs(nextId, newItem);
      writeMenuRowsFs(nextRows);
    },
    [setMenuItemFs, writeMenuRowsFs]
  );

  const addNewItemAt = useCallback(
    (partial = {}, flatIndex = -1) => {
      const currentItems = itemsRef.current;
      const maxId = currentItems.reduce((m, i) => Math.max(m, i.id), 0);
      const nextId = maxId + 1;
      const cat = partial.category || '국수/만백';
      const safeName = sanitizeMenuName(partial.name) || '새 메뉴';
      const safeShort =
        sanitizeMenuShortName(partial.shortName || partial.name) || '새';
      const newItem = {
        id: nextId,
        name: safeName,
        shortName: safeShort,
        price: sanitizeMenuPrice(partial.price),
        color: partial.color || '#9CA3AF',
        category: cat,
        favorite: !!partial.favorite,
        image: sanitizeImageDataUrl(partial.image) || '',
      };

      const nextRows = normalizeAllToGrid(cloneRows(rowsRef.current));
      if (!nextRows[cat]) nextRows[cat] = gridifyCategory([]);
      const grid = [].concat(...nextRows[cat]);
      const placeAt =
        flatIndex >= 0 && flatIndex < grid.length && grid[flatIndex] == null
          ? flatIndex
          : grid.indexOf(null);
      if (placeAt >= 0) {
        grid[placeAt] = nextId;
        const rebuilt = [];
        for (let r = 0; r < GRID_ROWS; r++) {
          rebuilt.push(grid.slice(r * GRID_COLS, (r + 1) * GRID_COLS));
        }
        nextRows[cat] = rebuilt;
      }

      setItems((prev) => [...prev, newItem]);
      setRows(nextRows);
      setMenuItemFs(nextId, newItem);
      writeMenuRowsFs(nextRows);
    },
    [setMenuItemFs, writeMenuRowsFs]
  );

  const deleteItem = useCallback(
    (id) => {
      const nextRows = normalizeAllToGrid(cloneRows(rowsRef.current));
      for (const cat of Object.keys(nextRows)) {
        nextRows[cat] = nextRows[cat].map((row) =>
          row.map((i) => (i === id ? null : i))
        );
      }

      setItems((prev) => prev.filter((m) => m.id !== id));
      setRows(nextRows);
      deleteMenuItemFs(id);
      writeMenuRowsFs(nextRows);
    },
    [deleteMenuItemFs, writeMenuRowsFs]
  );

  const toggleFavorite = useCallback(
    (id) => {
      const target = itemsRef.current.find((m) => m.id === id);
      if (!target) return;
      const newFav = !target.favorite;

      const next = cloneRows(rowsRef.current);
      if (!next['즐겨찾기']) next['즐겨찾기'] = [[]];
      const normalized = normalizeFav(next);
      const grid = [].concat(...normalized['즐겨찾기']);
      const curIdx = grid.indexOf(id);
      if (curIdx >= 0) {
        grid[curIdx] = null;
      } else {
        const emptyIdx = grid.indexOf(null);
        if (emptyIdx >= 0) grid[emptyIdx] = id;
      }
      const rebuilt = [];
      for (let r = 0; r < FAV_ROWS; r++) {
        rebuilt.push(grid.slice(r * FAV_COLS, (r + 1) * FAV_COLS));
      }
      normalized['즐겨찾기'] = rebuilt;

      setItems((prev) =>
        prev.map((m) => (m.id === id ? { ...m, favorite: newFav } : m))
      );
      setRows(normalized);
      writeMenuItemFs(id, { favorite: newFav });
      writeMenuRowsFs(normalized);
    },
    [writeMenuItemFs, writeMenuRowsFs]
  );

  const setCategorySlot = useCallback(
    (category, fromIdx, toIdx) => {
      const cur = rowsRef.current;
      if (
        !cur[category] ||
        fromIdx < 0 ||
        fromIdx >= GRID_TOTAL ||
        toIdx < 0 ||
        toIdx >= GRID_TOTAL ||
        fromIdx === toIdx
      ) {
        return;
      }
      const next = normalizeAllToGrid(cloneRows(cur));
      const grid = [].concat(...next[category]);
      const a = grid[fromIdx];
      if (a == null) return;
      const b = grid[toIdx];
      grid[toIdx] = a;
      grid[fromIdx] = b;
      const rebuilt = [];
      for (let r = 0; r < GRID_ROWS; r++) {
        rebuilt.push(grid.slice(r * GRID_COLS, (r + 1) * GRID_COLS));
      }
      next[category] = rebuilt;
      setRows(next);
      writeMenuRowsFs(next);
    },
    [writeMenuRowsFs]
  );

  const setFavoriteSlot = useCallback(
    (fromIdx, toIdx) => setCategorySlot('즐겨찾기', fromIdx, toIdx),
    [setCategorySlot]
  );

  const swapInCategory = useCallback(
    (category, fromIdx, toIdx) => {
      const cur = rowsRef.current;
      const catRows = cur[category];
      if (!catRows) return;
      const rowLens = catRows.map((r) => r.length);
      const flat = [].concat(...catRows);
      if (
        fromIdx < 0 ||
        fromIdx >= flat.length ||
        toIdx < 0 ||
        toIdx >= flat.length ||
        fromIdx === toIdx
      ) {
        return;
      }
      const swapped = [...flat];
      [swapped[fromIdx], swapped[toIdx]] = [swapped[toIdx], swapped[fromIdx]];
      const rebuilt = [];
      let cursor = 0;
      for (const len of rowLens) {
        rebuilt.push(swapped.slice(cursor, cursor + len));
        cursor += len;
      }
      const next = { ...cur, [category]: rebuilt };
      setRows(next);
      writeMenuRowsFs(next);
    },
    [writeMenuRowsFs]
  );

  const reorderInCategory = useCallback(
    (category, fromIdx, toIdx) => {
      const cur = rowsRef.current;
      const catRows = cur[category];
      if (!catRows) return;
      const rowLens = catRows.map((r) => r.length);
      const flat = [].concat(...catRows);
      if (
        fromIdx < 0 ||
        fromIdx >= flat.length ||
        toIdx < 0 ||
        toIdx >= flat.length ||
        fromIdx === toIdx
      ) {
        return;
      }
      const [moved] = flat.splice(fromIdx, 1);
      flat.splice(toIdx, 0, moved);
      const rebuilt = [];
      let cursor = 0;
      for (const len of rowLens) {
        rebuilt.push(flat.slice(cursor, cursor + len));
        cursor += len;
      }
      const next = { ...cur, [category]: rebuilt };
      setRows(next);
      writeMenuRowsFs(next);
    },
    [writeMenuRowsFs]
  );

  const moveItemInCategory = useCallback(
    (category, id, direction) => {
      const cur = rowsRef.current;
      const catRows = cur[category];
      if (!catRows) return;
      const next = normalizeAllToGrid(cloneRows(cur));
      const grid = [].concat(...next[category]);
      const idx = grid.indexOf(id);
      if (idx < 0) return;
      let target = idx + direction;
      while (target >= 0 && target < grid.length && grid[target] == null) {
        target += direction;
      }
      if (target < 0 || target >= grid.length) return;
      [grid[idx], grid[target]] = [grid[target], grid[idx]];
      const rebuilt = [];
      for (let r = 0; r < GRID_ROWS; r++) {
        rebuilt.push(grid.slice(r * GRID_COLS, (r + 1) * GRID_COLS));
      }
      next[category] = rebuilt;
      setRows(next);
      writeMenuRowsFs(next);
    },
    [writeMenuRowsFs]
  );

  const updateOptionLabel = useCallback(
    (id, label) => {
      const safe = (label || '').slice(0, 12).trim();
      if (!safe) return;
      const next = (editableOptions || []).map((o) =>
        o.id === id ? { ...o, label: safe } : o
      );
      setEditableOptions(next);
      writeEditableOptionsFs(next);
    },
    [editableOptions, writeEditableOptionsFs]
  );

  const moveOption = useCallback(
    (fromIdx, toIdx) => {
      if (
        fromIdx < 0 ||
        fromIdx >= editableOptions.length ||
        toIdx < 0 ||
        toIdx >= editableOptions.length ||
        fromIdx === toIdx
      ) {
        return;
      }
      const next = [...editableOptions];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      setEditableOptions(next);
      writeEditableOptionsFs(next);
    },
    [editableOptions, writeEditableOptionsFs]
  );

  const resetEditableOptions = useCallback(() => {
    const next = defaultEditableOptions.map((o) => ({ ...o }));
    setEditableOptions(next);
    writeEditableOptionsFs(next);
  }, [writeEditableOptionsFs]);

  const optionsList = useMemo(
    () => [...sizeOptions, ...editableOptions],
    [editableOptions]
  );

  const value = useMemo(
    () => ({
      items,
      rows,
      categories,
      optionsList,
      editableOptions,
      updateItem,
      updateItemImage,
      resetItemImage,
      addNewItem,
      addNewItemAt,
      deleteItem,
      toggleFavorite,
      moveItemInCategory,
      reorderInCategory,
      swapInCategory,
      setFavoriteSlot,
      setCategorySlot,
      updateOptionLabel,
      moveOption,
      resetEditableOptions,
    }),
    [
      items,
      rows,
      optionsList,
      editableOptions,
      updateItem,
      updateItemImage,
      resetItemImage,
      addNewItem,
      addNewItemAt,
      deleteItem,
      toggleFavorite,
      moveItemInCategory,
      reorderInCategory,
      swapInCategory,
      setFavoriteSlot,
      setCategorySlot,
      updateOptionLabel,
      moveOption,
      resetEditableOptions,
    ]
  );

  return <MenuContext.Provider value={value}>{children}</MenuContext.Provider>;
}

export function useMenu() {
  const ctx = useContext(MenuContext);
  if (!ctx) throw new Error('useMenu must be used within MenuProvider');
  return ctx;
}
