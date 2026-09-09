import assert from "node:assert/strict";
import { createMatchSession } from "../src/lib/matchSession.js";

const scheduled = [];
const session = createMatchSession({
  durationMs: 5000,
  initialElapsedMs: 2000,
  initialIndex: 4,
  initialContinuation: { token: "stoppage" },
  schedule: (fn) => { scheduled.push(fn); return fn; },
  cancel: () => {},
  simulate: ({ index, continuation, elapsedMs }) => {
    assert.equal(index, 4);
    assert.deepEqual(continuation, { token: "stoppage" });
    assert.equal(elapsedMs, 2000);
    return { durationMs: 1000, continuation: { token: "resumed" } };
  },
});
session.start();
scheduled.shift()();
const chunk = session.take();
assert.equal(chunk.index, 4);
assert.equal(chunk.startMs, 2000);
assert.equal(chunk.endMs, 3000);
console.log("PASS match session resumes from a preserved stoppage clock and continuation");
