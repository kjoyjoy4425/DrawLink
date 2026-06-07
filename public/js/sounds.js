// Web Audio API 효과음 — 외부 파일 없이 절차적으로 생성
let _ctx = null;
let _muted = false;

function ctx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  return _ctx;
}

function tone({ freq = 440, type = 'sine', vol = 0.25, dur = 0.18, attack = 0.01, decay = 0.12, delay = 0 } = {}) {
  if (_muted) return;
  const c = ctx();
  const t = c.currentTime + delay;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.connect(gain);
  gain.connect(c.destination);
  osc.frequency.value = freq;
  osc.type = type;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(vol, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.001, t + attack + decay);
  osc.start(t);
  osc.stop(t + dur);
}

export const sounds = {
  join()   { tone({ freq: 523, dur: 0.15 }); tone({ freq: 659, dur: 0.15, delay: 0.1 }); },
  leave()  { tone({ freq: 392, dur: 0.15 }); tone({ freq: 330, dur: 0.15, delay: 0.1 }); },
  ready()  { tone({ freq: 660, dur: 0.12 }); tone({ freq: 880, vol: 0.3, dur: 0.15, delay: 0.1 }); },
  start()  {
    [261, 329, 392, 523].forEach((f, i) => tone({ freq: f, vol: 0.3, dur: 0.2, delay: i * 0.1 }));
  },
  submit() { tone({ freq: 800, type: 'square', vol: 0.1, dur: 0.06, decay: 0.05 }); },
  phase()  { tone({ freq: 330, dur: 0.25 }); tone({ freq: 440, dur: 0.25, delay: 0.15 }); },
  reveal() {
    [392, 523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, vol: 0.3, dur: 0.25, delay: i * 0.08 }));
  },
  chat()   { tone({ freq: 880, vol: 0.1, dur: 0.08, decay: 0.07 }); },
  tick()   { tone({ freq: 440, type: 'square', vol: 0.08, dur: 0.04, decay: 0.03 }); },
  kick()   { tone({ freq: 200, type: 'sawtooth', vol: 0.25, dur: 0.35, decay: 0.3 }); },
  error()  { tone({ freq: 180, type: 'square', vol: 0.2, dur: 0.4, decay: 0.35 }); },
  nextEntry() { tone({ freq: 550, dur: 0.12 }); },
};

export function toggleMute() { _muted = !_muted; return _muted; }
export function isMuted()    { return _muted; }
