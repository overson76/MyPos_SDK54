// 배달 테이블 카드 위로 스와이프 → 지도 오버레이 (Leaflet.js + OSM 타일).
// 오버레이 아래로 스와이프 또는 ✕ → 닫기. Fade + 슬라이드 효과.
import { useRef, useState } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import WebView from 'react-native-webview';

// Leaflet.js HTML — 인터넷 연결 시 OSM 타일 로드 (핀치줌/터치 지원).
// 매장(🏪)과 배달지(📍) 마커 두 개, 두 점이 한 화면에 들어오도록 자동 zoom fit.
function buildMapHtml({ storeCoord, deliveryCoord }) {
  const markerLines = [];
  if (storeCoord) {
    markerLines.push(
      `L.marker([${storeCoord.lat},${storeCoord.lng}],{icon:si}).addTo(map).bindPopup('<b>🏪 매장</b>');`
    );
  }
  if (deliveryCoord) {
    markerLines.push(
      `L.marker([${deliveryCoord.lat},${deliveryCoord.lng}],{icon:di}).addTo(map).bindPopup('<b>📍 배달지</b>');`
    );
  }

  let fitCode = '';
  if (storeCoord && deliveryCoord) {
    fitCode = `map.fitBounds([[${storeCoord.lat},${storeCoord.lng}],[${deliveryCoord.lat},${deliveryCoord.lng}]],{padding:[60,60]});`;
  } else if (deliveryCoord) {
    fitCode = `map.setView([${deliveryCoord.lat},${deliveryCoord.lng}],14);`;
  } else if (storeCoord) {
    fitCode = `map.setView([${storeCoord.lat},${storeCoord.lng}],14);`;
  } else {
    // 두 좌표 모두 없으면 서울 중심
    fitCode = `map.setView([37.5665,126.9780],12);`;
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body,#map{width:100%;height:100%;background:#1f2937}
  .leaflet-control-attribution{display:none}
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var map=L.map('map',{zoomControl:true,attributionControl:false});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
var si=L.divIcon({html:'<div style="font-size:30px;line-height:1;filter:drop-shadow(0 2px 4px #0008)">🏪</div>',className:'',iconSize:[34,34],iconAnchor:[17,34]});
var di=L.divIcon({html:'<div style="font-size:30px;line-height:1;filter:drop-shadow(0 2px 4px #0008)">📍</div>',className:'',iconSize:[34,34],iconAnchor:[17,34]});
${markerLines.join('\n')}
${fitCode}
</script>
</body>
</html>`;
}

export default function DeliveryMapSwiper({
  children,
  storeCoord,
  deliveryCoord,
  deliveryAddr,
  distanceLabel,
}) {
  const { width, height } = useWindowDimensions();
  const [mapOpen, setMapOpen] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(60)).current;

  const openMap = () => {
    slideAnim.setValue(60);
    fadeAnim.setValue(0);
    setMapOpen(true);
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 280, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 280, useNativeDriver: true }),
    ]).start();
  };

  const closeMap = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 60, duration: 200, useNativeDriver: true }),
    ]).start(() => setMapOpen(false));
  };

  // 카드 — 위 스와이프만 감지 (tap 은 내부 TouchableOpacity 로 통과)
  const cardPan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        gs.dy < -15 && Math.abs(gs.dy) > Math.abs(gs.dx) * 1.5,
      onPanResponderRelease: (_, gs) => {
        if (gs.dy < -40) openMap();
      },
    })
  ).current;

  // 오버레이 — 아래 스와이프 닫기 (지도 터치와 구분 위해 임계값 크게)
  const mapPan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        gs.dy > 20 && Math.abs(gs.dy) > Math.abs(gs.dx) * 2,
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > 60) closeMap();
      },
    })
  ).current;

  const mapHtml = buildMapHtml({ storeCoord, deliveryCoord });
  const mapDisplayH = height * 0.82;

  return (
    <View {...cardPan.panHandlers} style={styles.wrapper}>
      {children}

      <Modal
        visible={mapOpen}
        transparent
        animationType="none"
        onRequestClose={closeMap}
        statusBarTranslucent
      >
        <Animated.View
          style={[
            styles.overlay,
            { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
          ]}
        >
          {/* 지도 영역 (PanResponder 별도 — 지도 스크롤과 충돌 방지) */}
          <View style={{ width, height: mapDisplayH }}>
            <WebView
              source={{ html: mapHtml }}
              style={{ flex: 1 }}
              originWhitelist={['*']}
              scrollEnabled={false}
              bounces={false}
              javaScriptEnabled
            />
          </View>

          {/* 하단 정보바 — 여기서만 스와이프 닫기 */}
          <View style={styles.infoBar} {...mapPan.panHandlers}>
            <View style={styles.swipeHandle} />
            <Text style={styles.addrText} numberOfLines={1}>
              📍 {deliveryAddr || '주소 없음'}
            </Text>
            {distanceLabel ? (
              <Text style={styles.distText}>📏 {distanceLabel}</Text>
            ) : null}
            <Text style={styles.hint}>정보바를 아래로 쓸어내리면 닫힙니다</Text>
          </View>

          {/* ✕ 버튼 */}
          <TouchableOpacity style={styles.closeBtn} onPress={closeMap} hitSlop={12}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </Animated.View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1 },
  overlay: {
    flex: 1,
    backgroundColor: '#111827',
    justifyContent: 'flex-end',
  },
  infoBar: {
    backgroundColor: '#1f2937',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 14,
    alignItems: 'center',
    gap: 4,
  },
  swipeHandle: {
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#4b5563',
    marginBottom: 8,
  },
  addrText: { color: '#f9fafb', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  distText: { color: '#34d399', fontSize: 15, fontWeight: '700' },
  hint: { color: '#6b7280', fontSize: 11, marginTop: 4 },
  closeBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 18,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
