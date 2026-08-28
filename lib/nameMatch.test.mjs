// Regression battery for the shared name matcher.
//
// The point of this file is the TIER MATRIX. Every required pair is asserted at all three
// tiers, not just the one that happens to be convenient, so widening a tier fails here
// rather than quietly changing which cell an autofill writes into.

import test from "node:test";
import assert from "node:assert/strict";
import {
  normName, stripOuterQuotes, matchWords, acronymsOf, sharedAcronym,
  namesMatch, canonicalName, resolveName, buildVariantIndex, TIERS,
} from "./nameMatch.ts";

const SIB_A = "Self-Injurious Behavior (SIB)";
const SIB_B = "Self-Injury Behaviors (SIB)";

// ── the three required cases, at EVERY tier ─────────────────────────────────

test("REQUIRED: the SIB pair matches at every tier", () => {
  for (const tier of TIERS) {
    assert.ok(namesMatch(SIB_A, SIB_B, tier), `should match at ${tier}`);
    assert.ok(namesMatch(SIB_B, SIB_A, tier), `should match at ${tier} (reversed)`);
  }
});

test("REQUIRED: Defiant Behavior / Disruptive Behavior must NOT match on the apply path", () => {
  // strict is the apply tier — a shared-word match here writes onto the wrong target.
  assert.equal(namesMatch("Defiant Behavior", "Disruptive Behavior", "strict"), false);
  assert.equal(namesMatch("Defiant Behavior", "Disruptive Behavior", "shared2"), false);
  // loose matches on the single shared word "behavior". This is PRE-EXISTING behavior,
  // asserted here so it stays visible: it is why loose must never reach the apply path.
  assert.equal(namesMatch("Defiant Behavior", "Disruptive Behavior", "loose"), true);
});

test("REQUIRED: Physical Aggression Toward Peers / Toward Adults must NOT match on the apply path", () => {
  const P = "Physical Aggression Toward Peers";
  const A = "Physical Aggression Toward Adults";
  assert.equal(namesMatch(P, A, "strict"), false);
  // shared2 and loose DO merge these on 3 shared words. Pre-existing, and the reason
  // server-side consolidation can fold two distinct targets into one series.
  assert.equal(namesMatch(P, A, "shared2"), true);
  assert.equal(namesMatch(P, A, "loose"), true);
});

// ── the strict tier's documented reason ─────────────────────────────────────

test("strict rejects every pair that merely shares the word Behavior", () => {
  const sharers = ["Defiant Behavior", "Off-Task Behavior", "Disruptive Behavior", SIB_A];
  for (let i = 0; i < sharers.length; i++) {
    for (let j = 0; j < sharers.length; j++) {
      if (i === j) continue;
      // SIB_A vs itself-family aside, no pair here shares an acronym.
      assert.equal(namesMatch(sharers[i], sharers[j], "strict"), false,
        `${sharers[i]} / ${sharers[j]} must not match at strict`);
    }
  }
});

test("strict still matches exact and substring, as it always did", () => {
  assert.ok(namesMatch("Tantrum", "tantrum", "strict"));
  assert.ok(namesMatch("Tantrum", "Tantrum Behavior", "strict"));
  assert.ok(namesMatch("Elopement from Area", "Elopement", "strict"));
  assert.ok(namesMatch('"Manding for Break"', "Manding for Break", "strict"), "OP quotes stripped");
});

// ── acronym layer ───────────────────────────────────────────────────────────

test("a parenthesized acronym is extracted; a bare one is not", () => {
  assert.deepEqual(acronymsOf(SIB_A), ["sib"]);
  assert.deepEqual(acronymsOf("SIB"), [], "bare acronym is not a key");
  assert.deepEqual(acronymsOf("Something (A)"), [], "single letter is too weak");
  assert.deepEqual(acronymsOf("Functional Communication Training (FCT)"), ["fct"]);
});

test("a shared acronym needs a corroborating shared word to be decisive", () => {
  // Same program, different wording -> decisive.
  assert.equal(sharedAcronym(SIB_A, SIB_B), "sib");
  assert.equal(sharedAcronym("Functional Communication Training (FCT)",
                             "Functional Communication (FCT)"), "fct");
  // Reused initialism across unrelated programs -> NOT decisive, at any tier.
  assert.equal(sharedAcronym("Task Refusal (TR)", "Toileting Routine (TR)"), null);
  for (const tier of TIERS) {
    assert.equal(namesMatch("Task Refusal (TR)", "Toileting Routine (TR)", tier),
      tier === "loose" ? false : false,
      `a reused acronym must not merge unrelated programs at ${tier}`);
  }
});

test("a DIFFERING acronym is not a decisive non-match — the layer is positive only", () => {
  // These match today on substring / shared words; adding acronyms must not take that away.
  assert.ok(namesMatch("Elopement (ELO)", "Elopement", "strict"));
  assert.ok(namesMatch("Manding for Preferred Items (MPI)", "Manding for Preferred Items", "strict"));
  assert.ok(namesMatch("Turn Taking with Peers (TTP)", "Turn Taking with Adults (TTA)", "shared2"));
});

// ── variants layer (clinical_library.variants[]) ────────────────────────────

test("buildVariantIndex maps display name and every variant to one canonical key", () => {
  const idx = buildVariantIndex([
    { canonical_key: "self injurious behavior", display_name: "Self-Injurious Behavior",
      variants: ["SIB", "Self Injury", "Self-Harm"] },
    { canonical_key: "elopement", display_name: "Elopement", variants: ["Running Away"] },
  ]);
  assert.equal(idx["sib"], "self injurious behavior");
  assert.equal(idx["self harm"], "self injurious behavior");
  assert.equal(idx["running away"], "elopement");
  assert.equal(idx["tantrum"], undefined);
});

test("two names sharing a library canonical key match at every tier", () => {
  const variantIndex = buildVariantIndex([
    { canonical_key: "self injurious behavior", display_name: "Self-Injurious Behavior",
      variants: ["SIB", "Self Injury"] },
  ]);
  for (const tier of TIERS) {
    assert.ok(namesMatch("SIB", "Self Injury", tier, { variantIndex }),
      `library variants should decide at ${tier}`);
  }
  // Without the index, the bare pair does NOT match at strict — the layer is what adds it.
  assert.equal(namesMatch("SIB", "Self Injury", "strict"), false);
});

test("the variants layer is positive only — an absent index changes nothing", () => {
  assert.equal(namesMatch("Tantrum", "Elopement", "loose", { variantIndex: {} }), false);
  assert.equal(namesMatch("Tantrum", "Tantrum Behavior", "strict", { variantIndex: {} }), true);
});

// ── the empty-name fix ──────────────────────────────────────────────────────

test("an empty or blank name matches NOTHING", () => {
  // The old implementations all used bidirectional includes(), and "abc".includes("")
  // is true — so an empty name matched every program in the pool and resolved to the
  // first one. Every tier now rejects it.
  for (const tier of TIERS) {
    assert.equal(namesMatch("", "Tantrum", tier), false);
    assert.equal(namesMatch("Tantrum", "", tier), false);
    assert.equal(namesMatch("   ", "Tantrum", tier), false);
    assert.equal(namesMatch(null, "Tantrum", tier), false);
    assert.equal(namesMatch(undefined, undefined, tier), false);
  }
});

// ── helpers ─────────────────────────────────────────────────────────────────

test("normName is the one normalizer", () => {
  assert.equal(normName(SIB_A), "self injurious behavior sib");
  assert.equal(normName("  Physical   Aggression  "), "physical aggression");
  assert.equal(normName(null), "");
});

test("stripOuterQuotes removes the quoting OP wraps its h4 headings in", () => {
  assert.equal(stripOuterQuotes('"Manding for Break"'), "Manding for Break");
  assert.equal(stripOuterQuotes("“Waiting”"), "Waiting");
  assert.equal(stripOuterQuotes("Plain"), "Plain");
});

test("matchWords drops words of 2 characters or fewer", () => {
  assert.deepEqual(matchWords(normName("Manding for a Break")), ["manding", "for", "break"]);
  assert.deepEqual(matchWords(normName("Turn to X")), ["turn"]);
});

// ── consolidation helpers ───────────────────────────────────────────────────

test("canonicalName folds onto the stored name, or returns the incoming one", () => {
  const stored = ["Physical Aggression Toward Peers", "Elopement"];
  assert.equal(canonicalName("Elopement from Area", stored, "strict"), "Elopement");
  assert.equal(canonicalName("Tantrum", stored, "shared2"), "Tantrum");
  assert.equal(canonicalName("", stored, "shared2"), "");
  // strict does NOT fold Peers onto Adults; shared2 does. Same inputs, named tiers.
  assert.equal(canonicalName("Physical Aggression Toward Adults", stored, "strict"),
    "Physical Aggression Toward Adults");
  assert.equal(canonicalName("Physical Aggression Toward Adults", stored, "shared2"),
    "Physical Aggression Toward Peers");
});

test("resolveName keeps the longer name and reports whether it matched", () => {
  const pool = ["Self-Injurious Behavior (SIB)"];
  assert.deepEqual(resolveName(SIB_B, pool, "strict"),
    { resolvedName: SIB_A, matched: true });
  assert.deepEqual(resolveName("Tantrum", pool, "shared2"),
    { resolvedName: "Tantrum", matched: false });
});

test("tier order is strictly widening — anything strict matches, every tier matches", () => {
  const names = [SIB_A, SIB_B, "Tantrum", "Tantrum Behavior", "Elopement",
                 "Physical Aggression Toward Peers", "Defiant Behavior", "Disruptive Behavior"];
  for (const a of names) for (const b of names) {
    if (namesMatch(a, b, "strict")) {
      assert.ok(namesMatch(a, b, "shared2"), `${a}/${b}: strict matched but shared2 did not`);
      assert.ok(namesMatch(a, b, "loose"), `${a}/${b}: strict matched but loose did not`);
    }
    if (namesMatch(a, b, "shared2")) {
      assert.ok(namesMatch(a, b, "loose"), `${a}/${b}: shared2 matched but loose did not`);
    }
  }
});
