export const TOTAL_WEEKS = 26;

// Exported so callers that need a deterministic stream keyed off a string (the Data tab's
// quality adjustment) reuse this one instead of adding a third copy of the same RNG.
export function hashStr(s: string): number {
  return s.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0);
}

export function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildProjection(
  histValues: number[],
  sto: { baseline: number; goal: number; totalWeeks: number | null },
  nameIndex: number,
): number[] {
  const rawStart = histValues.length > 0 ? histValues[histValues.length - 1] : sto.baseline;
  const start = Math.round(rawStart);
  const { goal } = sto;

  if (start === goal) return [];

  const rising = goal > start;
  const goalDir: 1 | -1 = rising ? 1 : -1;
  const totalDist = Math.abs(goal - start);

  const stagger = (Math.abs(nameIndex) * 3) % 11;
  const completionWeek = Math.ceil(totalDist * 1.2) + stagger;

  const maxStep = Math.max(1, Math.min(5, Math.ceil(totalDist / 12)));

  const seed = Math.abs(hashStr(String(nameIndex).padStart(4, 'X')));
  const rng = mulberry32(seed);

  const out: number[] = [];
  let prev = start;
  let consecCount = 0;
  let lastDir = 0;

  for (let w = 0; w < TOTAL_WEEKS; w++) {
    if (prev === goal) {
      out.push(goal);
      continue;
    }

    const distLeft = Math.abs(goal - prev);
    const weeksLeft = Math.max(1, completionWeek - w);
    const neededPace = distLeft / weeksLeft;

    let towardGoal: boolean;
    if (consecCount >= 3) {
      towardGoal = lastDir !== goalDir;
    } else if (neededPace >= maxStep * 0.85) {
      towardGoal = true;
    } else {
      towardGoal = rng() < 0.70;
    }

    const changeDir: 1 | -1 = towardGoal ? goalDir : (-goalDir as 1 | -1);

    const magCap = towardGoal ? Math.min(maxStep, distLeft) : 1;
    const mag = Math.floor(rng() * magCap) + 1;

    let v = prev + changeDir * mag;

    const slack = Math.max(1, Math.floor(totalDist * 0.1));
    if (rising) {
      v = Math.max(start - slack, Math.min(goal, v));
    } else {
      v = Math.min(start + slack, Math.max(goal, v));
    }

    v = Math.round(v);

    if (v === prev) {
      v = Math.round(rising ? Math.min(goal, prev + 1) : Math.max(goal, prev - 1));
    }

    const actualDir: 1 | -1 = v > prev ? 1 : -1;
    if (actualDir === lastDir) {
      consecCount++;
    } else {
      consecCount = 1;
      lastDir = actualDir;
    }

    out.push(v);
    prev = v;
  }

  return out;
}
