export const tables = [
  // Row 1
  { id: 't07', label: '07', type: 'regular' },
  { id: 't08', label: '08', type: 'regular' },
  { id: 't09', label: '09', type: 'regular' },
  { id: 'r10', label: '방10', type: 'regular' },
  { id: 'r11', label: '방11', type: 'regular' },
  // Row 2
  { id: 't04', label: '04', type: 'regular' },
  { id: 't05', label: '05', type: 'regular' },
  { id: 't06', label: '06', type: 'regular' },
  { id: 'y1', label: '예약1', type: 'reservation' },
  { id: 'y2', label: '예약2', type: 'reservation' },
  // Row 3
  { id: 't01', label: '01', type: 'regular' },
  { id: 't02', label: '02', type: 'regular' },
  { id: 't03', label: '03', type: 'regular' },
  { id: 'p1', label: '포장1', type: 'takeout' },
  { id: 'p2', label: '포장2', type: 'takeout' },
  // Row 4 - delivery
  { id: 'd1', label: '배달1', type: 'delivery' },
  { id: 'd2', label: '배달2', type: 'delivery' },
  { id: 'd3', label: '배달3', type: 'delivery' },
  { id: 'd4', label: '배달4', type: 'delivery' },
  { id: 'd5', label: '배달5', type: 'delivery' },
];

export const tableTypeColors = {
  regular: '#3b82f6',
  reservation: '#f59e0b',
  takeout: '#a855f7',
  delivery: '#ef4444',
};

export const tableSubTabs = ['기본홀'];
export const tableActions = ['자리이동', '합석', '단체'];

// 동적 슬롯 prefix → type/label 매핑 (예약/포장/배달은 자동 확장 가능)
export const DYNAMIC_SLOT_PREFIX = {
  y: { type: 'reservation', labelPrefix: '예약' },
  p: { type: 'takeout', labelPrefix: '포장' },
  d: { type: 'delivery', labelPrefix: '배달' },
};

// tableId → 테이블 객체 (정적 tables 우선, 없으면 prefix 기반 동적 슬롯 생성)
// 동적 슬롯: 'y3', 'p4', 'd6' 같은 ID에 대해 자동으로 라벨/타입 부여.
// 분할 슬롯 ('t01#1' 등) 은 호출자가 별도 처리.
export function resolveAnyTable(tableId) {
  if (!tableId) return null;
  const t = tables.find((x) => x.id === tableId);
  if (t) return t;
  const prefix = tableId[0];
  const def = DYNAMIC_SLOT_PREFIX[prefix];
  if (!def) return null;
  const rest = tableId.slice(1);
  if (!/^\d+$/.test(rest)) return null;
  return {
    id: tableId,
    label: `${def.labelPrefix}${rest}`,
    type: def.type,
    dynamic: true,
  };
}
