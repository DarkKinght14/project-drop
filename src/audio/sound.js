/* =====================================================================
   SOUND
   Every sound is made by code (no sound files), using the browser's
   Web Audio: "noise" (a hiss, shaped into bangs and clicks) and "tones"
   (beeps that slide in pitch). Press M to mute.
   ===================================================================== */
let ctx = null, master = null, noiseBuffer = null;
let muted = false;

// Browsers only allow sound after a click, so the Play button calls this.
export function initAudio() {
  if (ctx) { ctx.resume(); return; }
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  } catch (e) { ctx = null; }
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.5;
  return muted;
}

// A burst of hiss through a filter. freq: brightness, time: length in seconds.
function noise({ freq = 1000, q = 1, time = 0.1, volume = 0.5, type = 'lowpass', delay = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type; filter.frequency.value = freq; filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + time);
  src.connect(filter).connect(gain).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + time + 0.02);
}

// A beep sliding from one pitch to another.
function tone({ from = 440, to = from, time = 0.1, volume = 0.2, wave = 'sine', delay = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = wave;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + time);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + time);
  osc.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + time + 0.02);
}

const SHOTS = {
  pistol:  () => { noise({ freq: 2600, time: 0.12, volume: 0.55 }); tone({ from: 300, to: 80, time: 0.08, volume: 0.25 }); },
  smg:     () => { noise({ freq: 3200, time: 0.07, volume: 0.4 }); tone({ from: 260, to: 90, time: 0.05, volume: 0.15 }); },
  ar:      () => { noise({ freq: 2000, time: 0.16, volume: 0.6 }); tone({ from: 220, to: 60, time: 0.1, volume: 0.3 }); },
  shotgun: () => { noise({ freq: 1200, time: 0.35, volume: 0.9 }); tone({ from: 140, to: 40, time: 0.2, volume: 0.45 }); noise({ freq: 3000, type: 'bandpass', q: 4, time: 0.05, volume: 0.25, delay: 0.42 }); },
  sniper:  () => { noise({ freq: 1600, time: 0.6, volume: 0.9 }); tone({ from: 180, to: 35, time: 0.35, volume: 0.5 }); },
};

export const sound = {
  shot: (type) => SHOTS[type]?.(),
  empty: () => tone({ from: 1800, to: 1500, time: 0.03, volume: 0.15, wave: 'square' }),
  reload: () => { noise({ freq: 2500, type: 'bandpass', q: 6, time: 0.05, volume: 0.3 }); noise({ freq: 1800, type: 'bandpass', q: 6, time: 0.06, volume: 0.3, delay: 0.25 }); },
  reloaded: () => noise({ freq: 2200, type: 'bandpass', q: 8, time: 0.06, volume: 0.35 }),
  equip: () => noise({ freq: 1500, type: 'bandpass', q: 3, time: 0.08, volume: 0.25 }),
  pickup: () => { tone({ from: 520, to: 780, time: 0.09, volume: 0.15, wave: 'triangle' }); },
  hit: () => tone({ from: 1300, to: 1100, time: 0.05, volume: 0.12, wave: 'triangle' }),
  headshot: () => { tone({ from: 1900, to: 1700, time: 0.12, volume: 0.18, wave: 'triangle' }); tone({ from: 2600, to: 2500, time: 0.1, volume: 0.1, delay: 0.02 }); },
  shieldHit: () => tone({ from: 900, to: 1400, time: 0.06, volume: 0.1, wave: 'sine' }),
  knockdown: () => { tone({ from: 600, to: 200, time: 0.3, volume: 0.2, wave: 'square' }); noise({ freq: 800, time: 0.2, volume: 0.3 }); },
  swing: () => noise({ freq: 900, type: 'bandpass', q: 2, time: 0.15, volume: 0.2 }),
  chestOpen: () => { [523, 659, 784, 1047].forEach((f, i) => tone({ from: f, time: 0.25, volume: 0.12, wave: 'triangle', delay: i * 0.06 })); },
  healDone: () => { tone({ from: 600, to: 900, time: 0.15, volume: 0.15 }); tone({ from: 900, to: 1200, time: 0.15, volume: 0.12, delay: 0.1 }); },
  hurt: () => { noise({ freq: 500, time: 0.15, volume: 0.5 }); tone({ from: 160, to: 70, time: 0.15, volume: 0.3 }); },
};
