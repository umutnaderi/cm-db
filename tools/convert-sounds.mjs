// One-time (re-runnable) build step: transcodes a CURATED subset of the raw
// sounds/*.wav library (146 files, ~155MB, mostly uncompressed PCM -- see
// MATCH_LAB_PLAN.md's audio section for the full inventory) into small
// compressed MP3s under sounds/v1/, matching the versioned filenames
// referenced by SOUND_BANK in src/lib/matchSound.js.
//
// Deliberately NOT "convert everything" -- only the ~19 cues the shared
// audio director's first implementation actually plays. The raw WAV folder
// stays out of any deployed output (see .vercelignore / tools/build-pages.mjs).
//
// Two source-file categories were found while inventorying sounds/ (by
// duration, via ffprobe -- not by listening, which this tool has no way to
// do): most named effects are genuinely short (0.2-0.8s foley), but a
// handful of similarly-named files run 3-7+ seconds (e.g. shotBlocked.wav
// at 4.27s, missedChance.wav at 7.27s, chanceHitsThePost.wav at 5.6s) --
// long enough that they may bundle a spoken commentary line or an extended
// crowd take, not a single foley hit. Since this tool can't listen to
// verify, every source clip gets a hard duration cap (short for pure
// contact SFX, longer for deliberately ambient crowd/whistle cues) rather
// than trusting the full file -- caps the risk of shipping unreviewed
// commentary under the guise of a generic effect, per the explicit
// instruction that long commentary only ships after a real review pass.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(".");
const sourceDir = join(root, "sounds");
const outputDir = join(root, "sounds", "v1");

// category -> { capMs, bitrate, channels } -- SFX are capped tight (snappy,
// fire in rapid succession during a single shot sequence); crowd/whistle
// cues are allowed to breathe longer since they're meant to linger as
// ambience, not overlap with the next contact sound.
const CATEGORIES = {
  sfx: { capMs: 900, bitrate: "80k", channels: 1 },
  crowd: { capMs: 2600, bitrate: "112k", channels: 2 },
};

// [outputFilename, sourceWavFilename, category]
const CONVERSIONS = [
  // -- kick (shot/strike begins) --
  ["ball-kick-v1.mp3", "ballKick.wav", "sfx"],
  ["ball-kick-v2.mp3", "ballKick_2.wav", "sfx"],
  // ballKick_5.wav (formerly ball-kick-v3) dropped -- reviewed by ear and
  // judged not a realistic kick sound, not just an unused extra variant.
  // -- passing --
  ["ground-pass-v1.mp3", "groundPass.wav", "sfx"],
  ["ground-pass-v2.mp3", "groundPass_2.wav", "sfx"],
  // longPass.wav itself (no suffix) is a 4.57s outlier next to its own
  // _2/_3 siblings (0.6-0.67s) -- excluded as untrustworthy at the time.
  // The _2/_3 takes WERE converted (formerly long-pass-v1/v2) but got cut
  // on review too ("nothing realistic") -- SOUND_BANK.longPass now reuses
  // groundPass instead. No conversion entry for them until a better source
  // shows up.
  // -- cross --
  ["cross-v1.mp3", "cross.wav", "sfx"],
  ["cross-v2.mp3", "lowCross.wav", "sfx"],
  // -- keeper --
  ["gk-catch-v1.mp3", "gkSave.wav", "sfx"],
  ["gk-catch-v2.mp3", "gkSave_3.wav", "sfx"],
  ["gk-catch-v3.mp3", "gkSave_4.wav", "sfx"],
  ["gk-parry-v1.mp3", "gkSaveBounce.wav", "sfx"],
  ["gk-parry-v2.mp3", "gkSaveBounce_2.wav", "sfx"],
  ["gk-power-save-v1.mp3", "gkSaveBlast.wav", "sfx"],
  ["gk-power-save-v2.mp3", "gkSaveBlast_2.wav", "sfx"],
  // -- frame / net --
  ["post-v1.mp3", "hitsThePost.wav", "sfx"],
  ["goal-net-v1.mp3", "goalNet.wav", "sfx"],
  ["goal-net-v2.mp3", "netSound.wav", "sfx"],
  // -- blocked / cleared -- shotBlocked.wav was the only "blocked" source
  // and ran 4.27s uncapped; converted (formerly shot-blocked-v1) but cut
  // on review ("abysmal"). SOUND_BANK.blocked now reuses clearance
  // instead. No conversion entry for it until a better source shows up.
  ["clearance-v1.mp3", "ballClearance.wav", "sfx"],
  // -- restrained crowd reactions --
  ["missed-chance-v1.mp3", "missedChance.wav", "crowd"],
  ["goal-for-v1.mp3", "homeGoal.wav", "crowd"],
  ["goal-against-v1.mp3", "awayGoal.wav", "crowd"],
  // -- whistles --
  ["whistle-start-v1.mp3", "startingWhistle.wav", "crowd"],
  ["whistle-end-v1.mp3", "finalWhistle.wav", "crowd"],
];

function convertOne(outputName, sourceName, categoryKey) {
  const category = CATEGORIES[categoryKey];
  const sourcePath = join(sourceDir, sourceName);
  const outputPath = join(outputDir, outputName);
  if (!existsSync(sourcePath)) {
    console.error(`MISSING SOURCE: ${sourceName} (skipping ${outputName})`);
    return false;
  }
  const capSeconds = (category.capMs / 1000).toFixed(3);
  const fadeStart = Math.max(0, category.capMs - 120) / 1000;
  // silenceremove: strips leading silence dynamically (real "trim
  // unnecessary silence", not a fixed guess) before the hard duration cap
  // applies. loudnorm: single-pass level normalization so cues don't vary
  // wildly in perceived loudness against each other. atrim+afade: the
  // duration cap + a 120ms fade-out so a hard cut never clicks/pops.
  const filter = [
    "silenceremove=start_periods=1:start_duration=0.05:start_threshold=-45dB",
    `atrim=0:${capSeconds}`,
    `afade=t=out:st=${fadeStart.toFixed(3)}:d=0.12`,
    "loudnorm=I=-16:TP=-1.5:LRA=11",
    `aformat=channel_layouts=${category.channels === 1 ? "mono" : "stereo"}`,
  ].join(",");
  const args = [
    "-y", "-i", sourcePath,
    "-af", filter,
    "-ac", String(category.channels),
    "-b:a", category.bitrate,
    "-codec:a", "libmp3lame",
    outputPath,
  ];
  const result = spawnSync("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
  if (result.status !== 0) {
    console.error(`FFMPEG FAILED: ${sourceName} -> ${outputName}`);
    console.error(result.stderr?.toString().slice(-800));
    return false;
  }
  return true;
}

mkdirSync(outputDir, { recursive: true });
let ok = 0;
let failed = 0;
for (const [outputName, sourceName, categoryKey] of CONVERSIONS) {
  const success = convertOne(outputName, sourceName, categoryKey);
  if (success) ok += 1;
  else failed += 1;
}
console.log(`Converted ${ok}/${CONVERSIONS.length} sounds to ${outputDir} (${failed} failed).`);
if (failed > 0) process.exitCode = 1;
