// Azure Cognitive Services TTS — 웹/Electron 환경
// EXPO_PUBLIC_AZURE_TTS_KEY 없으면 조용히 skip → 시스템 TTS 폴백

const KEY = process.env.EXPO_PUBLIC_AZURE_TTS_KEY || '';
const REGION = process.env.EXPO_PUBLIC_AZURE_TTS_REGION || 'koreacentral';
const VOICE = process.env.EXPO_PUBLIC_AZURE_TTS_VOICE || 'ko-KR-SunHiNeural';

export function isAzureConfigured() {
  return !!KEY;
}

let _cur = null;

export function cancelAzureSpeech() {
  if (_cur) {
    try { _cur.pause(); } catch {}
    _cur = null;
  }
}

export async function azureSpeak(text, volume = 1) {
  if (!text || !KEY) return false;
  cancelAzureSpeech();

  const endpoint = `https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const ssml = buildSsml(text);

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

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new window.Audio(url);
    audio.volume = Math.max(0, Math.min(1, volume));
    _cur = audio;
    audio.onended = () => {
      URL.revokeObjectURL(url);
      if (_cur === audio) _cur = null;
    };
    await audio.play();
    return true;
  } catch (e) {
    console.warn('[Azure TTS] 오류:', e.message);
    return false;
  }
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
