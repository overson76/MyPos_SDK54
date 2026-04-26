// utils/notify.js 의 Web Audio 톤 시퀀스를 동일 주파수/타이밍으로 WAV 파일로 굽는다.
// 네이티브에서 expo-audio 로 재생하기 위한 번들 에셋 생성용. 한 번만 실행하면 됨.
//
// 실행: node scripts/gen_sounds.js
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;
const TAIL_MS = 80;

// utils/notify.js 와 동일한 톤 시퀀스
const SOUNDS = {
  order: [
    { freq: 660, durMs: 120, whenSec: 0,    vol: 0.2 },
    { freq: 880, durMs: 180, whenSec: 0.13, vol: 0.2 },
  ],
  change: [
    { freq: 520, durMs: 90,  whenSec: 0,   vol: 0.22 },
    { freq: 700, durMs: 90,  whenSec: 0.1, vol: 0.22 },
    { freq: 920, durMs: 160, whenSec: 0.2, vol: 0.25 },
  ],
  ready: [
    { freq: 784,  durMs: 110, whenSec: 0,    vol: 0.2 },
    { freq: 988,  durMs: 110, whenSec: 0.11, vol: 0.2 },
    { freq: 1319, durMs: 220, whenSec: 0.22, vol: 0.2 },
  ],
  delivery: [
    { freq: 880,  durMs: 150, whenSec: 0,    vol: 0.25 },
    { freq: 1175, durMs: 150, whenSec: 0.17, vol: 0.25 },
    { freq: 880,  durMs: 150, whenSec: 0.34, vol: 0.25 },
    { freq: 1175, durMs: 250, whenSec: 0.51, vol: 0.28 },
  ],
};

// 지수 램프: g0 → g1 over [0, dur]
function expRamp(g0, g1, t, dur) {
  if (dur <= 0) return g1;
  if (t <= 0) return g0;
  if (t >= dur) return g1;
  return g0 * Math.pow(g1 / g0, t / dur);
}

function gainAt(t, durSec, vol) {
  const ATTACK = 0.01;
  if (t < 0) return 0;
  if (t < ATTACK) return expRamp(0.001, vol, t, ATTACK);
  if (t < durSec) return expRamp(vol, 0.001, t - ATTACK, durSec - ATTACK);
  return 0;
}

function generate(tones) {
  const totalSec =
    tones.reduce((m, t) => Math.max(m, t.whenSec + t.durMs / 1000), 0) +
    TAIL_MS / 1000;
  const totalSamples = Math.ceil(totalSec * SAMPLE_RATE);
  const buf = new Float32Array(totalSamples);

  for (const t of tones) {
    const startSample = Math.floor(t.whenSec * SAMPLE_RATE);
    const durSec = t.durMs / 1000;
    const endSample = Math.min(
      totalSamples,
      startSample + Math.ceil(durSec * SAMPLE_RATE) + 1
    );
    const omega = 2 * Math.PI * t.freq;
    for (let i = startSample; i < endSample; i++) {
      const localT = (i - startSample) / SAMPLE_RATE;
      const g = gainAt(localT, durSec, t.vol);
      buf[i] += Math.sin(omega * (i / SAMPLE_RATE)) * g;
    }
  }

  // 클리핑 방지
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    if (Math.abs(buf[i]) > peak) peak = Math.abs(buf[i]);
  }
  const norm = peak > 0.95 ? 0.95 / peak : 1;

  const dataBytes = totalSamples * 2;
  const out = Buffer.alloc(44 + dataBytes);
  // RIFF header
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + dataBytes, 4);
  out.write('WAVE', 8);
  // fmt chunk
  out.write('fmt ', 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);            // PCM
  out.writeUInt16LE(1, 22);            // mono
  out.writeUInt32LE(SAMPLE_RATE, 24);
  out.writeUInt32LE(SAMPLE_RATE * 2, 28); // byteRate
  out.writeUInt16LE(2, 32);            // block align
  out.writeUInt16LE(16, 34);           // bits per sample
  // data chunk
  out.write('data', 36);
  out.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < totalSamples; i++) {
    const s = Math.max(-1, Math.min(1, buf[i] * norm));
    out.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return out;
}

const outDir = path.join(__dirname, '..', 'assets', 'sounds');
fs.mkdirSync(outDir, { recursive: true });

for (const [name, tones] of Object.entries(SOUNDS)) {
  const buf = generate(tones);
  const file = path.join(outDir, `${name}.wav`);
  fs.writeFileSync(file, buf);
  console.log(`wrote ${file} (${buf.length} bytes)`);
}
