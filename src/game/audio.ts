/* THE BIG CON: BATTLE ROYALE — WebAudio synth SFX
 * No audio files; everything is synthesized, board-game-terminal flavored.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

function ac(): AudioContext {
  if (!ctx) {
    ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function setMuted(m: boolean) { muted = m; if (master) master.gain.value = m ? 0 : 0.5; }
export function isMuted() { return muted; }
export function unlockAudio() { ac(); }

function noiseBurst(dur: number, vol: number, filterFreq: number, type: BiquadFilterType = 'lowpass') {
  const c = ac();
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.value = filterFreq;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  src.connect(f); f.connect(g); g.connect(master!);
  src.start();
}

function blip(freq: number, dur: number, vol = 0.2, type: OscillatorType = 'square', slide = 0) {
  const c = ac();
  const o = c.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), c.currentTime + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  o.connect(g); g.connect(master!);
  o.start(); o.stop(c.currentTime + dur + 0.05);
}

export const Sfx = {
  shoot(w: string) {
    if (muted) return;
    switch (w) {
      case 'bondmageddon': noiseBurst(0.32, 0.5, 1400); blip(90, 0.18, 0.25, 'sawtooth', -50); break;
      case 'dossier': noiseBurst(0.5, 0.4, 600); blip(140, 0.3, 0.3, 'sawtooth', -90); break;
      case 'boulder': noiseBurst(0.09, 0.35, 2200); blip(160, 0.05, 0.12, 'square', -60); break;
      case 'tweet': noiseBurst(0.14, 0.4, 1800); blip(220, 0.1, 0.18, 'sawtooth', -120); break;
      case 'auditor': noiseBurst(0.07, 0.28, 2600); break;
      default: noiseBurst(0.12, 0.4, 1600); blip(180, 0.08, 0.16, 'sawtooth', -80);
    }
  },
  hitmarker() { if (!muted) blip(1200, 0.06, 0.22, 'square', -300); },
  kill() { if (muted) return; blip(600, 0.09, 0.25, 'square', -200); setTimeout(() => blip(900, 0.12, 0.25, 'square', 300), 70); },
  hurt() { if (!muted) { noiseBurst(0.15, 0.35, 500); blip(110, 0.14, 0.2, 'sawtooth', -40); } },
  boom() { if (!muted) { noiseBurst(0.8, 0.6, 700); blip(60, 0.5, 0.35, 'sawtooth', -20); } },
  seizeStart() { if (!muted) blip(440, 0.08, 0.18, 'triangle', 60); },
  seizeDone() { if (muted) return; [523, 659, 784].forEach((f, i) => setTimeout(() => blip(f, 0.14, 0.22, 'triangle'), i * 90)); },
  income() { if (muted) return; [659, 880].forEach((f, i) => setTimeout(() => blip(f, 0.1, 0.16, 'sine'), i * 80)); },
  event() { if (muted) return; blip(196, 0.25, 0.2, 'triangle', 100); setTimeout(() => blip(262, 0.2, 0.18, 'triangle'), 160); },
  raid() { if (muted) return; for (let i = 0; i < 3; i++) setTimeout(() => { blip(880, 0.12, 0.3, 'square', -400); }, i * 180); },
  zoneTick() { if (!muted) blip(300, 0.08, 0.12, 'sine', -100); },
  pickup() { if (!muted) blip(880, 0.07, 0.16, 'sine', 200); },
  reload() { if (!muted) { blip(320, 0.06, 0.15, 'square'); setTimeout(() => blip(420, 0.06, 0.15, 'square'), 130); } },
  empty() { if (!muted) blip(200, 0.05, 0.12, 'square'); },
  ui() { if (!muted) blip(520, 0.04, 0.1, 'sine'); },
  win() { if (muted) return; [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.22, 0.24, 'triangle'), i * 140)); },
  dead() { if (muted) return; [400, 300, 200, 120].forEach((f, i) => setTimeout(() => blip(f, 0.2, 0.24, 'sawtooth', -40), i * 130)); },
  drop() { if (muted) return; noiseBurst(1.2, 0.2, 900, 'bandpass'); },
};
