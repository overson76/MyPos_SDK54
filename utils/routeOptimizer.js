// 배달 경로 최적화 — 그리디(greedy, 매번 가까운 곳 선택) 알고리즘.
//
// 매장에서 출발해 매번 남은 배달지 중 가장 가까운 곳을 다음 목적지로 선택.
// N×N 페어 거리는 캐싱해서 같은 페어 중복 호출 X — 카카오 API 호출 절약.
//
// 5개 이하 배달 묶음에 충분. 더 많으면 그리디 한계로 최적 보장 X (정책상 경고만).
//
// 매장 카카오 모빌리티 길찾기 API 일일 무료 한도(5,000건) 내에서 안정 동작.

export function pairKey(a, b) {
  return `${a?.lat},${a?.lng}|${b?.lat},${b?.lng}`;
}

// origin: { lat, lng } — 매장 좌표
// stops: [{ id, lat, lng, ... }] — 배달지 목록
// getDistanceFn: async (from, to) => { distanceM, durationSec } | null
//
// 반환:
//   {
//     order: [...stops in optimized order],
//     totalDistanceM: number (매장→1→2→...→마지막),
//     totalDurationSec: number,
//     missing: number (거리 계산 실패한 stop 수, fallback 으로 끝에 추가됨),
//   }
export async function optimizeRoute(origin, stops, getDistanceFn) {
  const empty = {
    order: [],
    totalDistanceM: 0,
    totalDurationSec: 0,
    missing: 0,
  };
  if (!origin || !Array.isArray(stops) || stops.length === 0) return empty;
  if (typeof getDistanceFn !== 'function') {
    return { ...empty, order: [...stops], missing: stops.length };
  }

  const cache = new Map();
  const dist = async (from, to) => {
    const key = pairKey(from, to);
    if (cache.has(key)) return cache.get(key);
    let result;
    try {
      result = await getDistanceFn(from, to);
    } catch (_) {
      result = null;
    }
    cache.set(key, result);
    return result;
  };

  let current = origin;
  const remaining = [...stops];
  const order = [];
  let totalDistanceM = 0;
  let totalDurationSec = 0;
  let missing = 0;

  while (remaining.length > 0) {
    const distances = await Promise.all(
      remaining.map((stop) => dist(current, stop))
    );

    let bestIdx = -1;
    let bestDist = Infinity;
    let bestResult = null;
    for (let i = 0; i < remaining.length; i += 1) {
      const r = distances[i];
      if (!r || typeof r.distanceM !== 'number') continue;
      if (r.distanceM < bestDist) {
        bestDist = r.distanceM;
        bestIdx = i;
        bestResult = r;
      }
    }

    if (bestIdx < 0) {
      // 모든 남은 stop 의 거리 계산 실패 — 남은 순서 그대로 끝에 추가하고 missing 카운트.
      // 카드 UI 가 "거리 미상" 표시하도록 결과는 유실 X.
      for (const r of remaining) {
        order.push(r);
        missing += 1;
      }
      break;
    }

    const next = remaining[bestIdx];
    order.push(next);
    totalDistanceM += bestResult.distanceM;
    totalDurationSec +=
      typeof bestResult.durationSec === 'number' ? bestResult.durationSec : 0;
    current = next;
    remaining.splice(bestIdx, 1);
  }

  return { order, totalDistanceM, totalDurationSec, missing };
}

// "1.5 km · 예상 10분" 같은 한 줄 텍스트.
// 1km 미만은 m, 10km 이상은 정수 km. 시간 0 이면 거리만.
export function formatRouteSummary(totalDistanceM, totalDurationSec) {
  const m = Number(totalDistanceM) || 0;
  const km = m / 1000;
  const kmStr =
    km < 1
      ? `${Math.round(m)} m`
      : km < 10
      ? `${km.toFixed(1)} km`
      : `${Math.round(km)} km`;
  const mins = Math.round((Number(totalDurationSec) || 0) / 60);
  if (mins <= 0) return kmStr;
  return `${kmStr} · 예상 ${mins}분`;
}
