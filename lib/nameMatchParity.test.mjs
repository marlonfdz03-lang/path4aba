// PARITY GUARD for the extension's hand-ported name matcher.
//
// The Chrome extension has no module system and no build step, so it cannot import
// lib/nameMatch.impl.js — extension/name-match.js carries a copy of that file's fenced body.
// This test closes the divergence WITHOUT a build step: it reads BOTH files as text,
// extracts the fenced region from each, asserts they are byte-identical, then evaluates
// the port and cross-checks it against the reference on every vector that matters.
// If the port ever drifts, `npm test` goes red.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as reference from "./nameMatch.ts";

const FENCE_START = "// __PARITY_START__";
const FENCE_END = "// __PARITY_END__";

function fencedBody(url, label) {
  const src = readFileSync(url, "utf8");
  const a = src.indexOf(FENCE_START);
  const b = src.indexOf(FENCE_END);
  assert.ok(a !== -1 && b !== -1 && a < b,
    `${label} must keep the __PARITY_START__/__PARITY_END__ fence`);
  return src.slice(a + FENCE_START.length, b);
}

const canonical = fencedBody(new URL("./nameMatch.impl.js", import.meta.url), "lib/nameMatch.impl.js");
const ported = fencedBody(new URL("../extension/name-match.js", import.meta.url), "extension/name-match.js");

test("the ported body is byte-identical to the canonical fenced body", () => {
  assert.equal(ported, canonical,
    "extension/name-match.js has drifted from lib/nameMatch.impl.js — re-copy the fenced body");
});

// eslint-disable-next-line no-new-func — evaluating our own repo text in an isolated scope.
const port = new Function(
  `${ported}\nreturn { normName, stripOuterQuotes, matchWords, acronymsOf, sharedAcronym, TIERS, namesMatch, canonicalName, resolveName, buildVariantIndex };`
)();

const NAMES = [
  "Self-Injurious Behavior (SIB)", "Self-Injury Behaviors (SIB)", "SIB", "Self Injury",
  "Defiant Behavior", "Disruptive Behavior", "Off-Task Behavior", "Non-Compliance",
  "Physical Aggression Toward Peers", "Physical Aggression Toward Adults",
  "Elopement", "Elopement from Area", "Tantrum", "Tantrum Behavior",
  "Functional Communication Training (FCT)", "Functional Communication (FCT)",
  "Task Refusal (TR)", "Toileting Routine (TR)",
  '"Manding for Break"', "Manding for Break", "  Tantrum  ", "",
];

test("parity: namesMatch agrees on every name pair at every tier", () => {
  let checked = 0;
  for (const tier of reference.TIERS) {
    for (const a of NAMES) {
      for (const b of NAMES) {
        assert.equal(port.namesMatch(a, b, tier), reference.namesMatch(a, b, tier),
          `disagreement at ${tier}: "${a}" / "${b}"`);
        checked++;
      }
    }
  }
  assert.equal(checked, reference.TIERS.length * NAMES.length * NAMES.length);
});

test("parity: the helpers agree", () => {
  for (const n of NAMES) {
    assert.equal(port.normName(n), reference.normName(n));
    assert.equal(port.stripOuterQuotes(n), reference.stripOuterQuotes(n));
    assert.deepEqual(port.acronymsOf(n), reference.acronymsOf(n));
    assert.deepEqual(port.matchWords(reference.normName(n)), reference.matchWords(reference.normName(n)));
  }
  assert.deepEqual(port.TIERS, reference.TIERS);
});

test("parity: canonicalName and resolveName agree", () => {
  const pool = ["Physical Aggression Toward Peers", "Elopement", "Self-Injurious Behavior (SIB)"];
  for (const tier of reference.TIERS) {
    for (const n of NAMES) {
      assert.equal(port.canonicalName(n, pool, tier), reference.canonicalName(n, pool, tier),
        `canonicalName disagreement at ${tier} for "${n}"`);
      assert.deepEqual(port.resolveName(n, pool, tier), reference.resolveName(n, pool, tier),
        `resolveName disagreement at ${tier} for "${n}"`);
    }
  }
});

test("parity: buildVariantIndex and the variants layer agree", () => {
  const rows = [{ canonical_key: "self injurious behavior", display_name: "Self-Injurious Behavior",
                  variants: ["SIB", "Self Injury"] }];
  const a = port.buildVariantIndex(rows);
  const b = reference.buildVariantIndex(rows);
  assert.deepEqual(a, b);
  for (const tier of reference.TIERS) {
    assert.equal(port.namesMatch("SIB", "Self Injury", tier, { variantIndex: a }),
                 reference.namesMatch("SIB", "Self Injury", tier, { variantIndex: b }));
  }
});
