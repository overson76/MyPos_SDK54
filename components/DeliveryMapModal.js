// 배달 지도 오버레이 Modal — Leaflet.js + OSM 타일.
// 아래로 스와이프(정보바) 또는 ✕ 버튼으로 닫기.
import { useRef } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
// react-native-webview: 네이티브 모듈 — EAS 빌드에만 포함됨.
// 구 빌드 폰에서 OTA 적용 시 크래시 방지 위해 동적 require.
let WebView = null;
if (Platform.OS !== 'web') {
  try {
    WebView = require('react-native-webview').default;
  } catch (_) {
    // 네이티브 모듈 미포함 (구 빌드) — 지도 영역 빈 화면 fallback
  }
}

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

export default function DeliveryMapModal({
  visible,
  onClose,
  storeCoord,
  deliveryCoord,
  deliveryAddr,
  distanceLabel,
}) {
  const { width, height } = useWindowDimensions();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(60)).current;

  // visible 변화에 따라 애니메이션
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

  // 정보바에서 아래 스와이프 → 닫기
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

  const mapHtml = buildMapHtml({ storeCoord, deliveryCoord });
  const mapDisplayH = height * 0.82;

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
        style={[
          styles.overlay,
          { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
        ]}
      >
        {/* 지도 — web/Electron: iframe, 네이티브(EAS 빌드): WebView, 구 빌드: 안내 */}
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
            />
          </View>
        ) : (
          <View style={[styles.noMap, { width, height: mapDisplayH }]}>
            <Text style={styles.noMapText}>
              앱을 최신 버전으로 업데이트하면{'\n'}지도를 볼 수 있습니다
            </Text>
          </View>
        )}

        {/* 하단 정보바 — 여기서 아래 스와이프 닫기 */}
        <View style={styles.infoBar} {...infoPan.panHandlers}>
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
        <TouchableOpacity style={styles.closeBtn} onPress={handleClose} hitSlop={12}>
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
