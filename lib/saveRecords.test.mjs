// What the extension PERSISTS for an autofilled session.
//
// The record builders live in extension/popup.js (no module system, no build step), so this
// slices them out of the real file and exercises them — the same technique as
// lib/maladaptiveDistribution.test.mjs. It tests the shipped code, not a copy.
//
// The invariant under test is one sentence: a saved row must describe the session that was
// actually written into Office Puzzle. Before this, the week save sent one flat average
// repeated across every day while OP received a varied distribution; the +/- pattern clicked
// into OP was discarded; and correct/incorrect were 0/0 on every row while total_trials and
// observed_percentage carried real numbers.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../extension/popup.js", import.meta.url), "utf8");

function sliceFn(name) {
  const start = SRC.indexOf(`\nfunction ${name}(`);
  assert.ok(start !== -1, `function ${name} not found in popup.js`);
  const end = SRC.indexOf("\n}\n", start);
  assert.ok(end !== -1, `could not find the end of ${name}`);
  return SRC.slice(start, end + 3);
}

const NAMES = ["countCorrect", "buildMaladaptiveRecords", "buildReplacementRecords"];
const { buildMaladaptiveRecords, buildReplacementRecords, countCorrect } =
  new Function(`${NAMES.map(sliceFn).join("\n")}\nreturn { ${NAMES.join(", ")} };`)();

const DAYS = ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28"];
const BASE = { clientId: "c1", weekStart: "2026-08-24", weekEnd: "2026-08-30" };

// ── 1. daily_values round-trips, and its sum is the weekly total ────────────

test("dailyValues is the array that was filled, day for day", () => {
  const dailyVals = [7, 5, 9, 6, 8];
  const fills = { Aggression: DAYS.map((d, i) => ({ sessionDate: d, value: dailyVals[i] })) };
  const rows = buildMaladaptiveRecords({
    ...BASE, days: DAYS, items: [{ name: "Aggression", type: "maladaptive", projectedValue: 35 }],
    fills, userConfirmed: false, autofillCompleted: true, valueOrigin: "estimated",
  });
  assert.equal(rows.length, DAYS.length);
  for (const r of rows) assert.deepEqual(r.dailyValues, dailyVals, "every row carries the week");
  assert.deepEqual(rows.map((r) => r.frequency), dailyVals, "per-day frequency, not a flat average");
});

test("the sum of dailyValues equals the weekly total", () => {
  for (const dailyVals of [[7, 5, 9, 6, 8], [1, 0, 0, 1, 0], [20, 20, 20, 20, 20], [0, 0, 0, 0, 0]]) {
    const total = dailyVals.reduce((a, b) => a + b, 0);
    const fills = { B: DAYS.map((d, i) => ({ sessionDate: d, value: dailyVals[i] })) };
    const rows = buildMaladaptiveRecords({
      ...BASE, days: DAYS, items: [{ name: "B", type: "maladaptive", projectedValue: total }],
      fills, valueOrigin: "estimated",
    });
    assert.equal(rows[0].dailyValues.reduce((a, b) => a + b, 0), total);
    assert.equal(rows.reduce((s, r) => s + r.frequency, 0), total,
      "per-day frequencies also sum to the week");
  }
});

test("a day OP did not receive is recorded as 0, not dropped or invented", () => {
  const fills = { B: [{ sessionDate: DAYS[1], value: 4 }] };
  const rows = buildMaladaptiveRecords({
    ...BASE, days: DAYS, items: [{ name: "B", type: "maladaptive", projectedValue: 4 }],
    fills, valueOrigin: "estimated",
  });
  assert.deepEqual(rows[0].dailyValues, [0, 4, 0, 0, 0]);
});

// ── 2. alternated_sequence round-trips ──────────────────────────────────────

test("the +/- pattern clicked into OP is persisted, per day", () => {
  const seqA = ["+", "+", "-", "+", "-", "+", "+", "+", "-", "+"];
  const seqB = ["-", "+", "+", "+", "+", "-", "+", "+", "+", "+"];
  const fills = { Manding: [
    { sessionDate: DAYS[0], pct: 70, trials: 10, sequence: seqA },
    { sessionDate: DAYS[1], pct: 80, trials: 10, sequence: seqB },
  ]};
  const rows = buildReplacementRecords({
    ...BASE, days: DAYS.slice(0, 2), trials: 10,
    items: [{ name: "Manding", type: "replacement", projectedValue: 75 }],
    fills, valueOrigin: "estimated",
  });
  assert.equal(rows[0].alternatedSequence, seqA.join(""));
  assert.equal(rows[1].alternatedSequence, seqB.join(""));
  assert.equal(rows[0].observedPercentage, 70, "the day's own percentage, not the weekly average");
  assert.equal(rows[1].observedPercentage, 80);
});

// ── 3. correct_count / incorrect_count reconcile with the sequence ──────────

test("correct_count is the count of '+' in the sequence being saved", () => {
  const cases = [
    ["+++++-----", 5, 5],
    ["++++++++++", 10, 0],
    ["----------", 0, 10],
    ["+-+-+-+-+-", 5, 5],
  ];
  for (const [seq, correct, incorrect] of cases) {
    const fills = { S: [{ sessionDate: DAYS[0], pct: correct * 10, trials: 10, sequence: seq.split("") }] };
    const rows = buildReplacementRecords({
      ...BASE, days: [DAYS[0]], trials: 10,
      items: [{ name: "S", type: "replacement", projectedValue: correct * 10 }],
      fills, valueOrigin: "estimated",
    });
    assert.equal(rows[0].correctCount, correct, seq);
    assert.equal(rows[0].incorrectCount, incorrect, seq);
    assert.equal(rows[0].correctCount + rows[0].incorrectCount, rows[0].totalTrials,
      "the three fields must reconcile");
    assert.equal(rows[0].alternatedSequence, seq);
  }
});

test("countCorrect accepts the fullwidth ＋ Office Puzzle renders", () => {
  assert.equal(countCorrect(["+", "＋", "-", "－"]), 2);
  assert.equal(countCorrect([]), 0);
  assert.equal(countCorrect(null), 0);
});

// ── 4. value_origin is never NULL on a new row ──────────────────────────────

test("no builder emits a row without a value_origin", () => {
  const items = [{ name: "X", type: "maladaptive", projectedValue: 10 }];
  const ritems = [{ name: "Y", type: "replacement", projectedValue: 60 }];
  for (const origin of ["estimated", "rbt_edited", "observed"]) {
    for (const fills of [null, {}]) {
      const m = buildMaladaptiveRecords({ ...BASE, days: DAYS, items, fills, valueOrigin: origin });
      const r = buildReplacementRecords({ ...BASE, days: DAYS, items: ritems, fills, trials: 10, valueOrigin: origin });
      for (const row of [...m, ...r]) {
        assert.equal(row.valueOrigin, origin);
        assert.ok(row.valueOrigin != null && row.valueOrigin !== "",
          "a new row must never be written with a null value_origin");
      }
    }
  }
});

// ── 5. autofill never claims a human confirmation ───────────────────────────

test("autofill's own auto-save writes user_confirmed false", () => {
  const m = buildMaladaptiveRecords({
    ...BASE, days: DAYS, items: [{ name: "X", type: "maladaptive", projectedValue: 10 }],
    fills: null, userConfirmed: false, valueOrigin: "estimated",
  });
  const r = buildReplacementRecords({
    ...BASE, days: DAYS, trials: 10, items: [{ name: "Y", type: "replacement", projectedValue: 60 }],
    fills: null, userConfirmed: false, valueOrigin: "estimated",
  });
  for (const row of [...m, ...r]) assert.equal(row.userConfirmed, false);
});

test("an omitted userConfirmed is false, never undefined — the flag is always stated", () => {
  const rows = buildMaladaptiveRecords({
    ...BASE, days: [DAYS[0]], items: [{ name: "X", type: "maladaptive", projectedValue: 3 }],
    fills: null, valueOrigin: "estimated",
  });
  assert.equal(rows[0].userConfirmed, false);
  assert.equal(typeof rows[0].userConfirmed, "boolean");
});

test("an explicit human confirmation is the only thing that sets it true", () => {
  const rows = buildMaladaptiveRecords({
    ...BASE, days: [DAYS[0]], items: [{ name: "X", type: "maladaptive", projectedValue: 3 }],
    fills: null, userConfirmed: true, valueOrigin: "estimated",
  });
  // The value is still an estimate; the human attested it. The two are orthogonal, which is
  // why value_origin does not become 'rbt_edited' just because someone pressed Save.
  assert.equal(rows[0].userConfirmed, true);
  assert.equal(rows[0].valueOrigin, "estimated");
});

// ── fallback when the save does not follow an autofill ──────────────────────

test("with no captured fill, rows still carry origin and an unconfirmed flag", () => {
  const rows = buildReplacementRecords({
    ...BASE, days: [DAYS[0]], trials: 12,
    items: [{ name: "Y", type: "replacement", projectedValue: 50 }],
    fills: null, valueOrigin: "estimated",
  });
  assert.equal(rows[0].alternatedSequence, null, "no pattern is invented");
  assert.equal(rows[0].correctCount, 6, "derived from the percentage when no sequence exists");
  assert.equal(rows[0].incorrectCount, 6);
  assert.equal(rows[0].totalTrials, 12);
  assert.equal(rows[0].valueOrigin, "estimated");
  assert.equal(rows[0].userConfirmed, false);
});

test("no captured fill for maladaptive leaves dailyValues null rather than fabricating a week", () => {
  const rows = buildMaladaptiveRecords({
    ...BASE, days: DAYS, items: [{ name: "X", type: "maladaptive", projectedValue: 20 }],
    fills: null, valueOrigin: "estimated",
  });
  assert.equal(rows[0].dailyValues, null);
  assert.equal(rows[0].frequency, 4, "falls back to the flat average only when nothing was captured");
});
