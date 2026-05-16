// DeliveryRouteCard 의 candidates 계산 — 운영에서 한 번도 작동 안 했던 버그 회귀 방지.
// addressBook 객체 형태({ entries: {...} }) 와 배열 형태 둘 다 안전 처리해야 함.

import { buildRouteCandidates } from '../utils/routeCandidates';

const STORE_INFO = {
  storeId: 'demo',
  lat: 35.0844,
  lng: 128.9716,
};

const ACTIVE_ORDERS = [
  {
    tableId: 'd1',
    table: { type: 'delivery', label: '배달1' },
    deliveryAddress: '부산 사하구 하신번영로 200',
  },
  {
    tableId: 'd2',
    table: { type: 'delivery', label: '배달2' },
    deliveryAddress: '부산 사하구 하신번영로 25',
  },
  {
    tableId: 't1',
    table: { type: 'table', label: '1번' }, // 매장 — candidates 제외
    deliveryAddress: null,
  },
  {
    tableId: 'd3',
    table: { type: 'delivery', label: '배달3' },
    deliveryAddress: '부산 사하구 하신번영로 300', // addressBook entry 없음 → 제외
  },
];

const BOOK_OBJECT = {
  entries: {
    '부산 사하구 하신번영로 200': {
      key: '부산 사하구 하신번영로 200',
      lat: 35.09,
      lng: 128.975,
    },
    '부산 사하구 하신번영로 25': {
      key: '부산 사하구 하신번영로 25',
      lat: 35.085,
      lng: 128.972,
    },
  },
};

const BOOK_ARRAY = [
  { key: '부산 사하구 하신번영로 200', lat: 35.09, lng: 128.975 },
  { key: '부산 사하구 하신번영로 25', lat: 35.085, lng: 128.972 },
];

describe('buildRouteCandidates', () => {
  test('addressBook 객체 형태({entries}) — 운영 환경 형태 정상 처리 (회귀 방지)', () => {
    const candidates = buildRouteCandidates(ACTIVE_ORDERS, STORE_INFO, BOOK_OBJECT);
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.tableId).sort()).toEqual(['d1', 'd2']);
    expect(candidates.find((c) => c.tableId === 'd1').lat).toBe(35.09);
  });

  test('addressBook 배열 형태 — 데모/구버전 코드 호환', () => {
    const candidates = buildRouteCandidates(ACTIVE_ORDERS, STORE_INFO, BOOK_ARRAY);
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.tableId).sort()).toEqual(['d1', 'd2']);
  });

  test('매장 좌표 없음 → 빈 배열', () => {
    expect(buildRouteCandidates(ACTIVE_ORDERS, null, BOOK_OBJECT)).toEqual([]);
    expect(buildRouteCandidates(ACTIVE_ORDERS, { lat: null }, BOOK_OBJECT)).toEqual([]);
    expect(
      buildRouteCandidates(ACTIVE_ORDERS, { lat: 35, lng: 'bad' }, BOOK_OBJECT)
    ).toEqual([]);
  });

  test('addressBook 비어있거나 null — 빈 배열', () => {
    expect(buildRouteCandidates(ACTIVE_ORDERS, STORE_INFO, null)).toEqual([]);
    expect(buildRouteCandidates(ACTIVE_ORDERS, STORE_INFO, {})).toEqual([]);
    expect(buildRouteCandidates(ACTIVE_ORDERS, STORE_INFO, { entries: {} })).toEqual([]);
  });

  test('activeOrders 없음 — 빈 배열', () => {
    expect(buildRouteCandidates(null, STORE_INFO, BOOK_OBJECT)).toEqual([]);
    expect(buildRouteCandidates([], STORE_INFO, BOOK_OBJECT)).toEqual([]);
  });

  test('매장 주문(type=table) 은 candidates 에서 제외', () => {
    const orders = [
      {
        tableId: 't1',
        table: { type: 'table', label: '1번' },
        deliveryAddress: '뭐든',
      },
    ];
    expect(buildRouteCandidates(orders, STORE_INFO, BOOK_OBJECT)).toEqual([]);
  });

  test('addressBook entry 의 좌표 누락 — 해당 주문만 제외', () => {
    const book = {
      entries: {
        '부산 사하구 하신번영로 200': {
          key: '부산 사하구 하신번영로 200',
          // lat/lng 없음
        },
        '부산 사하구 하신번영로 25': {
          key: '부산 사하구 하신번영로 25',
          lat: 35.085,
          lng: 128.972,
        },
      },
    };
    const candidates = buildRouteCandidates(ACTIVE_ORDERS, STORE_INFO, book);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].tableId).toBe('d2');
  });

  test('주소 정규화 — 공백 흡수', () => {
    const orders = [
      {
        tableId: 'd1',
        table: { type: 'delivery', label: '배달1' },
        deliveryAddress: '  부산 사하구 하신번영로 200  ',
      },
    ];
    const candidates = buildRouteCandidates(orders, STORE_INFO, BOOK_OBJECT);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].tableId).toBe('d1');
  });

  test('candidate 출력 필드 — id/tableId/label/address/lat/lng 모두 포함', () => {
    const candidates = buildRouteCandidates(ACTIVE_ORDERS, STORE_INFO, BOOK_OBJECT);
    const c = candidates[0];
    expect(c).toHaveProperty('id');
    expect(c).toHaveProperty('tableId');
    expect(c).toHaveProperty('label');
    expect(c).toHaveProperty('address');
    expect(c).toHaveProperty('lat');
    expect(c).toHaveProperty('lng');
  });
});
