import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  categories,
  defaultCategoryRows,
  defaultEditableOptions,
  menuItems as defaultMenuItems,
  sizeOptions,
} from './menuData';
import { loadMany, makeDebouncedSaver } from './persistence';
import {
  sanitizeImageDataUrl,
  sanitizeMenuName,
  sanitizeMenuPrice,
  sanitizeMenuShortName,
} from './validate';

const MenuContext = createContext(null);

// 모든 카테고리에 적용되는 격자 규격 (6열 × 4행, 빈 칸은 null)
const GRID_COLS = 6;
const GRID_ROWS = 4;
const GRID_TOTAL = GRID_COLS * GRID_ROWS;
// 하위호환을 위한 별칭
const FAV_COLS = GRID_COLS;
const FAV_ROWS = GRID_ROWS;
const FAV_TOTAL = GRID_TOTAL;

function cloneRows(rows) {
  const out = {};
  for (const cat of Object.keys(rows)) {
    out[cat] = rows[cat].map((row) => [...row]);
  }
  return out;
}

// 단일 카테고리 배열을 GRID_ROWS × GRID_COLS 고정 격자로 정규화.
// 이미 올바른 모양이면 null 위치 그대로 보존, 아니면 앞에서부터 채워넣는다.
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

// 모든 카테고리를 6×4 격자로 정규화. (구버전 비-즐겨찾기 데이터 호환용)
function normalizeAllToGrid(rows) {
  const next = { ...rows };
  for (const cat of Object.keys(next)) {
    next[cat] = gridifyCategory(next[cat]);
  }
  return next;
}

// 하위호환 alias
const normalizeFav = normalizeAllToGrid;

export function MenuProvider({ children }) {
  const [items, setItems] = useState(() =>
    defaultMenuItems.map((m) => ({ ...m }))
  );
  const [rows, setRows] = useState(() =>
    normalizeFav(cloneRows(defaultCategoryRows))
  );
  // 편집 가능한 옵션(면적게 등) — 라벨/순서 변경 가능. 사이즈 옵션과 메모는 별도.
  const [editableOptions, setEditableOptions] = useState(() =>
    defaultEditableOptions.map((o) => ({ ...o }))
  );
  const [hydrated, setHydrated] = useState(false);

  const saver = useMemo(() => makeDebouncedSaver(300), []);

  // 저장된 메뉴/즐겨찾기 hydrate. 없으면 default 유지.
  // 마이그레이션: 옛 데이터에 shortName 이 빠져있으면 defaultMenuItems 에서 보충 →
  // TTS 발화 시 풀이름 대신 약식 이름 정상 사용.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await loadMany(['menu_items', 'menu_rows', 'editable_options']);
      if (cancelled) return;
      if (Array.isArray(data.menu_items) && data.menu_items.length > 0) {
        const defaultByName = new Map(
          defaultMenuItems.map((m) => [m.name, m])
        );
        const defaultById = new Map(
          defaultMenuItems.map((m) => [m.id, m])
        );
        const migrated = data.menu_items.map((m) => {
          const sn = (m.shortName || '').trim();
          if (sn) return m;
          // shortName 누락 → default 에서 같은 id 또는 같은 name 의 shortName 찾아 보충
          const def = defaultById.get(m.id) || defaultByName.get(m.name);
          if (def?.shortName) return { ...m, shortName: def.shortName };
          return m;
        });
        setItems(migrated);
      }
      if (data.menu_rows && typeof data.menu_rows === 'object') {
        setRows(normalizeFav(cloneRows(data.menu_rows)));
      }
      if (
        Array.isArray(data.editable_options) &&
        data.editable_options.length > 0
      ) {
        // 저장된 라벨이 모두 비어있는 등의 비정상 데이터는 거부, 기본값 유지
        const cleaned = data.editable_options
          .filter((o) => o && typeof o.id === 'string')
          .map((o) => ({
            id: o.id,
            label: typeof o.label === 'string' ? o.label : '',
          }));
        if (cleaned.length > 0) setEditableOptions(cleaned);
      }
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (hydrated) saver('menu_items', items);
  }, [items, hydrated, saver]);
  useEffect(() => {
    if (hydrated) saver('menu_rows', rows);
  }, [rows, hydrated, saver]);
  useEffect(() => {
    if (hydrated) saver('editable_options', editableOptions);
  }, [editableOptions, hydrated, saver]);

  const updateItem = useCallback((id, fields) => {
    // 사용자 입력 sanitize — 잘못된 값으로 메뉴가 깨지지 않도록 방어
    const safe = { ...fields };
    if ('name' in safe) safe.name = sanitizeMenuName(safe.name);
    if ('shortName' in safe)
      safe.shortName = sanitizeMenuShortName(safe.shortName);
    if ('price' in safe) safe.price = sanitizeMenuPrice(safe.price);
    setItems((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...safe } : m))
    );
    if (fields.category) {
      setRows((prev) => {
        // 모든 카테고리 격자를 정규화한 뒤, id 를 기존 위치에서 null 로 비우고
        // 새 카테고리의 첫 빈 슬롯에 배치한다. (즐겨찾기 격자는 그대로)
        const next = normalizeAllToGrid(cloneRows(prev));
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
        return next;
      });
    }
  }, []);

  const updateItemImage = useCallback((id, image) => {
    // 너무 큰 이미지나 잘못된 형식이면 무시 (저장 거부)
    const safe = sanitizeImageDataUrl(image);
    if (!safe) return;
    setItems((prev) =>
      prev.map((m) => (m.id === id ? { ...m, image: safe } : m))
    );
  }, []);

  const resetItemImage = useCallback((id) => {
    const orig = defaultMenuItems.find((m) => m.id === id);
    setItems((prev) =>
      prev.map((m) => (m.id === id ? { ...m, image: orig?.image ?? '' } : m))
    );
  }, []);

  const addNewItem = useCallback((partial = {}) => {
    setItems((prev) => {
      const maxId = prev.reduce((m, i) => Math.max(m, i.id), 0);
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
      setRows((prevRows) => {
        const next = normalizeAllToGrid(cloneRows(prevRows));
        if (!next[cat]) next[cat] = gridifyCategory([]);
        const flat = [].concat(...next[cat]);
        const emptyIdx = flat.indexOf(null);
        if (emptyIdx >= 0) {
          flat[emptyIdx] = nextId;
          const rebuilt = [];
          for (let r = 0; r < GRID_ROWS; r++) {
            rebuilt.push(flat.slice(r * GRID_COLS, (r + 1) * GRID_COLS));
          }
          next[cat] = rebuilt;
        }
        // 빈 슬롯이 없으면 추가하지 않음 (격자 용량 초과)
        return next;
      });
      return [...prev, newItem];
    });
  }, []);

  const deleteItem = useCallback((id) => {
    setItems((prev) => prev.filter((m) => m.id !== id));
    setRows((prev) => {
      // 모든 카테고리에서 격자 위치를 보존하면서 id 슬롯을 null 로 비움
      const next = normalizeAllToGrid(cloneRows(prev));
      for (const cat of Object.keys(next)) {
        next[cat] = next[cat].map((row) =>
          row.map((i) => (i === id ? null : i))
        );
      }
      return next;
    });
  }, []);

  const toggleFavorite = useCallback((id) => {
    setItems((prev) =>
      prev.map((m) => (m.id === id ? { ...m, favorite: !m.favorite } : m))
    );
    setRows((prev) => {
      const next = cloneRows(prev);
      if (!next['즐겨찾기']) next['즐겨찾기'] = [[]];
      // 즐겨찾기를 고정 격자로 정규화 후 처리
      const normalized = normalizeFav(next);
      const grid = [].concat(...normalized['즐겨찾기']);
      const curIdx = grid.indexOf(id);
      if (curIdx >= 0) {
        // 즐겨찾기에서 제거 — 해당 슬롯을 null 로 비움
        grid[curIdx] = null;
      } else {
        // 즐겨찾기에 추가 — 첫 번째 빈 슬롯에 배치
        const emptyIdx = grid.indexOf(null);
        if (emptyIdx >= 0) grid[emptyIdx] = id;
        // 모든 슬롯이 차있으면 무시(격자 용량 초과)
      }
      const rebuilt = [];
      for (let r = 0; r < FAV_ROWS; r++) {
        rebuilt.push(grid.slice(r * FAV_COLS, (r + 1) * FAV_COLS));
      }
      normalized['즐겨찾기'] = rebuilt;
      return normalized;
    });
  }, []);

  // 카테고리 격자(6×4) 내에서 from → to 위치로 이동(빈 칸이면 이동, 아니면 교환)
  const setCategorySlot = useCallback((category, fromIdx, toIdx) => {
    setRows((prev) => {
      if (
        !prev[category] ||
        fromIdx < 0 ||
        fromIdx >= GRID_TOTAL ||
        toIdx < 0 ||
        toIdx >= GRID_TOTAL ||
        fromIdx === toIdx
      ) {
        return prev;
      }
      const next = normalizeAllToGrid(cloneRows(prev));
      const grid = [].concat(...next[category]);
      const a = grid[fromIdx];
      // 드래그 시작이 빈 칸이면 아무것도 안함
      if (a == null) return prev;
      const b = grid[toIdx];
      grid[toIdx] = a;
      grid[fromIdx] = b;
      const rebuilt = [];
      for (let r = 0; r < GRID_ROWS; r++) {
        rebuilt.push(grid.slice(r * GRID_COLS, (r + 1) * GRID_COLS));
      }
      next[category] = rebuilt;
      return next;
    });
  }, []);

  // 하위호환: 즐겨찾기 전용 wrapper
  const setFavoriteSlot = useCallback(
    (fromIdx, toIdx) => setCategorySlot('즐겨찾기', fromIdx, toIdx),
    [setCategorySlot]
  );

  // 카테고리 내에서 두 flat 위치를 교환 (drag 한 아이템만 이동, 나머지는 제자리 유지)
  const swapInCategory = useCallback((category, fromIdx, toIdx) => {
    setRows((prev) => {
      const catRows = prev[category];
      if (!catRows) return prev;
      const rowLens = catRows.map((r) => r.length);
      const flat = [].concat(...catRows);
      if (
        fromIdx < 0 ||
        fromIdx >= flat.length ||
        toIdx < 0 ||
        toIdx >= flat.length ||
        fromIdx === toIdx
      ) {
        return prev;
      }
      const swapped = [...flat];
      [swapped[fromIdx], swapped[toIdx]] = [swapped[toIdx], swapped[fromIdx]];
      const rebuilt = [];
      let cursor = 0;
      for (const len of rowLens) {
        rebuilt.push(swapped.slice(cursor, cursor + len));
        cursor += len;
      }
      return { ...prev, [category]: rebuilt };
    });
  }, []);

  // flat index 기준으로 카테고리 내 아이템을 from→to 위치로 재배치 (splice-insert)
  const reorderInCategory = useCallback((category, fromIdx, toIdx) => {
    setRows((prev) => {
      const catRows = prev[category];
      if (!catRows) return prev;
      const rowLens = catRows.map((r) => r.length);
      const flat = [].concat(...catRows);
      if (
        fromIdx < 0 ||
        fromIdx >= flat.length ||
        toIdx < 0 ||
        toIdx >= flat.length ||
        fromIdx === toIdx
      ) {
        return prev;
      }
      const [moved] = flat.splice(fromIdx, 1);
      flat.splice(toIdx, 0, moved);
      const rebuilt = [];
      let cursor = 0;
      for (const len of rowLens) {
        rebuilt.push(flat.slice(cursor, cursor + len));
        cursor += len;
      }
      return { ...prev, [category]: rebuilt };
    });
  }, []);

  // 카테고리 격자(6×4) 안에서 아이템 위치를 앞/뒤로 이동 (direction: -1 앞, +1 뒤).
  // null 슬롯은 건너뛰고 다음 실제 아이템과 자리 바꿈.
  const moveItemInCategory = useCallback((category, id, direction) => {
    setRows((prev) => {
      const catRows = prev[category];
      if (!catRows) return prev;
      const next = normalizeAllToGrid(cloneRows(prev));
      const grid = [].concat(...next[category]);
      const idx = grid.indexOf(id);
      if (idx < 0) return prev;
      let target = idx + direction;
      while (target >= 0 && target < grid.length && grid[target] == null) {
        target += direction;
      }
      if (target < 0 || target >= grid.length) return prev;
      [grid[idx], grid[target]] = [grid[target], grid[idx]];
      const rebuilt = [];
      for (let r = 0; r < GRID_ROWS; r++) {
        rebuilt.push(grid.slice(r * GRID_COLS, (r + 1) * GRID_COLS));
      }
      next[category] = rebuilt;
      return next;
    });
  }, []);

  // 새 메뉴를 지정 카테고리의 특정 위치(flat index)에 삽입
  const addNewItemAt = useCallback((partial = {}, flatIndex = -1) => {
    setItems((prev) => {
      const maxId = prev.reduce((m, i) => Math.max(m, i.id), 0);
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
      setRows((prevRows) => {
        // 격자에서 첫 빈 슬롯에 새 아이템 배치. flatIndex 가 유효하면 그 위치에 우선 배치.
        const next = normalizeAllToGrid(cloneRows(prevRows));
        if (!next[cat]) next[cat] = gridifyCategory([]);
        const grid = [].concat(...next[cat]);
        let placeAt =
          flatIndex >= 0 && flatIndex < grid.length && grid[flatIndex] == null
            ? flatIndex
            : grid.indexOf(null);
        if (placeAt >= 0) {
          grid[placeAt] = nextId;
          const rebuilt = [];
          for (let r = 0; r < GRID_ROWS; r++) {
            rebuilt.push(grid.slice(r * GRID_COLS, (r + 1) * GRID_COLS));
          }
          next[cat] = rebuilt;
        }
        // 빈 슬롯이 없으면 추가하지 않음
        return next;
      });
      return [...prev, newItem];
    });
  }, []);

  // 옵션 편집 (사이즈 제외) — 라벨 변경 / 순서 이동 / 기본값 복원
  const updateOptionLabel = useCallback((id, label) => {
    const safe = (label || '').slice(0, 12).trim();
    if (!safe) return;
    setEditableOptions((prev) =>
      prev.map((o) => (o.id === id ? { ...o, label: safe } : o))
    );
  }, []);

  const moveOption = useCallback((fromIdx, toIdx) => {
    setEditableOptions((prev) => {
      if (
        fromIdx < 0 ||
        fromIdx >= prev.length ||
        toIdx < 0 ||
        toIdx >= prev.length ||
        fromIdx === toIdx
      ) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  }, []);

  const resetEditableOptions = useCallback(() => {
    setEditableOptions(defaultEditableOptions.map((o) => ({ ...o })));
  }, []);

  // 사이즈 + 편집옵션 결합 — OrderScreen / KitchenScreen / 음성합성에서 사용
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
