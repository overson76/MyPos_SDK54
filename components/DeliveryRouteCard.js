// 배달 경로 최적화 카드 — KitchenScreen 의 활성 주문 영역 상단에 마운트.
//
// 동시 배달 2건 이상 + 매장 좌표 + 배달지마다 주소록 좌표 있을 때 활성.
// "🛵 배달 경로 최적화" 버튼 → 카카오 모빌리티 도로 실거리로 그리디 정렬 →
// 최적 순서 + 총 거리·시간 표시.
//
// 카카오 API 일일 무료 한도 5,000건 — 배달 2~5건 묶음에서 거의 영향 없음.

import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { optimizeRoute, formatRouteSummary } from '../utils/routeOptimizer';
import { getDrivingDistance } from '../utils/geocode';
import { normalizeAddressKey } from '../utils/orderHelpers';
import { reportError } from '../utils/sentry';

export default function DeliveryRouteCard({ activeOrders, storeInfo, addressBook }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const candidates = useMemo(() => {
    if (
      !storeInfo ||
      typeof storeInfo.lat !== 'number' ||
      typeof storeInfo.lng !== 'number'
    ) {
      return [];
    }
    const byKey = new Map(
      (addressBook || []).map((a) => [a?.key, a]).filter(([k]) => !!k)
    );
    return (activeOrders || [])
      .filter((o) => o?.table?.type === 'delivery' && !!o.deliveryAddress)
      .map((o) => {
        const key = normalizeAddressKey(o.deliveryAddress);
        const entry = byKey.get(key);
        if (
          !entry ||
          typeof entry.lat !== 'number' ||
          typeof entry.lng !== 'number'
        ) {
          return null;
        }
        return {
          id: o.tableId,
          tableId: o.tableId,
          label: o.table?.label || o.tableId,
          address: o.deliveryAddress,
          lat: entry.lat,
          lng: entry.lng,
        };
      })
      .filter(Boolean);
  }, [activeOrders, storeInfo, addressBook]);

  if (!storeInfo || candidates.length < 2) return null;

  const origin = { lat: storeInfo.lat, lng: storeInfo.lng };

  const handleOptimize = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await optimizeRoute(origin, candidates, getDrivingDistance);
      if (r.order.length === 0 || r.missing === candidates.length) {
        setError('카카오 길찾기 결과 없음 — 좌표 또는 API 키 확인');
      } else {
        setResult(r);
      }
    } catch (e) {
      try {
        reportError(e, { ctx: 'deliveryRoute.optimize' });
      } catch {}
      setError('경로 계산 실패');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>🛵 배달 경로 최적화</Text>
        <Text style={styles.subtitle}>동시 배달 {candidates.length}건</Text>
        <TouchableOpacity
          onPress={handleOptimize}
          disabled={loading}
          style={[styles.button, loading && styles.buttonDisabled]}
          accessibilityLabel="배달 경로 최적화 실행"
        >
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.buttonText}>
              {result ? '다시 계산' : '최적 순서 찾기'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {result && (
        <View style={styles.resultBox}>
          <Text style={styles.resultSummary}>
            총 {formatRouteSummary(result.totalDistanceM, result.totalDurationSec)}
            {result.missing > 0 ? `  · ${result.missing}건 거리 미상` : ''}
          </Text>
          {result.order.map((s, idx) => (
            <View key={s.id} style={styles.stopRow}>
              <Text style={styles.stopOrder}>{idx + 1}</Text>
              <Text style={styles.stopLabel}>{s.label}</Text>
              <Text style={styles.stopAddress} numberOfLines={1}>
                {s.address}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#fb923c',
    borderRadius: 10,
    padding: 12,
    marginHorizontal: 6,
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    fontSize: 14,
    fontWeight: '800',
    color: '#9a3412',
    marginRight: 10,
  },
  subtitle: {
    flex: 1,
    fontSize: 12,
    color: '#7c2d12',
  },
  button: {
    backgroundColor: '#ea580c',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    minWidth: 110,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#fdba74',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  error: {
    color: '#dc2626',
    fontSize: 12,
    marginTop: 8,
    fontWeight: '600',
  },
  resultBox: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#fed7aa',
  },
  resultSummary: {
    fontSize: 13,
    fontWeight: '800',
    color: '#9a3412',
    marginBottom: 8,
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
  },
  stopOrder: {
    fontSize: 14,
    fontWeight: '900',
    color: '#9a3412',
    width: 22,
    textAlign: 'center',
  },
  stopLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111827',
    minWidth: 50,
    marginHorizontal: 8,
  },
  stopAddress: {
    flex: 1,
    fontSize: 12,
    color: '#4b5563',
  },
});
