import { Platform } from 'react-native';
import * as Speech from 'expo-speech';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { formatKorean12h, parseDeliveryTime } from './timeUtil';
import { triggerSharedAudio, registerLocalDispatch } from './sharedAudio';
import { isAzureConfigured, azureSpeak, cancelAzureSpeech } from './azureTts';

const isWeb = Platform.OS === 'web';

// 웹 전용 API 가용성 — 네이티브에서는 항상 false
const hasWebAudio =
  isWeb &&
  typeof window !== 'undefined' &&
  (window.AudioContext || window.webkitAudioContext);
const hasWebSpeech =
  isWeb && typeof window !== 'undefined' && !!window.speechSynthesis;

// ===== 사운드 ====================================================
// 웹: Web Audio API 로 사인파 톤 생성 (assets/sounds/*.wav 와 동일한 시퀀스)
// 네이티브: assets/sounds/ 의 번들 WAV 를 expo-audio 로 재생

function playToneWeb(freq, dur, when = 0, vol = 0.2) {
  if (!hasWebAudio) return;
  // 볼륨 0 이면 아예 재생 생략 (exponentialRampToValueAtTime 가 0 을 못 받음)
  const scaledVol = vol * _volume;
  if (scaledVol <= 0) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = freq;
    const start = ctx.currentTime + when;
    gain.gain.setValueAtTime(0.001, start);
    gain.gain.exponentialRampToValueAtTime(scaledVol, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, start + dur / 1000);
    osc.start(start);
    osc.stop(start + dur / 1000 + 0.05);
    setTimeout(() => {
      try {
        ctx.close();
      } catch (e) {}
    }, (when + dur / 1000) * 1000 + 400);
  } catch (e) {}
}

// ===== 개인정보 (배달 주소 음성 안내) =====================================
// 기본 OFF — 매장 스피커로 고객 주소가 흘러나가는 사고 방지. 관리자가 명시적으로 켤 때만 음성 안내.
let _speakAddress = false;
export function getSpeakAddress() {
  return _speakAddress;
}
export function setSpeakAddress(on) {
  _speakAddress = !!on;
}

// ===== 볼륨 (0..1) =================================================
// notify.js 가 단일 진실 소스. UI 는 setVolume() 으로 갱신, AsyncStorage 영속화는 호출부 책임.
let _volume = 1.0;
function clamp01(v) {
  const n = Number(v);
  if (!isFinite(n)) return 1.0;
  return Math.max(0, Math.min(1, n));
}
export function getVolume() {
  return _volume;
}
export function setVolume(v) {
  _volume = clamp01(v);
  // 네이티브 사운드 플레이어들에 즉시 반영
  if (!isWeb) {
    for (const key of Object.keys(nativeSounds)) {
      const p = nativeSounds[key];
      if (!p) continue;
      try {
        p.volume = _volume;
      } catch (e) {}
    }
  }
}

// 앱 부팅 시 1회 호출 — iOS 무음 스위치를 무시하고 알림이 항상 나오도록 audio session 구성.
// 안드로이드는 설정 자체가 no-op지만 동일 API로 안전하게 호출 가능.
let audioSessionConfigured = false;
// iOS 한국어 voice 자동 선택 — Enhanced/Premium 우선
let _nativeVoiceId = null;
async function selectBestNativeVoice() {
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    if (!voices || !voices.length) return null;
    // 한국어 voice 만 추리고 quality 우선 정렬
    const korean = voices.filter(
      (v) => v.language === 'ko-KR' || (v.language || '').startsWith('ko')
    );
    if (!korean.length) return null;
    const qualityScore = (q) => {
      if (q === 'Enhanced') return 3; // Premium / Enhanced
      if (q === 'Default') return 2;
      return 1;
    };
    korean.sort((a, b) => qualityScore(b.quality) - qualityScore(a.quality));
    return korean[0]?.identifier || null;
  } catch (e) {
    return null;
  }
}

export async function setupAudioSession() {
  if (isWeb || audioSessionConfigured) return;
  audioSessionConfigured = true;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      // doNotMix: 다른 앱 audio 가 우리 TTS 를 interrupt 못 하게 (간헐적 끊김 방지)
      interruptionMode: 'doNotMix',
      allowsRecording: false,
      // background 짧은 진입(알림/제스처) 에도 audio 유지 → 끊김 회복력
      shouldPlayInBackground: true,
      shouldRouteThroughEarpiece: false,
    });
  } catch (e) {}
  // 가장 자연스러운 한국어 voice 선택 + TTS 엔진 워밍업.
  // iOS AVSpeechSynthesizer 가 첫 호출 시 audio session activate 로 ~200ms 끊김 발생 →
  // 무음 짧은 utterance 를 미리 발화해 엔진 ready 상태로 만듦.
  try {
    _nativeVoiceId = await selectBestNativeVoice();
  } catch (e) {}
  try {
    Speech.speak(' ', {
      language: 'ko-KR',
      volume: 0.001,
      rate: 1.0,
      voice: _nativeVoiceId || undefined,
    });
  } catch (e) {}
}

const nativeSounds = {};
let nativeSoundsLoaded = false;
// 사운드 재생 직후 TTS 발화 시 iOS audio session 에서 race 발생 — 사운드 끝난 후 발화하도록 추적
let lastSoundAt = 0;
const SOUND_TAIL_MS = 800; // 사운드 길이(~440ms) + 여유 + iOS audio session 안정 시간

function ensureNativeSounds() {
  if (isWeb || nativeSoundsLoaded) return;
  nativeSoundsLoaded = true;
  // require() 는 정적 분석 대상이라 키마다 리터럴로 호출
  const init = (key, source) => {
    try {
      const p = createAudioPlayer(source);
      try {
        p.volume = _volume;
      } catch (e) {}
      nativeSounds[key] = p;
    } catch (e) {}
  };
  init('order', require('../assets/sounds/order.wav'));
  init('change', require('../assets/sounds/change.wav'));
  init('ready', require('../assets/sounds/ready.wav'));
  init('delivery', require('../assets/sounds/delivery.wav'));
}

function playNativeSound(key) {
  if (isWeb) return;
  if (_volume <= 0) return;
  ensureNativeSounds();
  const p = nativeSounds[key];
  if (!p) return;
  try {
    p.volume = _volume;
  } catch (e) {}
  try {
    p.seekTo(0);
  } catch (e) {}
  try {
    p.play();
    lastSoundAt = Date.now();
  } catch (e) {}
}

// _do* 는 본인 기기 실제 재생용 (private). entry 함수는 trigger 호출 → 모든 매장 멤버 동시 재생.
function _doPlayOrderSound() {
  if (isWeb) {
    playToneWeb(660, 120, 0);
    playToneWeb(880, 180, 0.13);
  } else {
    playNativeSound('order');
  }
}

function _doPlayChangeSound() {
  if (isWeb) {
    playToneWeb(520, 90, 0, 0.22);
    playToneWeb(700, 90, 0.1, 0.22);
    playToneWeb(920, 160, 0.2, 0.25);
  } else {
    playNativeSound('change');
  }
}

function _doPlayReadySound() {
  if (isWeb) {
    playToneWeb(784, 110, 0);
    playToneWeb(988, 110, 0.11);
    playToneWeb(1319, 220, 0.22);
  } else {
    playNativeSound('ready');
  }
}

function _doPlayDeliveryAlertSound() {
  if (isWeb) {
    playToneWeb(880, 150, 0, 0.25);
    playToneWeb(1175, 150, 0.17, 0.25);
    playToneWeb(880, 150, 0.34, 0.25);
    playToneWeb(1175, 250, 0.51, 0.28);
  } else {
    playNativeSound('delivery');
  }
}

export function playOrderSound() {
  triggerSharedAudio({ type: 'sound', sound: 'order' });
}
export function playChangeSound() {
  triggerSharedAudio({ type: 'sound', sound: 'change' });
}
export function playReadySound() {
  triggerSharedAudio({ type: 'sound', sound: 'ready' });
}
export function playDeliveryAlertSound() {
  triggerSharedAudio({ type: 'sound', sound: 'delivery' });
}

// ===== 고품질 음성 선택 (웹) ======================================

let cachedWebVoice = null;
let voicesInitialized = false;

function rankVoice(v) {
  if (!v || !v.lang) return -1;
  if (v.lang === 'ko-KR') return 100;
  if (v.lang.startsWith('ko')) return 50;
  return -1;
}

function pickBestWebVoice() {
  if (!hasWebSpeech) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  let best = null;
  let bestScore = -1;
  for (const v of voices) {
    const s = rankVoice(v);
    if (s > bestScore) {
      bestScore = s;
      best = v;
    }
  }
  return best;
}

function ensureWebVoices() {
  if (!hasWebSpeech || voicesInitialized) return;
  voicesInitialized = true;
  window.speechSynthesis.getVoices();
  cachedWebVoice = pickBestWebVoice();
  window.speechSynthesis.onvoiceschanged = () => {
    cachedWebVoice = pickBestWebVoice();
  };
}

function getWebVoice() {
  if (!cachedWebVoice) ensureWebVoices();
  return cachedWebVoice;
}

if (hasWebSpeech) ensureWebVoices();

// ===== 낭독 ====================================================
// rate 는 플랫폼별로 자연스러운 default 가 다름:
// - iOS: 0.0~1.0 범위, 0.5 가 normal speed (이전 0.95 는 max에 가까워 끊김 발생)
// - Android: 0.5~2.0 범위, 1.0 이 normal
function getNativeRate() {
  if (Platform.OS === 'ios') return 0.5;
  if (Platform.OS === 'android') return 1.0;
  return 1.0;
}

// _speakingNow: 현재 TTS 발화 중인지 추적. 불필요한 cancelSpeech (Speech.stop) 호출 방지.
let _speakingNow = false;

function nativeSpeakNow(text) {
  try {
    Speech.speak(text, {
      language: 'ko-KR',
      voice: _nativeVoiceId || undefined,
      rate: getNativeRate(),
      pitch: 1.0,
      volume: _volume,
      onStart: () => {
        _speakingNow = true;
        // eslint-disable-next-line no-console
        console.log('[TTS] start:', text.slice(0, 40));
      },
      onDone: () => {
        _speakingNow = false;
        // eslint-disable-next-line no-console
        console.log('[TTS] done:', text.slice(0, 40));
      },
      onStopped: () => {
        _speakingNow = false;
        // eslint-disable-next-line no-console
        console.log('[TTS] stopped:', text.slice(0, 40));
      },
      onError: (e) => {
        _speakingNow = false;
        // eslint-disable-next-line no-console
        console.log('[TTS] error:', e?.message || e, '|', text.slice(0, 40));
      },
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log('[TTS] throw:', e?.message || e);
  }
}

function rawSpeak(text, _opts = {}) {
  if (!text) return;
  if (_volume <= 0) return;

  // Azure TTS 설정됐으면 우선 시도. 실패 시 시스템 TTS 폴백.
  if (isAzureConfigured()) {
    azureSpeak(text, _volume).then((ok) => {
      if (!ok) _rawSpeakSystem(text);
    }).catch(() => _rawSpeakSystem(text));
    return;
  }
  _rawSpeakSystem(text);
}

function _rawSpeakSystem(text) {
  if (isWeb) {
    if (!hasWebSpeech) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    u.rate = 0.95;
    u.pitch = 1.0;
    u.volume = _volume;
    const v = getWebVoice();
    if (v) u.voice = v;
    window.speechSynthesis.speak(u);
    return;
  }
  // 네이티브: 사운드 재생 직후라면 SOUND_TAIL_MS 대기 후 발화
  // (iOS audio session 충돌 회피)
  const elapsedSinceSound = Date.now() - lastSoundAt;
  const wait = Math.max(0, SOUND_TAIL_MS - elapsedSinceSound);
  if (wait > 0) {
    setTimeout(() => nativeSpeakNow(text), wait);
  } else {
    nativeSpeakNow(text);
  }
}

function cancelSpeech() {
  cancelAzureSpeech();
  if (isWeb) {
    if (hasWebSpeech) window.speechSynthesis.cancel();
  } else {
    // 실제로 발화 중일 때만 stop — 빈 stop 호출이 race 일으키는 것 방지
    if (_speakingNow) {
      try {
        Speech.stop();
      } catch (e) {}
      _speakingNow = false;
    }
  }
}

// ===== 숫자를 자연스러운 한국어 수사로 변환 ============================

const COUNTERS = {
  1: '한',
  2: '두',
  3: '세',
  4: '네',
  5: '다섯',
  6: '여섯',
  7: '일곱',
  8: '여덟',
  9: '아홉',
  10: '열',
};

function koreanCount(n) {
  return COUNTERS[n] || String(n);
}

function tableSpokenLabel(label) {
  if (!label) return '';
  if (/^\d+$/.test(label)) return `${label}번`;
  return label;
}

function shorten(menu, item) {
  // 1순위: 메뉴에 명시된 shortName (예: "동지팥죽(밥알+새알)" → "동지")
  const sn = (menu?.shortName || '').trim();
  if (sn) return sn;
  // 2순위: 풀이름에서 괄호 부분 자동 제거 (shortName 빠진 경우 fallback)
  // "동지팥죽(밥알+새알)" → "동지팥죽"
  const fullName = menu?.name || item?.name || '';
  const stripped = fullName.replace(/[(（][^)）]*[)）]/g, '').trim();
  return stripped || fullName;
}

function itemsSentence(items, menuItems, optionsList = []) {
  const parts = [];
  items.forEach((i) => {
    const m = menuItems.find((mm) => mm.id === i.id);
    const shortName = shorten(m, i);
    const lq = i.largeQty || 0;
    const normalQty = i.qty - lq;

    const slotOptions = (i.options || [])
      .map((oid) => optionsList.find((o) => o.id === oid))
      .filter((o) => o && !o.sizeGroup)
      .map((o) => o.label);
    const optSuffix =
      slotOptions.length > 0 ? ` ${slotOptions.join(' ')}` : '';

    if (lq === 0) {
      parts.push(`${shortName} ${koreanCount(i.qty)} 개${optSuffix}`);
      return;
    }
    if (lq === i.qty) {
      parts.push(`${shortName}대 ${koreanCount(i.qty)} 개${optSuffix}`);
      return;
    }
    parts.push(`${shortName}대 ${koreanCount(lq)} 개${optSuffix}`);
    parts.push(`${shortName}보통 ${koreanCount(normalQty)} 개${optSuffix}`);
  });
  return parts.join(', ');
}

function optionsSentence(optionIds, optionsList) {
  return optionIds
    .map((id) => optionsList.find((o) => o.id === id)?.label)
    .filter(Boolean)
    .join(', ');
}

// ===== 친근한 멘트 ===============================================

// Android TTS 엔진은 빠른 연속 Speech.speak 호출 시 일부를 드랍하거나 끊는 경향이 있음.
// 모든 sub-멘트를 하나의 문자열로 합쳐 1회 호출 → 끊김 방지.
function joinSpeech(parts) {
  return parts.filter(Boolean).map((s) => s.trim()).join(' ');
}

export function speakOrder({ table, order, menuItems, optionsList }) {
  cancelSpeech();
  const name = tableSpokenLabel(table.label);
  const itemsText = itemsSentence(order.items, menuItems, optionsList);
  const opts = optionsSentence(order.options || [], optionsList);
  const isDelivery = table.type === 'delivery';
  // 개인정보 보호: 토글 OFF면 주소를 음성으로 안 읽음 (화면에는 그대로 표시)
  const addr = _speakAddress ? (order.deliveryAddress || '').trim() : '';

  const parts = [];
  parts.push(
    isDelivery ? `${name}, 배달 주문 들어왔습니다.` : `${name}, 주문 들어왔습니다.`
  );
  if (itemsText) parts.push(`${itemsText} 입니다.`);
  if (opts) {
    parts.push('특별 요청이 있어요.');
    parts.push(`${opts} 부탁드립니다.`);
  }
  if (isDelivery) {
    const parsed = parseDeliveryTime(
      order?.deliveryTime,
      order?.deliveryTimeIsPM
    );
    const timePart = parsed ? `${formatKorean12h(parsed)}까지` : '';
    if (addr && timePart) parts.push(`배달지는 ${addr} ${timePart} 입니다.`);
    else if (addr) parts.push(`배달지는 ${addr} 입니다.`);
    else if (timePart) parts.push(`${timePart} 부탁드립니다.`);
  }
  const text = joinSpeech(parts);
  if (text) triggerSharedAudio({ type: 'speak', text });
}

export function speakOrderChange({
  table,
  diff,
  menuItems,
  order,
  optionsList = [],
}) {
  cancelSpeech();
  const name = tableSpokenLabel(table.label);
  const isDelivery = table.type === 'delivery';
  const addr = _speakAddress ? (order?.deliveryAddress || '').trim() : '';

  const added = diff.filter((r) => r.kind === 'added');
  const changed = diff.filter((r) => r.kind === 'changed');
  const removed = diff.filter((r) => r.kind === 'removed');

  // 옵션 ID 배열 → 라벨 배열 (sizeGroup 옵션은 제외 — 보통/대 같은 사이즈 옵션은 별도 처리)
  const optLabels = (ids) =>
    (ids || [])
      .map((oid) => optionsList.find((o) => o.id === oid))
      .filter((o) => o && !o.sizeGroup)
      .map((o) => o.label);

  const parts = [];
  parts.push(
    isDelivery ? `${name}, 배달 주문 변경입니다.` : `${name}, 주문 변경입니다.`
  );
  if (added.length > 0) {
    const addedItems = added.map((r) => r.item);
    // 옵션까지 정확히 읽히도록 실제 optionsList 전달
    parts.push(`${itemsSentence(addedItems, menuItems, optionsList)} 추가요.`);
  }
  if (changed.length > 0) {
    const changeTexts = changed.map((r) => {
      const m = menuItems.find((mm) => mm.id === r.item.id);
      const name = shorten(m, r.item);
      const qtyChanged = r.previousQty !== r.item.qty;
      // 옵션 비교
      const oldOpts = [...(r.prev?.options || [])].sort();
      const newOpts = [...(r.item.options || [])].sort();
      const optsChanged =
        JSON.stringify(oldOpts) !== JSON.stringify(newOpts);
      const newLabels = optLabels(newOpts);
      // 사이즈(대) 비교 — largeQty 필드는 options 배열과 별개
      const oldLarge = r.prev?.largeQty || 0;
      const newLarge = r.item.largeQty || 0;
      const sizeChanged = oldLarge !== newLarge;

      const segments = [name];
      if (qtyChanged) {
        segments.push(
          `${koreanCount(r.previousQty)} 개에서 ${koreanCount(r.item.qty)} 개로`
        );
      }
      if (sizeChanged) {
        if (oldLarge === 0 && newLarge > 0) {
          segments.push(`${koreanCount(newLarge)} 개 대로`);
        } else if (oldLarge > 0 && newLarge === 0) {
          segments.push('대 취소');
        } else {
          segments.push(
            `대 ${koreanCount(oldLarge)} 개에서 ${koreanCount(newLarge)} 개로`
          );
        }
      }
      if (optsChanged) {
        // "옵션" 단어 없이 추가/제거된 옵션 라벨만 정확히 발화
        const oldSet = new Set(oldOpts);
        const newSet = new Set(newOpts);
        const addedLabels = optLabels(newOpts.filter((o) => !oldSet.has(o)));
        const removedLabels = optLabels(
          oldOpts.filter((o) => !newSet.has(o))
        );
        if (addedLabels.length > 0) {
          segments.push(`${addedLabels.join(' ')} 추가`);
        }
        if (removedLabels.length > 0) {
          segments.push(`${removedLabels.join(' ')} 제거`);
        }
      }
      return segments.join(' ');
    });
    parts.push(`${changeTexts.join(', ')} 변경 부탁드려요.`);
  }
  if (removed.length > 0) {
    const text = removed
      .map((r) => {
        const m = menuItems.find((mm) => mm.id === r.item.id);
        return shorten(m, r.item);
      })
      .join(', ');
    parts.push(`${text} 취소 부탁드립니다.`);
  }
  if (isDelivery) {
    const parsed = parseDeliveryTime(
      order?.deliveryTime,
      order?.deliveryTimeIsPM
    );
    const timePart = parsed ? `${formatKorean12h(parsed)}까지` : '';
    if (addr && timePart) parts.push(`배달지는 ${addr} ${timePart} 입니다.`);
    else if (addr) parts.push(`배달지는 ${addr} 입니다.`);
    else if (timePart) parts.push(`${timePart} 부탁드립니다.`);
  }
  const text = joinSpeech(parts);
  if (text) triggerSharedAudio({ type: 'speak', text });
}

export function speakDeliveryAlert({ table, minutesLeft, address }) {
  cancelSpeech();
  const name = tableSpokenLabel(table.label);
  const mins = Math.max(0, Math.round(minutesLeft || 0));
  const parts = [
    `${name}, 배달 출발 ${mins > 0 ? mins + '분 전' : '시간'}입니다.`,
  ];
  if (_speakAddress && address) parts.push(`배달지는 ${address} 입니다.`);
  const text = joinSpeech(parts);
  if (text) triggerSharedAudio({ type: 'speak', text });
}

// 1.0.44: 예약 시각 10/5분 전 알림. 매장 손님 자리 점유 안내 — 주소 미사용.
export function speakReservationAlert({ table, minutesLeft }) {
  cancelSpeech();
  const name = tableSpokenLabel(table.label);
  const mins = Math.max(0, Math.round(minutesLeft || 0));
  const text = `${name}, 예약 시각 ${mins > 0 ? mins + '분 전' : '시간'}입니다.`;
  triggerSharedAudio({ type: 'speak', text });
}

// 1.0.44: 포장 픽업 시각 10/5분 전 알림. 주방 준비/픽업 안내 — 주소 미사용.
export function speakTakeoutAlert({ table, minutesLeft }) {
  cancelSpeech();
  const name = tableSpokenLabel(table.label);
  const mins = Math.max(0, Math.round(minutesLeft || 0));
  const text = `${name}, 포장 픽업 ${mins > 0 ? mins + '분 전' : '시간'}입니다.`;
  triggerSharedAudio({ type: 'speak', text });
}

export function speakPartialReady({ table, itemName }) {
  cancelSpeech();
  const name = tableSpokenLabel(table.label);
  triggerSharedAudio({ type: 'speak', text: `${name}, ${itemName} 먼저 나왔습니다.` });
}

export function speakFullReady({ table }) {
  cancelSpeech();
  const name = tableSpokenLabel(table.label);
  triggerSharedAudio({ type: 'speak', text: `${name}, 조리 완료됐습니다.` });
}

export function speakReady({ table, order, menuItems, optionsList = [] }) {
  cancelSpeech();
  const name = tableSpokenLabel(table.label);
  const itemsText = itemsSentence(order.items, menuItems, optionsList);
  const isDelivery = table.type === 'delivery';
  const addr = _speakAddress ? (order?.deliveryAddress || '').trim() : '';

  const parts = [`${name}, 조리 완료됐어요.`];
  if (itemsText) parts.push(`${itemsText} 나갑니다.`);
  if (isDelivery) {
    const parsed = parseDeliveryTime(
      order?.deliveryTime,
      order?.deliveryTimeIsPM
    );
    const timePart = parsed ? `${formatKorean12h(parsed)}까지` : '';
    if (addr && timePart) parts.push(`배달지는 ${addr} ${timePart} 입니다.`);
    else if (addr) parts.push(`배달지는 ${addr} 입니다.`);
    else if (timePart) parts.push(`${timePart} 부탁드립니다.`);
  }
  const text = joinSpeech(parts);
  if (text) triggerSharedAudio({ type: 'speak', text });
}

// CID 착신 TTS — 별칭 우선, 없으면 _speakAddress ON 시 주소.
// 별칭은 사장님이 직접 입력한 단어라 speakAddress 토글과 무관하게 항상 읽음.
export function speakIncomingCid({ alias, address }) {
  const text = alias || (_speakAddress ? (address || '').trim() : '');
  if (!text) return;
  triggerSharedAudio({ type: 'speak', text });
}

// 운영 시작 전 점검용: 톤 + TTS 가 함께 정상 출력되는지 한 번에 검증.
// 무음 스위치 / 시스템 볼륨 / 미디어 채널 mute 여부를 귀로 확인하는 용도.
// 테스트는 본인 기기만 — 다른 매장 멤버에게 공유 X.
export function playSoundTest() {
  _doPlayOrderSound();
  cancelSpeech();
  rawSpeak('사운드 테스트입니다. 알림이 잘 들리시나요?');
}

// ===== 매장 공유 dispatcher 등록 ===================================
// sharedAudio.js 의 listener 가 다른 기기 trigger 를 받으면 이 함수를 호출.
// 본인이 trigger 한 이벤트는 sharedAudio 가 source 비교로 skip 처리.
function _localDispatch(payload) {
  if (!payload) return;
  if (payload.type === 'sound') {
    switch (payload.sound) {
      case 'order':
        _doPlayOrderSound();
        break;
      case 'change':
        _doPlayChangeSound();
        break;
      case 'ready':
        _doPlayReadySound();
        break;
      case 'delivery':
        _doPlayDeliveryAlertSound();
        break;
    }
  } else if (payload.type === 'speak' && payload.text) {
    rawSpeak(payload.text);
  }
}
registerLocalDispatch(_localDispatch);
