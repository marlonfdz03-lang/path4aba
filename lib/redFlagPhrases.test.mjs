// Regression guard for RED_FLAG_PATTERNS (see redFlagPhrases.ts). Run with: `npm test`
// (Node's built-in runner; no deps).
//
// The rule being locked in (same as functionPatterns): a red-flag pattern must match the
// ASSERTION — the actual vague/mentalistic/generic/filler PHRASE — never a bare clinical
// noun ("concerns", "reinforced", "used", "progress") that also appears in compliant 97153
// prose. INNOCENT is ordinary observable session prose; none of it may match any pattern.
// POSITIVE is the 97153 standard's red-flag phrases; each must be caught. Any future change
// that flags innocent prose, or stops catching a known red flag, fails here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RED_FLAG_PATTERNS, findRedFlagPhrases } from './redFlagPhrases.ts';

const anyMatch = (text) => RED_FLAG_PATTERNS.some((p) => p.re.test(text));

// ── INNOCENT: compliant, observable 97153 prose. MUST stay unmatched. ──────────────
// Each mentions a noun that a naive bare-noun pattern would over-match.
const INNOCENT = [
  // "concerns" — legitimate clinical content, NOT the "no concerns were noted" filler.
  'Safety concerns were noted and the RBT implemented the approved protocol.',
  'Medical concerns regarding the client’s seizure history were documented at the start of the session.',
  // "reinforced" — with a named behavior and contingency.
  'The RBT reinforced appropriate requesting with behavior-specific praise contingent on the mand.',
  'Appropriate task engagement was reinforced immediately following each completed step.',
  'The client was reinforced for handing materials to the RBT.',
  // "used" — a specific named material/procedure, not "strategies".
  'The RBT used the picture exchange cards to prompt a functional request.',
  'A least-to-most prompting hierarchy was used during task initiation.',
  // "progress" / "improved" — allowed 97153 progress language tied to continued need.
  'Behavioral regulation improved with support across the transition.',
  'The client demonstrated emerging accuracy across several opportunities.',
  // "programs" — named, not the bare "ran programs".
  'The session addressed the Manding for Attention program using a structured table activity.',
  'Skill acquisition programming during this visit included the tolerating-delay program.',
  // "want/continue/session" appearing in observable, compliant sentences.
  'The client continued the task following verbal prompts.',
  'During today’s home-based ABA session, services were provided at the client’s home.',
  'The client walked to the assigned area and picked up the materials.',
  // Observable outcome language that must never read as vague.
  'The client responded independently across multiple opportunities.',
  'The behavior occurred on several occasions and decreased following redirection.',
  // A caregiver noun that must not trip the mentalistic state pattern.
  'The client transitioned to the next activity without further incident.',
];

// ── POSITIVE: the 97153 standard’s red-flag phrases. Each MUST be caught. ──────────
const POSITIVE = [
  // vague / subjective
  ['the session was good overall', 'vague'],
  ['it was a good session for the client', 'vague'],
  ['the client did better today', 'vague'],
  ['he did well during the activity', 'vague'],
  ['the client made great progress this week', 'vague'],
  ['the client was cooperative throughout', 'vague'],
  // mentalistic
  ['he was frustrated by the task', 'mentalistic'],
  ['the client was upset during the transition', 'mentalistic'],
  ['because he didn’t want to work on the worksheet', 'mentalistic'],
  ['the client didn’t want to transition', 'mentalistic'],
  ['the client wanted the tablet', 'mentalistic'],
  ['she enjoyed the coloring activity', 'mentalistic'],
  // generic intervention
  ['the RBT used strategies to redirect the client', 'generic-intervention'],
  ['the RBT used various strategies throughout', 'generic-intervention'],
  ['the RBT ran programs during the session', 'generic-intervention'],
  ['the RBT ran the programs as scheduled', 'generic-intervention'],
  ['the RBT reinforced him throughout the session', 'generic-intervention'],
  ['the client completed the task with prompting', 'generic-intervention'],
  // filler
  ['no concerns were noted during the session', 'filler'],
  ['no concerns noted', 'filler'],
  ['nothing notable occurred', 'filler'],
  ['next session will continue the same goals', 'filler'],
  ['we will continue the same programs', 'filler'],
];

test('INNOCENT compliant prose is never flagged as a red flag', () => {
  for (const phrase of INNOCENT) {
    const hits = findRedFlagPhrases(phrase);
    assert.equal(
      hits.length, 0,
      `Innocent prose was flagged: "${phrase}" -> ${JSON.stringify(hits)}`,
    );
    assert.equal(anyMatch(phrase), false, `A pattern matched innocent prose: "${phrase}"`);
  }
});

test('POSITIVE red-flag phrases are each caught, in the right category', () => {
  for (const [phrase, category] of POSITIVE) {
    const hits = findRedFlagPhrases(phrase);
    assert.ok(hits.length > 0, `Red-flag phrase was NOT caught: "${phrase}"`);
    assert.ok(
      hits.some((h) => h.category === category),
      `"${phrase}" caught but not as ${category}: got ${JSON.stringify(hits.map((h) => h.category))}`,
    );
  }
});

test('findRedFlagPhrases dedupes repeated phrases and returns the exact text', () => {
  const note = 'The session was good. Later, the session was good again.';
  const hits = findRedFlagPhrases(note);
  assert.equal(hits.length, 1, `Expected one deduped hit, got ${JSON.stringify(hits)}`);
  assert.match(hits[0].phrase, /session was good/i);
});
