// Shared sample-based audio director for both Match Lab and the actual
// match (draft-run.js). Neither caller references an individual filename or
// picks a sample directly -- everything goes through the cue names below,
// resolved from the same SOUND_BANK manifest and the same engine-code ->
// cue mapping (resolveCueSequence()), so the two UIs can never drift apart
// on what a given K.SAVE.*/F.*/etc code sounds like.
//
// Web Audio buffers (fetch + decodeAudioData), not <audio> elements: several
// cues sometimes need to layer with precise relative timing (a keeper
// touch immediately followed by a post clang), which <audio> tags can't
// guarantee. See MATCH_LAB_PLAN.md's audio section for the full design
// writeup and the sounds/ inventory this manifest was curated from.

const ENABLED_KEY = "retroball-match-sound-v1";
const VOLUME_KEY = "retroball-match-sound-volume-v1";
const SOUND_BASE_URL = "/sounds/";

// --- Versioned sample manifest -------------------------------------------
// v1 (tools/convert-sounds.mjs's output, ear-reviewed) has been retired
// from this manifest -- 2026-08-21, on request, "go full v2." sounds/v1/*
// stays on disk (nothing deletes it) but nothing here references it any
// more, so it's effectively dead weight; safe to remove in a later pass.
//
// sounds/v2/*.mp3 is a second, broader sample pack supplied pre-trimmed/
// pre-normalized -- not run through convert-sounds.mjs (no raw-WAV source
// for it under sounds/*.wav) and NOT individually ear-reviewed against
// this codebase's usual bar; the cue each file is filed under below is
// inferred from its own filename only. Revisit any that turn out to sound
// wrong once someone actually listens. Filenames are stored pack-relative
// ("v2/...") -- a leftover from when v1/v2 coexisted, kept for clarity
// over sounds/'s flat root-level *.wav library.
//
// Three cues -- missedChance/goalFor/goalAgainst, the crowd-reaction bus --
// are the one deliberate exception and still point at v1: v2 is a foley-
// only pack (ball/boot/glove contact sounds), it has no crowd
// cheer/groan/roar content at all, and these three are shared with the
// LIVE match (draft-run.js), not Match-Lab-only -- dropping them to
// nothing would silence every real goal celebration and missed-chance
// reaction game-wide, not just fix a Match-Lab mapping. Flagged rather
// than silently kept: say the word and these go to `[]` (silent) too.
export const SOUND_BANK = {
  kick: ["v2/ball-kick-2.mp3", "v2/ball-kick-3.mp3", "v2/ball-hit.mp3"],
  // Power/blast strikes (SHOT_START_CODES' BLAST/HARD) -- v1 never
  // distinguished shot power at the "kick" cue itself.
  kickHard: [
    "v2/ball-kick-hard.mp3", "v2/ball-kick-hard-2.mp3", "v2/ball-kick-launch.mp3",
    "v2/ball-hit-volley.mp3", "v2/ball-hit-hard-3.mp3",
  ],
  // Header contact (SHOT_START_CODES' HEADER).
  headerHit: ["v2/ball-hit-head.mp3", "v2/ball-hit-head-2.mp3"],
  // v1's groundPass/longPass source (groundPass.wav/_2.wav) is gone;
  // ball-roll-ground reads as the closer match for a rolled ground pass
  // anyway (the v1 samples were themselves a kick-contact sound reused for
  // a passing cue, not a true ground-pass source).
  groundPass: ["v2/ball-roll-ground.mp3", "v2/ball-roll-ground-2.mp3", "v2/ball-roll-ground-3.mp3"],
  // A genuinely distinct source now, unlike v1 (which had none and reused
  // groundPass's own samples) -- ball-kick-launch is built for exactly
  // this, a harder, longer-travelling strike.
  longPass: ["v2/ball-kick-launch.mp3", "v2/ball-hit-hard-3.mp3"],
  // No dedicated "cross" source in v2 either; a cross is typically struck
  // with more power/loft than a ground pass, so it reuses the driven/
  // launched strikes instead of the rolling-ball groundPass pool.
  cross: ["v2/ball-kick-launch.mp3", "v2/ball-kick-hard.mp3"],
  keeperCatch: ["v2/gk-grab.mp3", "v2/gk-grab-2.mp3", "v2/gk-grab-3.mp3"],
  keeperParry: [
    "v2/gk-dive-ground.mp3", "v2/gk-dive-ground-2.mp3",
    "v2/gk-hand.mp3", "v2/gk-hand-2.mp3", "v2/gk-save.mp3",
  ],
  keeperPowerSave: [
    "v2/gk-grab-direct.mp3", "v2/gk-grab-direct-2.mp3",
    "v2/gk-grab-direct-3.mp3", "v2/gk-grab-direct-4.mp3",
  ],
  post: ["v2/post-sound.mp3", "v2/post-sound-2.mp3"],
  net: [
    "v2/net-sound-normal.mp3", "v2/net-sound-normal-2.mp3", "v2/net-sound-normal-3.mp3",
    "v2/net-sound-corner.mp3", "v2/net-sound-hard.mp3", "v2/net-sound-light.mp3",
  ],
  // v1's shared "a body stops the ball" source (clearance-v1.mp3) is gone;
  // split back into two genuinely different physical actions instead of
  // reusing one file for both.
  blocked: ["v2/ball-hit-ground.mp3", "v2/ball-hit-ground-2.mp3"],
  clearance: ["v2/ball-kick-hard.mp3", "v2/ball-hit-hard-3.mp3"],
  // -- crowd bus, lazy-loaded (see preloadCore()) -- kept on v1, see the
  // header comment above.
  missedChance: ["v1/missed-chance-v1.mp3"],
  goalFor: ["v1/goal-for-v1.mp3"],
  goalAgainst: ["v1/goal-against-v1.mp3"],
  whistleStart: ["v2/whistle-sound.mp3", "v2/whistle-sound-2.mp3"],
  whistleEnd: ["v2/whistle-sound-ending.mp3"],
  // -- v2-only: circumstances v1 never had source material for --
  // A receiver's first touch (P.RECEIVE.CLEAN/PROTECT).
  firstTouch: ["v2/first-touch.mp3", "v2/first-touch-2.mp3", "v2/first-touch-3.mp3"],
  // A heavy/scuffed touch (P.RECEIVE.HEAVY) -- "outside-foot" read as the
  // closest filename match for an awkward, not-quite-clean touch.
  heavyTouch: ["v2/first-touch-outside-foot.mp3"],
  // A single dribble/carry touch (P.RECEIVE.ADVANCE/KNOCK_FORWARD -- the
  // ball being knocked forward into space, not a full multi-touch carry
  // animation, which match-lab.js has no per-touch timeline for yet).
  carryTouch: [
    "v2/carry-touch-step-1.mp3", "v2/carry-touch-step-2.mp3", "v2/carry-touch-step-3.mp3",
    "v2/carry-touch-step-4.mp3", "v2/carry-touch-step-5.mp3", "v2/carry-touch-step-6.mp3",
    "v2/carry-touch-step-9.mp3", "v2/carry-touch-step-10.mp3", "v2/carry-touch-step-11.mp3",
    "v2/carry-touch-step-12.mp3", "v2/carry-step-touch-7.mp3", "v2/carry-step-touch-8.mp3",
  ],
  // A loose ball on the ground -- a rebound coming free (REBOUND.GOAL/MISS),
  // or a pass nobody reaches / a heavy touch nobody recovers
  // (P.RECEIVE.LATE/LOSE).
  looseBall: [
    "v2/ball-bounce-hard.mp3", "v2/ball-bounce-soft.mp3", "v2/ball-bounce-soft-2.mp3",
    "v2/ball-hit-ground.mp3", "v2/ball-hit-ground-2.mp3",
    "v2/ball-roll-ground.mp3", "v2/ball-roll-ground-2.mp3", "v2/ball-roll-ground-3.mp3",
  ],
  // A slide-tackle engagement (D.SLIDE.*).
  slideTackle: ["v2/slide.mp3"],
  // Training ground's own stand-in for missedChance -- see setTrainingMode()
  // below for why the real missedChance (crowd bus) is dropped there
  // entirely, and why this needs to exist as a *separate*, effects-bus cue
  // rather than just un-dropping missedChance for training.
  trainingMiss: ["v2/training-miss.mp3"],
};

// Not wired to any circumstance in this pass -- v2/chest-control.mp3 (no
// engine code distinguishes an aerial/chest reception from any other
// P.RECEIVE.* outcome to hang it off) and v2/background-wind-low.mp3 (a
// looping ambience bed, not a one-shot cue -- playCue()/the bus model here
// has no loop/continuous-playback support at all, so wiring it up is a
// separate feature, not a mapping).

// Which gain bus each cue plays through. "effects" = ball/contact sounds
// (short, preloaded eagerly); "crowd" = ambient reactions/whistles (longer,
// lazy-loaded on first actual use, and only one plays at a time -- see
// playCue()'s crowd-ducking behavior below). Commentary has its own bus
// wired up for a future phase but no cues use it yet (see file header/
// MATCH_LAB_PLAN.md: long commentary is explicitly deferred pending an
// overlap/volume/licensing review, not built this pass).
const CUE_BUS = {
  kick: "effects", kickHard: "effects", headerHit: "effects",
  groundPass: "effects", longPass: "effects", cross: "effects",
  keeperCatch: "effects", keeperParry: "effects", keeperPowerSave: "effects",
  post: "effects", net: "effects", blocked: "effects", clearance: "effects",
  firstTouch: "effects", heavyTouch: "effects", carryTouch: "effects",
  looseBall: "effects", slideTackle: "effects", trainingMiss: "effects",
  missedChance: "crowd", goalFor: "crowd", goalAgainst: "crowd",
  whistleStart: "crowd", whistleEnd: "crowd",
};

// Eagerly preloaded on every Roll/Play/Reroll/Replay click (see
// unlockAndPreload() in match-lab.js -- preloadCore() isn't a one-time
// startup call, it fires on EVERY one of those). Deliberately just the
// cues nearly every roll actually touches, not the whole "effects" bus:
// v2 gave several cues many-variant pools (carryTouch alone has 12,
// looseBall 8), and eagerly fetching + decodeAudioData()-ing all ~80+
// effects-bus files on every single click (2026-08-21, before this list
// existed) visibly stalled the UI -- most of those variants are for
// situational cues (a slide tackle, a heavy touch) a given roll may never
// even use. Everything NOT listed here fetches lazily on first actual
// use instead, same as the crowd bus already did.
const EAGER_PRELOAD_CUES = new Set([
  "kick", "groundPass", "longPass", "cross",
  "keeperCatch", "keeperParry", "keeperPowerSave",
  "post", "net", "blocked", "clearance",
]);
const CORE_CUES = Object.keys(SOUND_BANK).filter((cue) => EAGER_PRELOAD_CUES.has(cue));
const LAZY_CUES = Object.keys(SOUND_BANK).filter((cue) => !EAGER_PRELOAD_CUES.has(cue));

// --- Training mode ---------------------------------------------------------
// Match Lab is a training-ground testbed, not a live match -- it rolls the
// same isolated scenario over and over, so it should never carry crowd
// atmosphere at all (a goal-reaction cheer or a "missed chance" groan
// firing on every repeated test roll reads as noise, not signal), and any
// individual sample that happens to have live-match ambience baked into it
// (a stray crowd murmur under a cross recording, say) has to be excluded
// there even though that same ambience is perfectly fine -- arguably
// desirable -- for the actual match. This is a whole-module flag, not a
// per-call option: which mode a page is in doesn't change moment to
// moment, so every caller in that page just sets it once at startup
// instead of threading a flag through every playCue()/playEvent() call.
let trainingMode = false;
export function setTrainingMode(enabled) {
  trainingMode = Boolean(enabled);
}

// Individual samples that are fine for a live match but wrong for
// training specifically. Empty now that v1/cross-v2.mp3 (the one entry
// here, "has live match background noise baked in") is no longer in any
// pool at all post-v1-retirement -- left as a mechanism, not deleted, in
// case a future v2 sample needs the same treatment.
const TRAINING_EXCLUDED_VARIANTS = {};

// --- Deterministic variant selection --------------------------------------
// A tiny local string hash (FNV-1a) -- deliberately not importing
// matchEngineCore.js's hashString(): this module is a dependency-free leaf
// both a game-engine consumer (draft-run.js) and a pure animation testbed
// (match-lab.js) import, and it needs no engine coupling at all.
export function stableHash(...parts) {
  const input = parts.map((part) => String(part ?? "")).join("");
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function pickVariant(cue, { variantIndex, playbackId, eventId } = {}) {
  const excluded = trainingMode ? TRAINING_EXCLUDED_VARIANTS[cue] : null;
  const variants = excluded ? SOUND_BANK[cue]?.filter((file) => !excluded.has(file)) : SOUND_BANK[cue];
  if (!variants || !variants.length) return null;
  if (Number.isInteger(variantIndex)) return variants[((variantIndex % variants.length) + variants.length) % variants.length];
  if (playbackId !== undefined && eventId !== undefined) {
    return variants[stableHash(playbackId, eventId, cue) % variants.length];
  }
  // No replay-identity given at all -- first variant, not Math.random().
  // Every real call site passes playbackId/eventId; this only covers
  // ad hoc playCue() calls (e.g. a UI click) that don't have one.
  return variants[0];
}

// --- Audio graph -----------------------------------------------------------

let audioContext = null;
let masterGain = null;
let effectsGain = null;
let crowdGain = null;
let commentaryGain = null;

function ensureGraph() {
  if (audioContext) return audioContext;
  const Ctor = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!Ctor) return null;
  try {
    audioContext = new Ctor();
    masterGain = audioContext.createGain();
    effectsGain = audioContext.createGain();
    crowdGain = audioContext.createGain();
    commentaryGain = audioContext.createGain();
    masterGain.connect(audioContext.destination);
    effectsGain.connect(masterGain);
    crowdGain.connect(masterGain);
    commentaryGain.connect(masterGain);
    masterGain.gain.value = readVolume();
  } catch {
    audioContext = null;
  }
  return audioContext;
}

function busGain(bus) {
  if (bus === "crowd") return crowdGain;
  if (bus === "commentary") return commentaryGain;
  return effectsGain;
}

// --- Preference persistence -------------------------------------------------

function readEnabled() {
  try {
    const raw = localStorage.getItem(ENABLED_KEY);
    return raw === null ? true : JSON.parse(raw) !== false;
  } catch {
    return true;
  }
}
function writeEnabled(value) {
  try {
    localStorage.setItem(ENABLED_KEY, JSON.stringify(Boolean(value)));
  } catch {
    // Preference just won't persist across reloads; not fatal.
  }
}
function readVolume() {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    const value = raw === null ? 1 : Number(JSON.parse(raw));
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
  } catch {
    return 1;
  }
}
function writeVolume(value) {
  try {
    localStorage.setItem(VOLUME_KEY, JSON.stringify(value));
  } catch {
    // Not fatal -- see writeEnabled().
  }
}

let enabled = readEnabled();

// --- Buffer loading (fetch + decodeAudioData, cached) -----------------------

const bufferCache = new Map(); // filename -> AudioBuffer | Promise<AudioBuffer>

function loadBuffer(filename) {
  if (bufferCache.has(filename)) return bufferCache.get(filename);
  const ctx = ensureGraph();
  if (!ctx) return Promise.resolve(null);
  const promise = fetch(`${SOUND_BASE_URL}${filename}`)
    .then((response) => {
      if (!response.ok) throw new Error(`sound fetch failed: ${filename}`);
      return response.arrayBuffer();
    })
    .then((arrayBuffer) => ctx.decodeAudioData(arrayBuffer))
    .then((buffer) => {
      bufferCache.set(filename, buffer);
      return buffer;
    })
    .catch(() => {
      // Sound is a non-critical enhancement -- a missing/corrupt file must
      // never break playback. Cache the failure as null so we don't retry
      // every single call for a file that's genuinely gone.
      bufferCache.set(filename, null);
      return null;
    });
  bufferCache.set(filename, promise);
  return promise;
}

// --- Active source tracking (for stopAll()) ---------------------------------

const activeSources = new Set();
const pendingTimers = new Set();
let currentCrowdSource = null;

function trackSource(source) {
  activeSources.add(source);
  source.addEventListener("ended", () => activeSources.delete(source));
}
function trackTimer(timer) {
  pendingTimers.add(timer);
  return timer;
}

// --- Public API --------------------------------------------------------------

// Call from a direct user-gesture handler (Roll/Play/Replay in Match Lab;
// Start/Continue/Play in the actual match) to satisfy browser autoplay
// policy before the first sound is ever scheduled.
export function unlock() {
  const ctx = ensureGraph();
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
}

export function isSoundEnabled() {
  return enabled;
}

export function setEnabled(nextEnabled) {
  enabled = Boolean(nextEnabled);
  writeEnabled(enabled);
  if (!enabled) stopAll();
}

export function getMasterVolume() {
  return masterGain ? masterGain.gain.value : readVolume();
}

export function setMasterVolume(value) {
  const clamped = Math.max(0, Math.min(1, Number(value)));
  writeVolume(clamped);
  const ctx = ensureGraph();
  if (ctx && masterGain) masterGain.gain.setTargetAtTime(clamped, ctx.currentTime, 0.01);
}

// Preloads only EAGER_PRELOAD_CUES -- kick/pass/cross/keeper/post/net/
// blocked/clearance, the cues nearly every roll touches. Everything else
// (crowd/whistle, and the situational v2 additions -- kickHard/headerHit/
// firstTouch/heavyTouch/carryTouch/looseBall/slideTackle/trainingMiss) is
// intentionally NOT preloaded here; each fetches lazily on its own first
// real playCue() call instead, per the "don't load the whole bank up
// front" loading strategy (see EAGER_PRELOAD_CUES's own comment for why
// this list is deliberately smaller than "every effects-bus cue").
export function preloadCore() {
  const ctx = ensureGraph();
  if (!ctx) return Promise.resolve();
  const files = CORE_CUES.flatMap((cue) => SOUND_BANK[cue]);
  return Promise.all(files.map((file) => loadBuffer(file))).then(() => {});
}

// Plays one cue. Never throws -- a missing file, a locked/absent
// AudioContext, or sound being disabled all just no-op silently (sound
// must never interrupt the thing it's illustrating).
export function playCue(cue, options = {}) {
  if (!enabled) return null;
  const bus = CUE_BUS[cue] || "effects";
  // Training ground: no crowd atmosphere at all, regardless of which
  // specific crowd cue a caller asks for -- see setTrainingMode() above.
  // missedChance is the one exception: it has a dedicated effects-bus
  // stand-in (trainingMiss, v2/training-miss.mp3) built for exactly this
  // gap, so a training miss gets *some* reaction instead of pure silence.
  if (trainingMode && bus === "crowd") {
    if (cue === "missedChance" && SOUND_BANK.trainingMiss) return playCue("trainingMiss", options);
    return null;
  }
  const variants = SOUND_BANK[cue];
  if (!variants || !variants.length) return null;
  const ctx = ensureGraph();
  if (!ctx) return null;
  const filename = pickVariant(cue, options);
  if (!filename) return null;
  const { volume = 1, delayMs = 0 } = options;

  const startPlayback = (buffer) => {
    if (!buffer || !enabled) return;
    try {
      if (bus === "crowd") {
        // Only one crowd/whistle clip at a time -- fade the previous one
        // out instead of letting two reactions overlap.
        if (currentCrowdSource) fadeOutAndStop(currentCrowdSource, 180);
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gainNode = ctx.createGain();
      gainNode.gain.value = Math.max(0, Math.min(1, volume));
      source.connect(gainNode).connect(busGain(bus));
      const startAt = ctx.currentTime + Math.max(0, delayMs) / 1000;
      source.start(startAt);
      trackSource(source);
      if (bus === "crowd") {
        currentCrowdSource = source;
        source.addEventListener("ended", () => {
          if (currentCrowdSource === source) currentCrowdSource = null;
        });
      }
    } catch {
      // Never let a playback failure propagate into caller code.
    }
  };

  const cached = bufferCache.get(filename);
  if (cached instanceof Promise || cached === undefined) {
    loadBuffer(filename).then(startPlayback);
  } else {
    startPlayback(cached);
  }
  return filename;
}

// Ends the previous crowd/whistle clip a little early rather than an
// abrupt same-instant hard cut. A true crossfade would need per-source gain
// nodes wired up for this one case; not worth the complexity for a v1
// "don't let two reactions overlap" rule -- a slightly early stop already
// prevents the overlap this exists to avoid.
function fadeOutAndStop(source, ms) {
  try {
    const ctx = audioContext;
    source.stop(ctx ? ctx.currentTime + ms / 1000 : 0);
  } catch {
    // Already stopped/ended -- fine.
  }
}

// --- Shared engine-code -> cue-sequence mapping -----------------------------
// The single mapping both Match Lab and the actual match read from. Returns
// an ordered list of { milestone, cue, atMs } -- callers with a real
// animation timeline (Match Lab) use `milestone` to trigger each cue at the
// matching real waypoint; callers without one (draft-run.js, which only
// knows "this event just became current") play the sequence using `atMs`
// as a fixed approximating delay. Either way the CUE for a given engine
// code is identical -- only the timing source differs.
const SHOT_START_CODES = new Set(["CALM", "BLAST", "FINESSE", "HEADER", "REGULAR", "HARD", "CURL"]);
const MISS_SUFFIX = /\.(WEAK|OVER|WIDE)$/;

function keeperContactCue(context) {
  return context.isPower ? "keeperPowerSave" : "keeperParry";
}
function goalReactionCue(context) {
  return context.side === "against" ? "goalAgainst" : "goalFor";
}

// K.SAVE.0-8 -- read directly off resolveKeeperSave()'s own code table
// (matchEngineCore.js), same source of truth the outcome-presentation
// adapter's KEEPER_SAVE_PRESENTATION table uses. No kick here on purpose:
// the kick belongs to the shot-selection event that already fired earlier.
function keeperSaveSequence(code, context) {
  const power = context.isPower;
  switch (code) {
    case "K.SAVE.0":
      return [
        { milestone: "net", cue: "net", atMs: 260 },
        { milestone: "terminal", cue: goalReactionCue(context), atMs: 420 },
      ];
    case "K.SAVE.1":
      return [{ milestone: "keeperContact", cue: power ? "keeperPowerSave" : "keeperCatch", atMs: 0 }];
    case "K.SAVE.2":
      return [{ milestone: "keeperContact", cue: keeperContactCue(context), atMs: 0 }];
    case "K.SAVE.3":
      return [
        { milestone: "keeperContact", cue: keeperContactCue(context), atMs: 0 },
        { milestone: "terminal", cue: "missedChance", atMs: 260 },
      ];
    case "K.SAVE.4":
      return [
        { milestone: "keeperContact", cue: keeperContactCue(context), atMs: 0 },
        { milestone: "recovery", cue: "keeperCatch", atMs: 320 },
      ];
    case "K.SAVE.5":
      return [{ milestone: "keeperContact", cue: keeperContactCue(context), atMs: 0 }];
    case "K.SAVE.6":
      return [
        { milestone: "keeperContact", cue: keeperContactCue(context), atMs: 0 },
        { milestone: "post", cue: "post", atMs: 200 },
      ];
    case "K.SAVE.7":
      return [
        { milestone: "keeperContact", cue: keeperContactCue(context), atMs: 0 },
        { milestone: "post", cue: "post", atMs: 200 },
        { milestone: "terminal", cue: "missedChance", atMs: 420 },
      ];
    case "K.SAVE.8":
      return [
        { milestone: "keeperContact", cue: keeperContactCue(context), atMs: 0 },
        { milestone: "post", cue: "post", atMs: 200 },
        { milestone: "net", cue: "net", atMs: 380 },
        { milestone: "terminal", cue: goalReactionCue(context), atMs: 520 },
      ];
    default:
      return [];
  }
}

// K.ONEONONE.* -- a different resolver (breakaway 1-v-1s), deliberately
// simpler: the engine models no post/corner distinction for these at all
// (see MATCH_LAB_PLAN.md's outcome-presentation-adapter writeup), so this
// only ever plays a contact or a goal reaction, never post/corner cues.
function oneOnOneSequence(code, context) {
  if (code === "K.ONEONONE.1") {
    return [
      { milestone: "net", cue: "net", atMs: 220 },
      { milestone: "terminal", cue: goalReactionCue(context), atMs: 380 },
    ];
  }
  if (code === "K.ONEONONE.3") {
    return [{ milestone: "keeperContact", cue: keeperContactCue(context), atMs: 0 }];
  }
  if (/^K\.ONEONONE\.\d$/.test(code)) {
    return [{ milestone: "keeperContact", cue: "keeperCatch", atMs: 0 }];
  }
  return [];
}

export function resolveCueSequence(code, context = {}) {
  if (!code) return [];
  if (SHOT_START_CODES.has(code)) {
    // HEADER/BLAST/HARD get their own contact sample (v2-only); every other
    // shot type shares the plain "kick" pool, same as before v2.
    if (code === "HEADER") return [{ milestone: "shot", cue: "headerHit", atMs: 0 }];
    if (code === "BLAST" || code === "HARD") return [{ milestone: "shot", cue: "kickHard", atMs: 0 }];
    return [{ milestone: "shot", cue: "kick", atMs: 0 }];
  }
  if (code.startsWith("K.SAVE.")) return keeperSaveSequence(code, context);
  if (code.startsWith("K.ONEONONE.")) return oneOnOneSequence(code, context);
  if (MISS_SUFFIX.test(code) || code === "F.HEADER.OFF") {
    // Off-target finish/free-kick codes -- no kick (already fired at shot
    // start), just an optional restrained miss reaction.
    return [{ milestone: "terminal", cue: "missedChance", atMs: 260 }];
  }
  if (code === "D.BLOCK") {
    return [{ milestone: "shotBlock", cue: context.blockOutcome === "behind" ? "clearance" : "blocked", atMs: 0 }];
  }
  if (code.startsWith("FK.WALL.") && context.wallHit) {
    return [{ milestone: "shotBlock", cue: "blocked", atMs: 0 }];
  }
  // D.SLIDE.1/.2/.3 -- a slide-tackle engagement (selectEngagement() ->
  // resolveEngagement() in matchEngineCore.js), any outcome (won/loose/
  // foul); the contact itself sounds the same regardless of how it's
  // adjudicated. D.STAND.*/D.DUEL.* have no distinct v2 source and stay
  // unsonified, same as before.
  if (code.startsWith("D.SLIDE.")) {
    return [{ milestone: "tackle", cue: "slideTackle", atMs: 0 }];
  }
  if (code === "P.PASS") {
    return [{ milestone: "pass", cue: context.passKind === "long" ? "longPass" : "groundPass", atMs: 0 }];
  }
  // P.RECEIVE.* -- what a pass reception costs the receiver to control
  // (resolveReceive() in matchEngineCore.js; CLEAN/PROTECT/HEAVY/
  // KNOCK_FORWARD/LOSE are the engine's own codes, ADVANCE/LATE are
  // Match Lab's own follow-on/no-reach variants -- see match-lab.js's
  // resolvePass()). No fine-grained per-touch animation exists for these
  // yet, so each just gets one contact sound at the reception point.
  if (code === "P.RECEIVE.CLEAN" || code === "P.RECEIVE.PROTECT") {
    return [{ milestone: "touch", cue: "firstTouch", atMs: 0 }];
  }
  if (code === "P.RECEIVE.HEAVY") {
    return [{ milestone: "touch", cue: "heavyTouch", atMs: 0 }];
  }
  if (code === "P.RECEIVE.ADVANCE" || code === "P.RECEIVE.KNOCK_FORWARD") {
    return [{ milestone: "touch", cue: "carryTouch", atMs: 0 }];
  }
  if (code === "P.RECEIVE.LATE" || code === "P.RECEIVE.LOSE") {
    return [{ milestone: "touch", cue: "looseBall", atMs: 0 }];
  }
  if (code === "X1" || code === "X1.R" || code === "X1.D") {
    return [{ milestone: "cross", cue: "cross", atMs: 0 }];
  }
  if (code === "REBOUND.GOAL") {
    return [
      { milestone: "bounce", cue: "looseBall", atMs: 0 },
      { milestone: "net", cue: "net", atMs: 180 },
      { milestone: "terminal", cue: goalReactionCue(context), atMs: 340 },
    ];
  }
  if (code === "REBOUND.MISS") {
    return [
      { milestone: "bounce", cue: "looseBall", atMs: 0 },
      { milestone: "terminal", cue: "missedChance", atMs: 200 },
    ];
  }
  if (code === "EMPTY_NET") {
    return [
      { milestone: "net", cue: "net", atMs: 160 },
      { milestone: "terminal", cue: goalReactionCue(context), atMs: 320 },
    ];
  }
  if (code === "MATCH.START" || code === "KICKOFF") {
    return [{ milestone: "whistle", cue: "whistleStart", atMs: 0 }];
  }
  if (code === "MATCH.END" || code === "FULL_TIME") {
    return [{ milestone: "whistle", cue: "whistleEnd", atMs: 0 }];
  }
  // Draft-run.js's own goal events carry a `scenarioType` that's usually a
  // real engine code (already handled above), but not always -- several
  // goal routes (a clean solo finish, a corner header with no contested
  // save, etc) only ever set a descriptive route name like "solo" or
  // "corner-header", not a K.SAVE.*/EMPTY_NET code. context.isGoal is the
  // honest fallback for exactly that case: whatever the route, a goal
  // still needs its net + reaction cue, not silence just because the
  // specific route string isn't one of the patterns recognized above.
  if (context.isGoal) {
    return [
      { milestone: "net", cue: "net", atMs: 200 },
      { milestone: "terminal", cue: goalReactionCue(context), atMs: 360 },
    ];
  }
  return [];
}

// High-level entry point for callers with no fine-grained animation
// timeline of their own (draft-run.js's actual-match view -- a periodic
// snapshot renderer, not a frame-by-frame pitch animation). Schedules the
// shared cue sequence using its approximating fixed atMs offsets. Callers
// that DO have a real animation timeline (Match Lab's curved/multi-segment
// shot playback) should call resolveCueSequence() directly and trigger
// each entry's cue at the real matching waypoint instead of calling this.
export function playEvent(event, playbackContext = {}) {
  if (!enabled || !event) return;
  const code = event.code;
  const sequence = resolveCueSequence(code, playbackContext);
  const playbackId = playbackContext.playbackId ?? "default";
  const eventId = playbackContext.eventId ?? event.timelineId ?? event.id ?? code;
  for (const step of sequence) {
    const timer = trackTimer(setTimeout(() => {
      pendingTimers.delete(timer);
      playCue(step.cue, { playbackId, eventId: `${eventId}:${step.milestone}`, delayMs: 0 });
    }, Math.max(0, step.atMs || 0)));
  }
}

// Stops every currently-playing/scheduled sound immediately -- called on
// Reset, Reroll, Replay (restart), navigation away, or starting a new
// match, so a long crowd/whistle tail from the previous action never
// bleeds into the next one.
export function stopAll() {
  for (const timer of pendingTimers) clearTimeout(timer);
  pendingTimers.clear();
  for (const source of activeSources) {
    try { source.stop(); } catch { /* already stopped */ }
  }
  activeSources.clear();
  currentCrowdSource = null;
}
