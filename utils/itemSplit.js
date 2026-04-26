// 장바구니 아이템을 표시용 가상 "행"으로 분해
// - 대 / 보통을 분리해서 각각 별도 행
// - 옵션은 두 행 모두 같은 값(아이템 기준)
// 반환: [{key, baseItem, qty, isLarge, options}]
export function splitItemForDisplay(item) {
  const rows = [];
  const lq = item.largeQty || 0;
  const nq = item.qty - lq;
  const opts = item.options || [];
  if (nq > 0) {
    rows.push({
      key: `${item.id}-n`,
      baseItem: item,
      qty: nq,
      isLarge: false,
      options: opts,
    });
  }
  if (lq > 0) {
    rows.push({
      key: `${item.id}-l`,
      baseItem: item,
      qty: lq,
      isLarge: true,
      options: opts,
    });
  }
  return rows;
}

export function splitItemsForDisplay(items) {
  return (items || []).flatMap((i) => splitItemForDisplay(i));
}
