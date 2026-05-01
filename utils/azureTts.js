// Azure Cognitive Services TTS — 네이티브 (iOS/Android)
// EXPO_PUBLIC_AZURE_TTS_KEY 없으면 조용히 skip → 시스템 TTS 폴백

import * as FileSystem from 'expo-file-system';
import { createAudioPlayer } from 'expo-audio';

const KEY = process.env.EXPO_PUBLIC_AZURE_TTS_KEY || '';
const REGION = process.env.EXPO_PUBLIC_AZURE_TTS_REGION || 'koreacentral';
const VOICE = process.env.EXPO_PUBLIC_AZURE_TTS_VOICE || 'ko-KR-SunHiNeural';

export function isAzureConfigured() {
  return !!KEY;
}

let _curPlayer = null;

export function cancelAzureSpeech() {
  if (_curPlayer) {
    try { _curPlayer.remove(); } catch {}
    _curPlayer = null;
  }
}

export async function azureSpeak(text, volume = 1) {
  if (!text || !KEY) return false;
  cancelAzureSpeech();

  const endpoint = `https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const ssml = buildSsml(text);
  let tmpUri = null;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': KEY,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
      },
      body: ssml,
    });

    if (!res.ok) {
      console.warn('[Azure TTS]', res.status);
      return false;
    }

    const arrayBuffer = await res.arrayBuffer();
    const base64 = arrayBufferToBase64(arrayBuffer);
    tmpUri = `${FileSystem.cacheDirectory}tts_${Date.now()}.mp3`;
    await FileSystem.writeAsStringAsync(tmpUri, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const player = createAudioPlayer({ uri: tmpUri });
    player.volume = Math.max(0, Math.min(1, volume));
    _curPlayer = player;
    player.play();

    // 재생 완료 후 캐시 파일 정리 (30초 뒤 최대 보장)
    const cleanup = () => {
      if (_curPlayer === player) _curPlayer = null;
      try { player.remove(); } catch {}
      if (tmpUri) FileSystem.deleteAsync(tmpUri, { idempotent: true }).catch(() => {});
    };
    setTimeout(cleanup, 30_000);

    return true;
  } catch (e) {
    console.warn('[Azure TTS] 오류:', e.message);
    if (tmpUri) FileSystem.deleteAsync(tmpUri, { idempotent: true }).catch(() => {});
    return false;
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function buildSsml(text) {
  return `<speak version='1.0' xml:lang='ko-KR'><voice name='${VOICE}'>${escXml(text)}</voice></speak>`;
}

function escXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
