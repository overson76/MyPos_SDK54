// 배달 지도 오버레이 Modal — Leaflet.js + OSM 타일 + Leaflet Routing Machine 경로.
// 단일 배달: 매장 → 배달지 경로 1개 (주황 선).
// 다중 배달: 매장 → 각 배달지 색깔별 경로 + 번호 마커 + 하단 범례.
// 아래로 스와이프(정보바) 또는 ✕ 버튼으로 닫기.
import { useRef } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';

let WebView = null;
if (Platform.OS !== 'web') {
  try {
    WebView = require('react-native-webview').default;
  } catch (_) {}
}

// 배달지별 색깔 팔레트 (최대 6개, 이후 순환)
const DELIVERY_COLORS = ['#FF7A45', '#3B82F6', '#10B981', '#8B5CF6', '#EF4444', '#F59E0B'];

// deliveries: [{ coord: {lat,lng}, addr: string, label: string, distanceLabel: string }]
// storeCoord: {lat,lng} | null
// mode: 'individual' (default, 매장→각 배달지 별도 색깔별 경로)
//     | 'sequential' (회수 모드 — 매장→1→2→...→N→매장 한 줄 경로, 순회)
function buildMapHtml({ storeCoord, deliveries = [], mode = 'individual' }) {
  const markerLines = [];
  const routeLines = [];
  const allCoords = [];

  if (storeCoord) {
    markerLines.push(
      `var si=L.divIcon({html:'<div style="font-size:28px;line-height:1;filter:drop-shadow(0 2px 4px #0008)">🏪</div>',className:'',iconSize:[34,34],iconAnchor:[17,34]});` +
      `L.marker([${storeCoord.lat},${storeCoord.lng}],{icon:si}).addTo(map).bindPopup('<b>🏪 매장</b>');`
    );
    allCoords.push([storeCoord.lat, storeCoord.lng]);
  }

  // sequential 모드 — 마커 색깔 통일(주황), 경로는 마지막에 한 줄로 그림.
  const sequentialColor = '#FF7A45';

  deliveries.forEach((d, i) => {
    if (!d.coord) return;
    const color =
      mode === 'sequential'
        ? sequentialColor
        : DELIVERY_COLORS[i % DELIVERY_COLORS.length];
    const num = i + 1;
    const safeLabel = (d.label || `배달${num}`).replace(/'/g, "\\'");
    const safeAddr = (d.addr || '').substring(0, 25).replace(/'/g, "\\'");

    markerLines.push(`
      var icon${i}=L.divIcon({
        html:'<div style="background:${color};color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;box-shadow:0 2px 6px rgba(0,0,0,0.5);border:2px solid #fff;">${num}</div>',
        className:'',iconSize:[28,28],iconAnchor:[14,14]
      });
      L.marker([${d.coord.lat},${d.coord.lng}],{icon:icon${i}}).addTo(map)
        .bindPopup('<b style="color:${color}">${safeLabel}</b>${safeAddr ? '<br><span style=\"font-size:11px\">' + '${safeAddr}' + '</span>' : ''}');
    `);
    allCoords.push([d.coord.lat, d.coord.lng]);

    // individual 모드 — 매장 → 각 배달지 별도 색깔 경로 (기존 동작)
    if (mode === 'individual' && storeCoord) {
      routeLines.push(`
        L.Routing.control({
          waypoints:[L.latLng(${storeCoord.lat},${storeCoord.lng}),L.latLng(${d.coord.lat},${d.coord.lng})],
          routeWhileDragging:false,addWaypoints:false,draggableWaypoints:false,
          show:false,fitSelectedRoutes:false,
          lineOptions:{styles:[{color:'${color}',weight:5,opacity:0.85}]},
          createMarker:function(){return null;}
        }).addTo(map);
      `);
    }
  });

  // sequential 모드 — 매장 → 1 → 2 → ... → N → 매장 한 줄 routing (순회).
  // 거리순으로 정렬된 deliveries 기준 라이더 동선 시각화.
  if (mode === 'sequential' && storeCoord) {
    const stops = deliveries.filter((d) => d.coord);
    if (stops.length > 0) {
      const waypoints = [
        `L.latLng(${storeCoord.lat},${storeCoord.lng})`,
        ...stops.map((d) => `L.latLng(${d.coord.lat},${d.coord.lng})`),
        `L.latLng(${storeCoord.lat},${storeCoord.lng})`,
      ];
      routeLines.push(`
        L.Routing.control({
          waypoints:[${waypoints.join(',')}],
          routeWhileDragging:false,addWaypoints:false,draggableWaypoints:false,
          show:false,fitSelectedRoutes:false,
          lineOptions:{styles:[{color:'${sequentialColor}',weight:5,opacity:0.9}]},
          createMarker:function(){return null;}
        }).addTo(map);
      `);
    }
  }

  let fitCode = `map.setView([37.5665,126.9780],12);`;
  if (allCoords.length >= 2) {
    fitCode = `map.fitBounds([${allCoords.map(c => `[${c[0]},${c[1]}]`).join(',')}],{padding:[50,50]});`;
  } else if (allCoords.length === 1) {
    fitCode = `map.setView([${allCoords[0][0]},${allCoords[0][1]}],14);`;
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.css"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body,#map{width:100%;height:100%;background:#1f2937}
  .leaflet-control-attribution,.leaflet-routing-container{display:none}
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.min.js"></script>
<script>
var map=L.map('map',{zoomControl:true,attributionControl:false});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
${markerLines.join('\n')}
${routeLines.join('\n')}
${fitCode}
</script>
</body>
</html>`;
}

// props:
//   storeCoord     — 매장 좌표 {lat,lng} | null
//   deliveries     — 배달지 배열 [{ coord, addr, label, distanceLabel }]
//   visible        — 모달 표시 여부
//   onClose        — 닫기 콜백
//   mode           — 'individual' (default) | 'sequential' (회수 동선)
export default function DeliveryMapModal({
  visible,
  onClose,
  storeCoord,
  deliveries = [],
  mode = 'individual',
}) {
  const { width, height } = useWindowDimensions();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(60)).current;

  const onShow = () => {
    slideAnim.setValue(60);
    fadeAnim.setValue(0);
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 280, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 280, useNativeDriver: true }),
    ]).start();
  };

  const handleClose = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 60, duration: 200, useNativeDriver: true }),
    ]).start(() => onClose?.());
  };

  const infoPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) =>
        gs.dy > 20 && Math.abs(gs.dy) > Math.abs(gs.dx) * 2,
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > 60) handleClose();
      },
    })
  ).current;

  const mapHtml = buildMapHtml({ storeCoord, deliveries, mode });
  const mapDisplayH = height * 0.82;
  const isMulti = deliveries.length > 1;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={handleClose}
      statusBarTranslucent
      onShow={onShow}
    >
      <Animated.View
        style={[styles.overlay, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}
      >
        {/* 지도 */}
        {Platform.OS === 'web' ? (
          <iframe
            srcDoc={mapHtml}
            style={{ width, height: mapDisplayH, border: 0, display: 'block' }}
            title="delivery-map"
          />
        ) : WebView ? (
          <View style={{ width, height: mapDisplayH }}>
            <WebView
              source={{ html: mapHtml }}
              style={{ flex: 1 }}
              originWhitelist={['*']}
              scrollEnabled={false}
              bounces={false}
              javaScriptEnabled
              domStorageEnabled
              mixedContentMode="compatibility"
            />
          </View>
        ) : (
          <View style={[styles.noMap, { width, height: mapDisplayH }]}>
            <Text style={styles.noMapText}>앱을 최신 버전으로 업데이트하면{'\n'}지도를 볼 수 있습니다</Text>
          </View>
        )}

        {/* 하단 정보바 */}
        <View style={styles.infoBar} {...infoPan.panHandlers}>
          <View style={styles.swipeHandle} />
          {isMulti ? (
            // 다중 배달 — 범례 스크롤
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.legendScroll}>
              {deliveries.map((d, i) => {
                if (!d.coord) return null;
                const color = DELIVERY_COLORS[i % DELIVERY_COLORS.length];
                return (
                  <View key={i} style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: color }]}>
                      <Text style={styles.legendNum}>{i + 1}</Text>
                    </View>
                    <Text style={[styles.legendLabel, { color }]} numberOfLines={1}>
                      {d.label || `배달${i + 1}`}
                    </Text>
                    {d.distanceLabel ? (
                      <Text style={styles.legendDist}> {d.distanceLabel}</Text>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>
          ) : (
            // 단일 배달
            <>
              <Text style={styles.addrText} numberOfLines={1}>
                📍 {deliveries[0]?.addr || '주소 없음'}
              </Text>
              {deliveries[0]?.distanceLabel ? (
                <Text style={styles.distText}>📏 {deliveries[0].distanceLabel}</Text>
              ) : null}
            </>
          )}
          <Text style={styles.hint}>정보바를 아래로 쓸어내리면 닫힙니다</Text>
        </View>

        {/* ✕ 버튼 */}
        <TouchableOpacity style={styles.closeBtn} onPress={handleClose} hitSlop={12}>
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#111827', justifyContent: 'flex-end' },
  noMap: { backgroundColor: '#1f2937', alignItems: 'center', justifyContent: 'center' },
  noMapText: { color: '#cbd5e1', fontSize: 16, textAlign: 'center', lineHeight: 24 },
  infoBar: {
    backgroundColor: '#1f2937',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 14,
    alignItems: 'center',
    gap: 4,
  },
  swipeHandle: { width: 44, height: 4, borderRadius: 2, backgroundColor: '#4b5563', marginBottom: 8 },
  addrText: { color: '#f9fafb', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  distText: { color: '#34d399', fontSize: 15, fontWeight: '700' },
  hint: { color: '#6b7280', fontSize: 11, marginTop: 4 },
  closeBtn: {
    position: 'absolute', top: 16, right: 16,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 18,
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
  },
  closeBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  // 다중 배달 범례
  legendScroll: { maxHeight: 40 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: 16 },
  legendDot: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  legendNum: { color: '#fff', fontSize: 11, fontWeight: '800' },
  legendLabel: { fontSize: 13, fontWeight: '700', maxWidth: 80 },
  legendDist: { fontSize: 11, color: '#9ca3af' },
});
