// Tests for extension/data-tab-logic.js's weekly distribution.
//
// That file is a plain browser script loaded by popup.html — no module system, nothing to
// import. Rather than keeping a second copy of the algorithm here (which would drift and
// would test the copy, not the shipped code), the test slices the real functions out of
// the real file and evaluates them. If the source changes, this test sees the change.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../extension/data-tab-logic.js", import.meta.url), "utf8");

// Top-level declarations in that file all close on a `}` in column 0.
function sliceFn(name) {
  const start = SRC.indexOf(`\nfunction ${name}(`);
  assert.ok(start !== -1, `function ${name} not found in data-tab-logic.js`);
  const end = SRC.indexOf("\n}\n", start);
  assert.ok(end !== -1, `could not find the end of ${name}`);
  return SRC.slice(start, end + 3);
}

const NAMES = ["mulberry32", "simpleHash", "maladaptiveSeed", "maxDailyStep", "smoothDaily",
               "distributeMaladaptiveAcrossDays"];
const { distributeMaladaptiveAcrossDays: distribute, maladaptiveSeed, maxDailyStep } =
  new Function(`${NAMES.map(sliceFn).join("\n")}\nreturn { ${NAMES.join(", ")} };`)();

const sum = (a) => a.reduce((s, v) => s + v, 0);

// ── (a) determinism ─────────────────────────────────────────────────────────

test("identical inputs produce an identical array, every time", () => {
  for (const total of [0, 1, 4, 7, 23, 60, 120, 199]) {
    for (const days of [1, 2, 3, 5, 7]) {
      for (const seed of [0, 1, 987654, maladaptiveSeed("c1", "Aggression", "2026-08-24")]) {
        const first = distribute(total, days, seed);
        for (let i = 0; i < 5; i++) {
          assert.deepEqual(distribute(total, days, seed), first,
            `not deterministic for total=${total} days=${days} seed=${seed}`);
        }
      }
    }
  }
});

test("the same client + behavior + week always seeds the same stream", () => {
  const a = maladaptiveSeed("client-1", "Physical Aggression", "2026-08-24");
  const b = maladaptiveSeed("client-1", "Physical Aggression", "2026-08-24");
  assert.equal(a, b);
  assert.deepEqual(distribute(47, 5, a), distribute(47, 5, b));
});

test("different weeks (and different behaviors) do not collapse to one distribution", () => {
  const w1 = distribute(47, 5, maladaptiveSeed("c", "Aggression", "2026-08-17"));
  const w2 = distribute(47, 5, maladaptiveSeed("c", "Aggression", "2026-08-24"));
  const other = distribute(47, 5, maladaptiveSeed("c", "Elopement", "2026-08-17"));
  assert.notDeepEqual(w1, w2, "consecutive weeks produced an identical array");
  assert.notDeepEqual(w1, other, "two behaviors produced an identical array");
});

// ── (b) smoothing, brute-forced ─────────────────────────────────────────────

test("no consecutive pair exceeds the step cap — total 0-200 x days 1-7", () => {
  const seeds = [0, 7, 12345, 999983];
  let checked = 0;
  for (let total = 0; total <= 200; total++) {
    for (let days = 1; days <= 7; days++) {
      for (const seed of seeds) {
        const vals = distribute(total, days, seed);
        if (vals.length < 2) { checked++; continue; }
        const step = total < days ? 1 : maxDailyStep(total / days);
        for (let i = 1; i < vals.length; i++) {
          assert.ok(Math.abs(vals[i] - vals[i - 1]) <= step,
            `step ${Math.abs(vals[i] - vals[i - 1])} > cap ${step} at index ${i} ` +
            `for total=${total} days=${days} seed=${seed}: ${JSON.stringify(vals)}`);
        }
        checked++;
      }
    }
  }
  assert.equal(checked, 201 * 7 * seeds.length);
});

test("the measured regression case is smooth", () => {
  // 120 over 5 days used to produce e.g. [34, 26, 5, 30, 25] — a 21-unit drop.
  const vals = distribute(120, 5, maladaptiveSeed("c", "Aggression", "2026-08-24"));
  const cap = maxDailyStep(24);
  assert.equal(sum(vals), 120);
  for (let i = 1; i < vals.length; i++) {
    assert.ok(Math.abs(vals[i] - vals[i - 1]) <= cap, JSON.stringify(vals));
  }
});

// ── (c) non-integer input ───────────────────────────────────────────────────

test("a fractional total yields integers and an exact sum", () => {
  const cases = [[2.5, 5], [12.5, 5], [0.4, 3], [7.7, 4], [99.5, 7], [1.5, 2]];
  for (const [total, days] of cases) {
    const vals = distribute(total, days, 42);
    assert.ok(vals.every(Number.isInteger), `non-integer day in ${JSON.stringify(vals)}`);
    assert.equal(sum(vals), Math.round(total),
      `sum ${sum(vals)} != round(${total}) in ${JSON.stringify(vals)}`);
  }
});

// ── preserved invariants ────────────────────────────────────────────────────

test("sum is exact, and every value is an integer", () => {
  for (let total = 0; total <= 200; total++) {
    for (let days = 1; days <= 7; days++) {
      for (const seed of [0, 3, 77777]) {
        const vals = distribute(total, days, seed);
        assert.equal(vals.length, days);
        assert.ok(vals.every(Number.isInteger), `total=${total} days=${days}`);
        assert.equal(sum(vals), total, `total=${total} days=${days} -> ${JSON.stringify(vals)}`);
      }
    }
  }
});

test("zeros appear only when the total cannot cover every day", () => {
  for (let total = 1; total <= 200; total++) {
    for (let days = 1; days <= 7; days++) {
      if (total < days) continue;
      for (const seed of [0, 3, 77777]) {
        const vals = distribute(total, days, seed);
        assert.ok(vals.every((v) => v >= 1),
          `a day dropped to 0 with total=${total} days=${days}: ${JSON.stringify(vals)}`);
      }
    }
  }
});

test("the mean is untouched by smoothing", () => {
  for (const [total, days] of [[120, 5], [47, 7], [200, 3], [13, 6]]) {
    const vals = distribute(total, days, 11);
    assert.equal(sum(vals) / days, total / days);
  }
});

test("degenerate inputs stay safe", () => {
  assert.deepEqual(distribute(10, 0, 1), []);
  assert.deepEqual(distribute(0, 5, 1), [0, 0, 0, 0, 0]);
  assert.deepEqual(distribute(-4, 5, 1), [0, 0, 0, 0, 0]);
  assert.deepEqual(distribute(-4, 1, 1), [0]);
  assert.deepEqual(distribute(3, 1, 1), [3]);
  assert.deepEqual(distribute(3.6, 1, 1), [4]);
});
