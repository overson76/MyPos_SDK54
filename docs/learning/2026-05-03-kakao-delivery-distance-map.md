# 배달 거리 계산 + 지도 오버레이 구현 학습 노트

날짜: 2026-05-03  
세션: 배달지 거리(km) 표시 + 🗺️ 지도 스와이프 오버레이

---

## 1. 카카오 Local API

### 발급 순서
1. developers.kakao.com → 앱 생성
2. 앱 설정 → 플랫폼 키 → REST API 키 복사
3. 제품 설정 → **카카오맵** → 사용 ON (필수 — 안 켜면 `NotAuthorizedError`)

### 중요한 발견
- **Static Map REST API 없음** — 카카오맵은 JS SDK 기반. URL 직접 만들면 에러 페이지
- **Local API CORS 허용** (`Access-Control-Allow-Origin: *`) — 클라이언트 직접 호출 가능, Worker 프록시 불필요
- REST API 키: 서버용이지만 클라이언트에서도 카카오맵 활성화 + 도메인 화이트리스트로 사용 가능

### 엔드포인트 2개
```
GET https://dapi.kakao.com/v2/local/search/address.json?query=서울 강남구 테헤란로 152
GET https://dapi.kakao.com/v2/local/search/keyword.json?query=서울시청
Authorization: KakaoAK {REST_API_KEY}
```
- address.json: 정확한 도로명/지번 → 좌표 반환 (`x`=경도, `y`=위도)
- keyword.json: 가게명/자유 키워드 → 더 유연
- **전략**: address 우선, 결과 없으면 keyword 폴백

---

## 2. 하버사인(Haversine) 직선거리

지구는 구체라서 두 좌표의 직선거리는 단순 피타고라스가 아닌 하버사인 공식 사용.

```javascript
// 핵심 수식
const dLat = toRad(b.lat - a.lat);
const dLng = toRad(b.lng - a.lng);
const h = Math.sin(dLat/2)**2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng/2)**2;
const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1-h));
return 6371 * c; // km
```

- 지구 반지름 = 6371 km
- 테스트 검증: 강남 ↔ 송파 ≈ 6.2 km, 서울 ↔ 부산 ≈ 325 km

---

## 3. 배달 거리 표시 구조

```
매장 좌표 (storeInfo.lat/lng)      ← 시스템 탭 매장 주소 설정
       ↕ distanceKm()
배달지 좌표 (addressBook.entries[key].lat/lng)  ← 카카오 API 자동 변환
```

### 좌표 자동 변환 (lazy + fire-and-forget)
- `useAddressBook.js` 에 useEffect 추가
- entries 에 lat 없는 항목 발견 → 카카오 호출 → 결과 저장
- `inFlightRef` (Set): 중복 호출 방지
- `failedRef` (Set): 실패 항목 재시도 방지 (메모리 only, 앱 재시작 시 초기화)

### 표시 위치 2곳
1. **TableScreen 배달 카드** — `📍 서울 송파구 올림픽로 300 · 6.2 km 🗺️`
2. **OrderScreen 배달 헤더** — `📏 6.2 km` (주소 입력 즉시 표시, 디바운스 500ms)

---

## 4. 지도 오버레이 (DeliveryMapModal)

### 기술 선택: Leaflet.js + OpenStreetMap
- 카카오 Static Map API 없음 → 대안 필요
- Leaflet.js: 오픈소스 지도 라이브러리, CDN 로드, 키/도메인 등록 불필요
- OSM 타일: `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png` 무료 무제한
- **핀치줌/터치 지원** 내장

### HTML string 방식
```javascript
const html = `<!DOCTYPE html>
<html>...
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  var map = L.map('map');
  L.tileLayer('https://{s}.tile.openstreetmap.org/...').addTo(map);
  var si = L.divIcon({ html: '🏪', ... });
  var di = L.divIcon({ html: '📍', ... });
  L.marker([storeLat, storeLng], {icon: si}).addTo(map);
  L.marker([deliveryLat, deliveryLng], {icon: di}).addTo(map);
  map.fitBounds([[storeLat, storeLng], [deliveryLat, deliveryLng]], {padding: [60,60]});
</script>`;
```

### 플랫폼별 렌더 분기 (핵심 함정!)
```javascript
{Platform.OS === 'web' ? (
  <iframe srcDoc={mapHtml} style={{ width, height, border: 0 }} />
) : (
  <WebView source={{ html: mapHtml }} />
)}
```
- `react-native-webview`가 **web(Electron 포함)에서 noop** — 아무것도 렌더 안 함
- web 에서는 `<iframe srcDoc>` 직접 사용해야 Leaflet 정상 동작

---

## 5. PanResponder 스와이프 UX

```javascript
PanResponder.create({
  // 수직 위 스와이프만 감지 (tap과 충돌 방지)
  onMoveShouldSetPanResponder: (_, gs) =>
    gs.dy < -15 && Math.abs(gs.dy) > Math.abs(gs.dx) * 1.5,
  onPanResponderRelease: (_, gs) => {
    if (gs.dy < -40) openMap(); // 40px 이상 위로 스와이프
  },
})
```

### 플랫폼별 트리거
- **모바일**: PanResponder 위로 스와이프 (터치)
- **PC/Electron**: 배달 주소 행 🗺️ 클릭 (TouchableOpacity onPress)
- PanResponder는 **마우스 이벤트에서 잘 안 먹힘** → PC에서는 클릭 트리거 별도 필요

### 구조 (최종)
```
TableScreen (mapInfo state)
├── DeliveryMapSwiper — 스와이프 감지 → onSwipeUp 콜백
├── 배달 주소 행 TouchableOpacity — 클릭 → setMapInfo
└── DeliveryMapModal — mapInfo 있으면 표시
```

---

## 6. 환경별 이슈 정리

| 환경 | 이슈 | 원인 | 해결 |
|---|---|---|---|
| Expo Go | `RNFBAppModule not found` | firebase 네이티브 모듈 포함 안 됨 | 개발 빌드 필요 |
| Electron dev | Firebase 연결 안 됨 | 로컬 구 bundle 로드 (env 없음) | 라이브 URL Chrome 직접 접속 |
| Preview(웹) | PanResponder 스와이프 안 됨 | mouse ≠ touch 이벤트 | 클릭 트리거로 테스트 |
| Preview(웹) | WebView 빈 화면 | web에서 noop | iframe 분기로 해결 |

---

## 7. 환경변수 (.env)
```
EXPO_PUBLIC_KAKAO_REST_KEY=...  # 카카오 REST API 키
```
- `EXPO_PUBLIC_*` prefix → Expo 빌드 시 bundle에 inline
- 카카오 REST API 키는 공개 키라 클라이언트 노출 OK (카카오 콘솔 도메인 화이트리스트로 보안)

---

## 8. 변경 파일 목록

| 파일 | 역할 |
|---|---|
| `utils/geocode.js` | 주소→좌표 + 하버사인 거리 + 포맷 + Static Map URL |
| `__tests__/geocode.test.js` | Jest 9개 케이스 |
| `utils/storeOps.js` | `updateStoreAddress` 추가 |
| `utils/StoreContext.js` | storeInfo 에 address/lat/lng 동기화 |
| `components/StoreManagementSection.js` | 매장 주소 카드 + 검색 모달 |
| `utils/useAddressBook.js` | 백그라운드 자동 geocoding effect |
| `screens/TableScreen.js` | 거리 표시 + 🗺️ 클릭 트리거 |
| `screens/OrderScreen.js` | 배달 헤더 즉석 거리 표시 |
| `components/DeliveryMapSwiper.js` | 스와이프 감지 래퍼 |
| `components/DeliveryMapModal.js` | Leaflet 지도 Modal |
