// PARITY GUARD for the extension's hand-ported intervention parser.
//
// The Chrome extension has no module system and no build step, so it cannot import
// lib/extractInterventions.impl.js — extension/extract-interventions.js carries a copy of that file's fenced
// body. This test reads BOTH files, extracts the fenced region from each, asserts they are byte-identical,
// then evaluates the port and cross-checks it against the reference on a vector battery. If the port drifts,
// `npm test` goes red. (Same shape as lib/nameMatchParity.test.mjs — two copies of one parser must not drift.)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as reference from "./extractInterventions.ts";

const FENCE_START = "// __PARITY_START__";
const FENCE_END = "// __PARITY_END__";

function fencedBody(url, label) {
  const src = readFileSync(url, "utf8");
  const a = src.indexOf(FENCE_START);
  const b = src.indexOf(FENCE_END);
  assert.ok(a !== -1 && b !== -1 && a < b, `${label} must keep the __PARITY_START__/__PARITY_END__ fence`);
  return src.slice(a + FENCE_START.length, b);
}

const canonical = fencedBody(new URL("./extractInterventions.impl.js", import.meta.url), "lib/extractInterventions.impl.js");
const ported = fencedBody(new URL("../extension/extract-interventions.js", import.meta.url), "extension/extract-interventions.js");

test("the ported body is byte-identical to the canonical fenced body", () => {
  assert.equal(ported, canonical,
    "extension/extract-interventions.js has drifted from lib/extractInterventions.impl.js — re-copy the fenced body");
});

// eslint-disable-next-line no-new-func — evaluating our own repo text in an isolated scope.
const port = new Function(`${ported}\nreturn { extractInterventions };`)();

const NOTES = [
  "The RBT implemented functional communication training (FCT) and DRA, using prompting and prompt fading.",
  "Noncontingent reinforcement was delivered on a fixed-time schedule; redirection was used as needed.",
  "Session used a token economy and a visual schedule; behavior-specific praise was given throughout.",
  "The child used the network to watch videos on a tablet.", // 'net ' must NOT match 'network'
  "Errorless teaching during discrete trial training (DTT), with least-to-most prompting.",
  "A routine day — no specific interventions named.",
  "",
  "Premack principle: first the demand, then the break. Planned ignoring for attention-seeking.",
];

test("parity: the port agrees with the reference on every note", () => {
  for (const n of NOTES) {
    assert.deepEqual(port.extractInterventions(n), reference.extractInterventions(n), `disagreement on: ${JSON.stringify(n)}`);
  }
});

test("extractInterventions: cites only interventions present in the text (locked outputs)", () => {
  assert.deepEqual(
    reference.extractInterventions("functional communication training and DRA with prompting"),
    ["FCT", "DRA", "Prompting"],
  );
  assert.deepEqual(reference.extractInterventions("noncontingent reinforcement was used"), ["NCR"]);
  assert.deepEqual(reference.extractInterventions("just used the network switch"), []); // 'net ' ≠ 'network'
  assert.deepEqual(reference.extractInterventions(""), []);
  assert.deepEqual(reference.extractInterventions(null), []); // guarded — no throw
});
