// 카카오 Local API 로 주소 → 좌표 변환 + 두 좌표 사이 직선거리(하버사인) 계산.
// 정책: 네트워크/키 누락은 조용히 null 반환 — 앱 흐름 절대 중단하지 않음.
// 좌표 단위: lat=위도(y), lng=경도(x). 카카오는 x/y 순으로 응답.

// 2026-05-21 fix: getKakaoKey() 를 *함수 lazy* 로 변경. 옛 코드는 module 최상위 const 라
// babel-preset-expo 의 EXPO_PUBLIC_* inline transformer 가 production 빌드에서 치환을
// 누락 → 라이브 URL 에서 "카카오 KEY 미설정 → 좌표 변환 OFF" 경고 + 모든 카카오 호출
// 무력화 (배달 거리/주소록 변환/회수 정렬 등). Firebase 패턴(utils/firebase.web.js)
// 처럼 *호출 시점에 process.env.X 직접 참조* 가 inline 안전. CLAUDE.md "함정 2" 변종.
const getKakaoKey = () => process.env.EXPO_PUBLIC_KAKAO_REST_KEY || '';
const BASE = 'https://dapi.kakao.com';
const EARTH_RADIUS_KM = 6371;

export function isGeocodingAvailable() {
  return getKakaoKey().length > 0;
}

// 주소 또는 키워드 한 줄 → { lat, lng, formatted } | null
// 1차: address.json (정확한 도로명/지번). 2차: keyword.json (가게명/자유 키워드).
// formatted: 카카오가 인식한 표준 주소/장소명 — 사용자에게 변환 결과 미리보기 표시용.
//
// 2026-05-28: 사장님 사고 "311km 짜리 entry 박힘" 영구 처방.
//   keyword 검색이 *전국 첫 매칭* 을 반환해 수도권 "신한철물"/"GS편의점" 같은
//   동명 가게가 부산 매장 주소록에 박힘 — 배달회수/도착시간 모두 마비.
//   center 옵션 받으면 keyword 검색을 *반경 제한* (searchKeywordNearby) 으로 분기.
//   address.json 1차 결과도 center 기준 검증해 reject.
export async function geocodeAddress(address, opts = {}) {
  if (!getKakaoKey()) return null;
  const trimmed = String(address ?? '').trim();
  if (!trimmed) return null;
  const { center = null, radius = MAX_DELIVERY_RADIUS_KM * 1000 } = opts;

  const addr = await callKakao('/v2/local/search/address.json', trimmed);
  const a = addr?.documents?.[0];
  if (a && a.x && a.y) {
    const result = {
      lat: parseFloat(a.y),
      lng: parseFloat(a.x),
      formatted: a.road_address?.address_name || a.address_name || trimmed,
    };
    if (!center || isCoordNearCenter(result, center, radius / 1000)) {
      return result;
    }
    // 1차 결과가 반경 밖이면 reject — 2차 keyword 검색은 nearby 로 시도.
  }

  // 2차: keyword 검색. center 있으면 nearby (radius 제한), 없으면 옛 동작 (전국).
  if (center) {
    const nearby = await searchKeywordNearby(trimmed, center, radius);
    if (nearby) {
      return {
        lat: nearby.lat,
        lng: nearby.lng,
        formatted: nearby.formatted,
      };
    }
    return null; // 반경 안에서 못 찾음 — 사장님 정책 "주소지 미등록으로 남겨놔야".
  }

  // center 미설정 — 옛 동작 (전국 검색). 호출부가 center 안 주면 검증 책임도 호출부.
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
      headers: { Authorization: `KakaoAK ${getKakaoKey()}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

// 2026-05-25: 별칭(가게명/키워드) → 매장 좌표 반경 내 첫 매칭 장소 검색.
// 사장님 요청: 별칭만 등록 시 자동 주소 검색 — 매장 반경 5km 안에서.
// 못 찾으면 null 반환 (호출부가 pendingAddress 처리).
//
// 입력:
//   - keyword: "진실보석" 같은 가게명/키워드
//   - center: { lat, lng } — 매장 좌표
//   - radius: 미터 (default 5000 = 5km, 카카오 최대 20000)
// 출력: { lat, lng, formatted, name } | null
//   - formatted: 도로명 또는 지번 주소
//   - name: 카카오가 인식한 장소명 (가게명)
export async function searchKeywordNearby(keyword, center, radius = 5000) {
  if (!getKakaoKey()) return null;
  const trimmed = String(keyword ?? '').trim();
  if (!trimmed) return null;
  if (!center || typeof center.lat !== 'number' || typeof center.lng !== 'number') {
    return null;
  }
  const r = Math.max(100, Math.min(20000, Math.round(radius)));

  try {
    const params = new URLSearchParams({
      query: trimmed,
      x: String(center.lng),
      y: String(center.lat),
      radius: String(r),
      sort: 'distance',  // 가까운 순
      size: '5',
    });
    const url = `${BASE}/v2/local/search/keyword.json?${params.toString()}`;
    const res = await fetch(url, {
      headers: { Authorization: `KakaoAK ${getKakaoKey()}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const doc = json?.documents?.[0];
    if (!doc || !doc.x || !doc.y) return null;
    return {
      lat: parseFloat(doc.y),
      lng: parseFloat(doc.x),
      formatted: doc.road_address_name || doc.address_name || trimmed,
      name: doc.place_name || trimmed,
    };
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

// 카카오 모빌리티 길찾기 API (자동차 도로 기준 실거리).
// 같은 KAKAO_REST_KEY 사용 — developers.kakao.com 콘솔에서 "카카오내비" 활성화 필요.
// 무료 쿼터: 일 5,000 요청 (매장 규모 충분).
//
// 매장에서 배달지로 가는 도로 실거리(m) + 예상 소요 시간(초) 반환.
// 실패 / 권한 없음 / 길없음 시 null — 호출부가 graceful fallback.
const NAVI_BASE = 'https://apis-navi.kakaomobility.com';

export function isNaviAvailable() {
  return getKakaoKey().length > 0;
}

// origin, destination: { lat, lng }
// 반환: { distanceM, durationSec } | null
export async function getDrivingDistance(origin, destination) {
  if (!getKakaoKey()) return null;
  if (!isCoord(origin) || !isCoord(destination)) return null;

  const params = new URLSearchParams({
    origin: `${origin.lng},${origin.lat}`,
    destination: `${destination.lng},${destination.lat}`,
    priority: 'RECOMMEND',
    alternatives: 'false',
    road_details: 'false',
  });

  try {
    const res = await fetch(`${NAVI_BASE}/v1/directions?${params.toString()}`, {
      headers: { Authorization: `KakaoAK ${getKakaoKey()}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const route = json?.routes?.[0];
    // result_code: 0=성공, 그 외(101 출발지 부근에 길없음, 102 도착지 부근에 길없음 등)
    if (!route || route.result_code !== 0) return null;
    const distanceM = route?.summary?.distance;
    const durationSec = route?.summary?.duration;
    if (typeof distanceM !== 'number' || distanceM < 0) return null;
    return {
      distanceM,
      durationSec: typeof durationSec === 'number' ? durationSec : null,
    };
  } catch (_) {
    return null;
  }
}

// 거리 m → "도로 1.2 km" / "도로 850 m" 식. distanceKm 와 형식 통일.
export function formatDrivingDistance(m) {
  if (typeof m !== 'number' || !isFinite(m) || m < 0) return null;
  if (m < 1000) return `${Math.round(m)} m`;
  const km = m / 1000;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

// 2026-05-28: 카카오 응답 검증 — 사장님 신고 "엄마선지 300km" / "신한철물 310km" 사고 처방.
// 한 번 잘못 매칭된 좌표/거리가 Firestore 에 박혀 매번 화면에 노출되는 잠복 버그.
// 배달회수 / 도착시간 / 지도 fitBounds 모두 마비.
//
// 임계값 — 사장님 명시 룰 "사업장 기점 반경 5km 이내만 검색, 밖은 주소지 미등록":
//   - 매장 좌표 기준 5 km 직선 반경 = 사장님 운영 정책. 부산 사하구 매장.
//     5 km 넘으면 카카오가 "동명 다른 도시 매장" 으로 잘못 매칭한 것 (수도권 등).
//   - 도로 실거리 10 km = 5km 직선 * 도로 우회 1~2배 여유. 그 이상은 매칭 오류.
//   - 도로/직선 비율 5배 = 도로 우회 일반적으로 직선의 1.3~2배. 5배 넘으면 길찾기 매칭 오류.
export const MAX_DELIVERY_RADIUS_KM = 5;
export const MAX_REASONABLE_DRIVING_KM = 10;
export const MAX_DRIVING_RATIO = 5;

// drivingM 이 합리적 값인지 — entry.drivingM 사용/저장 전 검증.
// straightKm: 매장↔entry 직선거리 (haversine). 모르면 절대 임계만 검사.
export function isDrivingMSane(drivingM, straightKm) {
  if (typeof drivingM !== 'number' || !isFinite(drivingM) || drivingM < 0) {
    return false;
  }
  if (drivingM > MAX_REASONABLE_DRIVING_KM * 1000) return false;
  if (typeof straightKm === 'number' && isFinite(straightKm) && straightKm > 0.1) {
    const drivingKm = drivingM / 1000;
    if (drivingKm > straightKm * MAX_DRIVING_RATIO) return false;
  }
  return true;
}

// entry 좌표가 매장 좌표 기준 합리 반경 내인지 — geocode 결과 저장 전 검증.
// center 미지정/잘못된 좌표면 검증 skip (true 반환) — 매장 좌표 미설정 환경 호환.
export function isCoordNearCenter(coord, center, maxKm = MAX_DELIVERY_RADIUS_KM) {
  if (!isCoord(coord)) return false;
  if (!isCoord(center)) return true;
  const km = distanceKm(center, coord);
  if (km == null) return true;
  return km <= maxKm;
}

// 소요 시간 초 → "12분" / "1시간 5분"
export function formatDuration(sec) {
  if (typeof sec !== 'number' || !isFinite(sec) || sec < 0) return null;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

// 카카오 Static Map 이미지 URL — 매장(빨간) + 배달지(파란) 마커.
// imgW/imgH: 요청 이미지 픽셀 크기 (카카오 최대 640×640).
// 실제 화면 표시는 <Image resizeMode="cover"> 로 더 크게 확대 가능.
export function buildStaticMapUrl({ storeCoord, deliveryCoord, imgW = 640, imgH = 640 }) {
  if (!getKakaoKey()) return null;
  if (!isCoord(storeCoord) || !isCoord(deliveryCoord)) return null;

  const cLat = (storeCoord.lat + deliveryCoord.lat) / 2;
  const cLng = (storeCoord.lng + deliveryCoord.lng) / 2;

  const km = distanceKm(storeCoord, deliveryCoord) || 0;
  const level = km < 0.5 ? 2 : km < 1 ? 3 : km < 2 ? 4 : km < 5 ? 5 : km < 10 ? 6 : km < 20 ? 7 : 8;

  const w = Math.min(640, Math.max(100, Math.round(imgW)));
  const h = Math.min(640, Math.max(100, Math.round(imgH)));

  const m1 = encodeURIComponent(`s16,c0xFF4444,t1/${storeCoord.lng},${storeCoord.lat}`);
  const m2 = encodeURIComponent(`s16,c0x4488FF,t2/${deliveryCoord.lng},${deliveryCoord.lat}`);

  return `https://spi.maps.kakao.com/maps/staticmap?appkey=${getKakaoKey()}&center=${cLng},${cLat}&level=${level}&size=${w}x${h}&markers=${m1}&markers=${m2}`;
}
