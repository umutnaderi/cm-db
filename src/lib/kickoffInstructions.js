import { yardDistance } from "./pitchGeometry.js";

export const KICKOFF_OPTIONS = Object.freeze([
  ["mixed", "Mixed"], ["keep-possession", "Keep possession"],
  ["play-backwards", "Play backwards"], ["build-midfield", "Build through midfield"],
  ["attack-quickly", "Attack quickly"], ["play-into-space", "Play into space"],
  ["go-wide", "Go wide early"], ["switch-flank", "Switch flank"],
  ["target-forward", "Hit target forward"], ["go-long", "Go long"],
  ["territory", "Attacking-third throw-in & press"],
]);

// The first touch and following three decisions share a plan. Losing the
// ball cancels it. All scores apply to existing legal candidates; execution
// still resolves pressure, accuracy, interceptions and aerial contests.
export function applyKickoffInstructions(candidates, groups, direction, plan) {
  if (!plan || plan.remaining <= 0 || groups.owner.team !== plan.team) return candidates;
  const { owner, teammates = [], opponents = [] } = groups;
  const instruction = plan.instruction ?? "mixed";
  if (instruction === "play-backwards" && ["GK", "DC", "SW"].includes(owner.positionalSlot)) {
    plan.remaining = 0;
    return candidates;
  }
  const forward = direction === "up" ? -1 : 1;
  const passes = candidates.filter((c) => ["pass", "through"].includes(c.type) && c.target);
  for (const candidate of candidates) {
    const point = candidate.moveTo ?? candidate.target ?? owner;
    const distance = yardDistance(owner, point);
    const progress = (point.y - owner.y) * forward;
    const pass = passes.includes(candidate);
    const pressureDistance = Math.min(40, ...opponents.map((entry) => yardDistance(entry, point)));
    const safe = pass && distance < 28 && pressureDistance > 5;
    let bias = 0;
    // Even Mixed must assess the position it is about to carry INTO.
    if (["carry", "dribble"].includes(candidate.type)) {
      const support = teammates.filter((entry) => entry.role !== "keeper" && yardDistance(entry, point) < 22).length;
      if (support === 0) bias -= 0.65;
      if (pressureDistance < 8 && passes.some((c) => yardDistance(owner, c.target) < 30)) bias -= 0.4;
    }
    switch (instruction) {
      case "keep-possession": bias += safe ? 0.85 : pass ? 0.15 : -0.6; break;
      case "play-backwards":
        bias += pass && progress < -3 ? 1.1 : safe ? 0.15 : -0.5; break;
      case "build-midfield":
        bias += pass && /^(DMC|MC|AMC)$/.test(candidate.target.positionalSlot ?? "") && Math.abs(point.x - 50) < 23 ? 0.9 : safe ? 0.2 : -0.25; break;
      case "attack-quickly": bias += pass && progress > 3 ? 0.8 : candidate.type === "hold" ? -0.6 : 0; break;
      case "play-into-space": bias += candidate.type === "through" ? 1 : pass && progress > 8 ? 0.4 : -0.2; break;
      case "go-wide": bias += pass && Math.abs(point.x - 50) > 23 ? 0.9 : -0.15; break;
      case "switch-flank": {
        const firstSide = plan.firstSide ?? (owner.x <= 50 ? -1 : 1);
        const desiredSide = plan.remaining >= 3 ? firstSide : -firstSide;
        bias += pass && (point.x - 50) * desiredSide > 16 ? 1 : -0.2;
        break;
      }
      case "target-forward":
        bias += pass && (/^(FC|ST)$/.test(candidate.target.positionalSlot ?? "") || /target/i.test(candidate.target.tacticalRole ?? "")) ? 1.2 : -0.3;
        if (pass && bias > 0) candidate.forcedPassType = "lofted";
        break;
      case "go-long":
        bias += pass && progress > 12 ? Math.min(1.4, distance / 40) : -0.3;
        if (pass && progress > 12) candidate.forcedPassType = "lofted";
        break;
      case "territory":
        // A deliberate territorial delivery uses the real pass flight and
        // boundary classifier. It can be intercepted or miss its intended exit.
        if (pass && candidate.type === "pass") {
          candidate.moveTo = { x: owner.x <= 50 ? -3 : 103, y: direction === "up" ? 23 : 77 };
          candidate.forcedPassType = "lofted";
          candidate.joint = null;
          candidate.kickoffTerritory = true;
          bias += 2;
        } else bias -= 1;
        break;
    }
    candidate.utility += bias;
    candidate.kickoffInstructionBias = bias;
  }
  return candidates;
}
