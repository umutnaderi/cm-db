// Lightweight retro sound effects for live match playback in draft-run.js.
// Everything is synthesized with the Web Audio API (oscillators + filtered
// noise) — no audio files, so there's nothing to source, license, or fetch.

const SOUND_KEY = "retroball-match-sound-v1";

let audioContext = null;

function ensureContext() {
  if (audioContext) return audioContext;
  const Ctor = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!Ctor) return null;
  try {
    audioContext = new Ctor();
  } catch {
    audioContext = null;
  }
  return audioContext;
}

// Call from a direct user-gesture handler (e.g. the "next match" click) to
// satisfy browser autoplay policies before the first sound is scheduled.
export function unlockMatchSound() {
  const ctx = ensureContext();
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
}

export function isMatchSoundEnabled() {
  try {
    const raw = localStorage.getItem(SOUND_KEY);
    return raw === null ? true : JSON.parse(raw) !== false;
  } catch {
    return true;
  }
}

export function setMatchSoundEnabled(enabled) {
  try {
    localStorage.setItem(SOUND_KEY, JSON.stringify(Boolean(enabled)));
  } catch {
    // Sound preference just won't persist across reloads; not fatal.
  }
}

function tone(ctx, { freq, freqEnd, start, duration, type = "sine", gain = 0.2 }) {
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(freq, start);
  if (freqEnd) oscillator.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), start + duration);
  gainNode.gain.setValueAtTime(0.0001, start);
  gainNode.gain.linearRampToValueAtTime(gain, start + 0.012);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gainNode).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.03);
}

function noiseBurst(ctx, { start, duration, gain = 0.3, filterFreq = 800 }) {
  const sampleCount = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < sampleCount; i += 1) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = filterFreq;
  const gainNode = ctx.createGain();
  gainNode.gain.setValueAtTime(gain, start);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(filter).connect(gainNode).connect(ctx.destination);
  source.start(start);
}

function playGoalScored(ctx, t) {
  [523.25, 659.25, 783.99, 1046.5].forEach((freq, index) => {
    tone(ctx, { freq, start: t + index * 0.09, duration: 0.3, type: "square", gain: 0.18 });
  });
}

function playGoalConceded(ctx, t) {
  [392, 349.23, 293.66, 233.08].forEach((freq, index) => {
    tone(ctx, { freq, start: t + index * 0.15, duration: 0.42, type: "sawtooth", gain: 0.15 });
  });
}

function playRedCard(ctx, t) {
  [0, 0.17].forEach((offset) => {
    tone(ctx, { freq: 880, start: t + offset, duration: 0.14, type: "square", gain: 0.22 });
  });
}

function playHeavyTackle(ctx, t) {
  tone(ctx, { freq: 130, freqEnd: 45, start: t, duration: 0.22, type: "sine", gain: 0.32 });
  noiseBurst(ctx, { start: t, duration: 0.12, gain: 0.28, filterFreq: 350 });
}

function playChance(ctx, t) {
  tone(ctx, { freq: 700, freqEnd: 1050, start: t, duration: 0.13, type: "triangle", gain: 0.16 });
}

// Dispatches on the same event fields draft-run.js already keys its visual
// reactions off (event.goal/event.side, event.card, event.kind) — see
// renderCanonicalMatchSnapshot()'s latestEvent dedup block.
export function playMatchEventSound(event) {
  if (!event || !isMatchSoundEnabled()) return;
  const ctx = ensureContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  try {
    const t = ctx.currentTime;
    if (event.goal) {
      if (event.side === "user") playGoalScored(ctx, t);
      else playGoalConceded(ctx, t);
    } else if (event.kind === "card" && event.card === "red") {
      playRedCard(ctx, t);
    } else if (event.kind === "tackle") {
      playHeavyTackle(ctx, t);
    } else if (event.kind === "chance") {
      playChance(ctx, t);
    }
  } catch {
    // Sound is a non-critical enhancement; never let it break match playback.
  }
}
