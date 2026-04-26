function keyFor(i) {
  return i.slotId || `m-${i.id}`;
}

export function computeDiffRows(current, confirmed) {
  const confirmedMap = new Map(confirmed.map((i) => [keyFor(i), i]));
  const currentMap = new Map(current.map((i) => [keyFor(i), i]));
  const rows = [];
  for (const item of current) {
    const prev = confirmedMap.get(keyFor(item));
    if (!prev) rows.push({ item, kind: 'added' });
    else if (
      prev.qty !== item.qty ||
      (prev.largeQty || 0) !== (item.largeQty || 0) ||
      (prev.memo || '') !== (item.memo || '') ||
      JSON.stringify(prev.options || []) !==
        JSON.stringify(item.options || [])
    )
      rows.push({ item, kind: 'changed', previousQty: prev.qty, prev });
    else rows.push({ item, kind: 'unchanged' });
  }
  for (const item of confirmed) {
    if (!currentMap.has(keyFor(item)))
      rows.push({ item: { ...item, qty: 0 }, kind: 'removed' });
  }
  return rows;
}
