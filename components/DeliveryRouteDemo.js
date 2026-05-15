// 배달 경로 최적화 시연용 데모 모달.
// 가짜 매장(부산 사하구) + 가짜 배달 4건 + 가짜 주소록 좌표로 카드 작동을 시각화.
// 카카오 API 의존 X — 직선거리 × 1.3 보정 + 30 km/h 가정으로 mock 거리 계산.
// 외부 시연 / 신입 교육 / dev 환경 UI 검증에 사용.

import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DeliveryRouteCard from './DeliveryRouteCard';

// 부산 사하구 하신번영로 근처 — seedAddresses 와 같은 동네.
const DEMO_STORE_INFO = {
  storeId: 'demo-store',
  name: '시연 매장',
  address: '부산 사하구 하신번영로 100',
  lat: 35.0844,
  lng: 128.9716,
};

const DEMO_ACTIVE_ORDERS = [
  {
    tableId: 'd1',
    table: { type: 'delivery', label: '배달1' },
    deliveryAddress: '부산 사하구 하신번영로 200',
    items: [{ name: '칼국수', qty: 1 }],
  },
  {
    tableId: 'd2',
    table: { type: 'delivery', label: '배달2' },
    deliveryAddress: '부산 사하구 하신번영로 25',
    items: [{ name: '비빔밥', qty: 2 }],
  },
  {
    tableId: 'd3',
    table: { type: 'delivery', label: '배달3' },
    deliveryAddress: '부산 사하구 하신번영로 300',
    items: [{ name: '들깨칼국수', qty: 1 }],
  },
  {
    tableId: 'd4',
    table: { type: 'delivery', label: '배달4' },
    deliveryAddress: '부산 사하구 하신번영로 50',
    items: [{ name: '팥칼국수', qty: 1 }],
  },
];

const DEMO_ADDRESS_BOOK = [
  { key: '부산 사하구 하신번영로 200', label: '하신번영로 200', lat: 35.0900, lng: 128.9750 },
  { key: '부산 사하구 하신번영로 25', label: '하신번영로 25', lat: 35.0850, lng: 128.9720 },
  { key: '부산 사하구 하신번영로 300', label: '하신번영로 300', lat: 35.0950, lng: 128.9800 },
  { key: '부산 사하구 하신번영로 50', label: '하신번영로 50', lat: 35.0860, lng: 128.9725 },
];

// 좌표 두 점 사이 직선거리(m) — 카카오 API 없이도 데모 작동.
function haversineM(a, b) {
  const R = 6371000;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// 가짜 거리 함수 — 직선거리에 도로 보정 1.3배, 30 km/h 가정.
// 카카오 API 의존 X. 응답을 살짝 늦춰 로딩 인디케이터도 자연스럽게 보이게.
async function mockDistanceFn(from, to) {
  await new Promise((r) => setTimeout(r, 120));
  const straight = haversineM(from, to);
  const distanceM = Math.round(straight * 1.3);
  const durationSec = Math.round(distanceM / (30 / 3.6));
  return { distanceM, durationSec };
}

export default function DeliveryRouteDemo({ visible, onClose }) {
  if (!visible) return null;

  return (
    <View style={styles.backdrop}>
      <View style={styles.modal}>
        <View style={styles.header}>
          <Text style={styles.title}>🎬 배달 경로 시뮬레이션</Text>
          <Pressable onPress={onClose} accessibilityLabel="닫기">
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>

        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 16 }}>
          <Text style={styles.intro}>
            가짜 데이터로 카드 작동을 시각화합니다. 매장은 부산 사하구, 동시 배달 4건.
            거리는 직선거리 × 1.3 (도로 보정) + 30 km/h 가정. 카카오 API 사용 X.
          </Text>

          <View style={styles.scenario}>
            <Text style={styles.scenarioTitle}>📍 시연 시나리오</Text>
            <Text style={styles.scenarioLine}>
              매장: {DEMO_STORE_INFO.name} · {DEMO_STORE_INFO.address}
            </Text>
            {DEMO_ACTIVE_ORDERS.map((o) => (
              <Text key={o.tableId} style={styles.scenarioLine}>
                · {o.table.label} → {o.deliveryAddress}
              </Text>
            ))}
          </View>

          <DeliveryRouteCard
            activeOrders={DEMO_ACTIVE_ORDERS}
            storeInfo={DEMO_STORE_INFO}
            addressBook={DEMO_ADDRESS_BOOK}
            getDistanceFn={mockDistanceFn}
          />

          <Text style={styles.note}>
            💡 운영 환경에선 카카오 모빌리티 도로 실거리 API 가 자동 호출됩니다.
            동시 배달 2건 이상이고 매장·배달지 좌표가 채워져 있을 때 자동 표시.
          </Text>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    width: '90%',
    maxWidth: 720,
    maxHeight: '90%',
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#9a3412',
  },
  title: {
    fontSize: 15,
    fontWeight: '800',
    color: '#fff',
  },
  close: {
    fontSize: 20,
    color: '#fff',
    paddingHorizontal: 8,
  },
  body: {
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  intro: {
    fontSize: 12,
    color: '#374151',
    lineHeight: 18,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  scenario: {
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  scenarioTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 6,
  },
  scenarioLine: {
    fontSize: 12,
    color: '#374151',
    paddingVertical: 1,
  },
  note: {
    marginTop: 12,
    fontSize: 11,
    color: '#6b7280',
    paddingHorizontal: 4,
    lineHeight: 16,
  },
});
