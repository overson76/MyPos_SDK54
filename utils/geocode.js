// 카카오 Local API 로 주소 → 좌표 변환 + 두 좌표 사이 직선거리(하버사인) 계산.
// 정책: 네트워크/키 누락은 조용히 null 반환 — 앱 흐름 절대 중단하지 않음.
// 좌표 단위: lat=위도(y), lng=경도(x). 카카오는 x/y 순으로 응답.

const KAKAO_KEY = process.env.EXPO_PUBLIC_KAKAO_REST_KEY || '';
const BASE = 'https://dapi.kakao.com';
const EARTH_RADIUS_KM = 6371;

export function isGeocodingAvailable() {
  return KAKAO_KEY.length > 0;
}

// 주소 또는 키워드 한 줄 → { lat, lng, formatted } | null
// 1차: address.json (정확한 도로명/지번). 2차: keyword.json (가게명/자유 키워드).
// formatted: 카카오가 인식한 표준 주소/장소명 — 사용자에게 변환 결과 미리보기 표시용.
export async function geocodeAddress(address) {
  if (!KAKAO_KEY) return null;
  const trimmed = String(address ?? '').trim();
  if (!trimmed) return null;

  const addr = await callKakao('/v2/local/search/address.json', trimmed);
  const a = addr?.documents?.[0];
  if (a && a.x && a.y) {
    return {
      lat: parseFloat(a.y),
      lng: parseFloat(a.x),
      formatted: a.road_address?.address_name || a.address_name || trimmed,
    };
  }

  const kw = await callKakao('/v2/local/search/keyword.json', trimmed);
  const k = kw?.documents?.[0];
  if (k && k.x && k.y) {
    return {
      lat: parseFloat(k.y),
      lng: parseFloat(k.x),
      formatted: k.road_address_name || k.place_name || k.address_name || trimmed,
    };
  }

  return null;
}

async function callKakao(path, query) {
  try {
    const url = `${BASE}${path}?query=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { Authorization: `KakaoAK ${KAKAO_KEY}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

// 두 좌표 사이 직선거리(하버사인) 를 km 로 반환. 잘못된 입력이면 null.
export function distanceKm(a, b) {
  if (!isCoord(a) || !isCoord(b)) return null;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_KM * c;
}

function isCoord(p) {
  return (
    p &&
    typeof p.lat === 'number' &&
    typeof p.lng === 'number' &&
    isFinite(p.lat) &&
    isFinite(p.lng) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lng >= -180 &&
    p.lng <= 180
  );
}

// 보기 좋게: 1km 미만은 m 단위, 이상은 소수 1자리 km. 잘못된 입력이면 null.
export function formatDistance(km) {
  if (typeof km !== 'number' || !isFinite(km) || km < 0) return null;
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

// 카카오 Static Map 이미지 URL — 매장(빨간) + 배달지(파란) 마커.
// imgW/imgH: 요청 이미지 픽셀 크기 (카카오 최대 640×640).
// 실제 화면 표시는 <Image resizeMode="cover"> 로 더 크게 확대 가능.
export function buildStaticMapUrl({ storeCoord, deliveryCoord, imgW = 640, imgH = 640 }) {
  if (!KAKAO_KEY) return null;
  if (!isCoord(storeCoord) || !isCoord(deliveryCoord)) return null;

  const cLat = (storeCoord.lat + deliveryCoord.lat) / 2;
  const cLng = (storeCoord.lng + deliveryCoord.lng) / 2;

  const km = distanceKm(storeCoord, deliveryCoord) || 0;
  const level = km < 0.5 ? 2 : km < 1 ? 3 : km < 2 ? 4 : km < 5 ? 5 : km < 10 ? 6 : km < 20 ? 7 : 8;

  const w = Math.min(640, Math.max(100, Math.round(imgW)));
  const h = Math.min(640, Math.max(100, Math.round(imgH)));

  const m1 = encodeURIComponent(`s16,c0xFF4444,t1/${storeCoord.lng},${storeCoord.lat}`);
  const m2 = encodeURIComponent(`s16,c0x4488FF,t2/${deliveryCoord.lng},${deliveryCoord.lat}`);

  return `https://spi.maps.kakao.com/maps/staticmap?appkey=${KAKAO_KEY}&center=${cLng},${cLat}&level=${level}&size=${w}x${h}&markers=${m1}&markers=${m2}`;
}
