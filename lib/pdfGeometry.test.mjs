// Locks readTargetList — the "Behavior(s) to Reduce" capsule reader used to detect a named-but-undefined
// target behavior (see assembleRefreshProfile / the target-undefined flag). Run: `npm test`.
//
// Keys on the target-list HEADER vocabulary + the left-column list, bounded by the next major section — no
// client/behavior name. Rows are the geometry shape { page, y, cells: [{ text, x, y, page }] }.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTargetList, readReplacementRoster, readPreferenceTable, readReduceTargets, readObjectivesStatus } from './pdfGeometry.ts';

// helper: build a Row from [text, x] pairs on one line
const row = (page, y, ...cells) => ({ page, y, cells: cells.map(([text, x]) => ({ text, x, y, page })) });

test('reads the capsule names, first inline after the header, bounded by the next section', () => {
  const rows = [
    row(1, 9.1, ['Behavior to Reduce: Tantrums', 3]),
    row(1, 9.8, ['Hyperactivity', 3]),
    row(1, 10.5, ['Self-Injurious Behavior (SIB)', 3]),
    row(1, 11.3, ['Non-Compliance with Hygiene Routines', 3]),
    row(1, 12.0, ['Behaviors to increase: Skill Acquisition Goals', 3]), // boundary — list ends
    row(1, 12.8, ['Manding for help', 3]), // after boundary → excluded
  ];
  assert.deepEqual(readTargetList(rows), [
    'Tantrums', 'Hyperactivity', 'Self-Injurious Behavior (SIB)', 'Non-Compliance with Hygiene Routines',
  ]);
});

test('no target capsule present → [] (no flags will be produced)', () => {
  const rows = [
    row(1, 9, ['Client Overview', 3]),
    row(1, 10, ['Some narrative text about the client.', 3]),
  ];
  assert.deepEqual(readTargetList(rows), []);
});

test('alternate header vocabulary ("Target Behaviors") is recognized', () => {
  const rows = [
    row(1, 5, ['Target Behaviors', 3]),
    row(1, 6, ['Elopement', 3]),
    row(1, 7, ['Aggression', 3]),
    row(1, 8, ['Replacement Programs', 3]), // boundary
  ];
  assert.deepEqual(readTargetList(rows), ['Elopement', 'Aggression']);
});

test('bullet list and a large vertical gap both end the capsule', () => {
  const rows = [
    row(1, 5, ['Behaviors to Decrease', 3]),
    row(1, 6, ['Tantrums', 3]),
    row(1, 9.5, ['Food Refusal', 3]), // gap > 2 from prior → list already ended at the gap
  ];
  assert.deepEqual(readTargetList(rows), ['Tantrums']);
});

// ── readReplacementRoster (READER 5) — the "Behaviors to Increase" program roster ─────────────────────────
// Locks the real "TREATMENT PACKET" layout: a TWO-COLUMN table whose left-column label is split across word
// fragments ("Behaviors" | "to" | "Increase") and vertically centered among the RIGHT-column items, with the
// reduction block (the behavior names) directly above in the SAME column carrying its own inline "MASTERED:".
test('MARLON BRANDON LAYOUT: two-column centered label, reduction above, NEW:/MASTERED: sublists', () => {
  const behaviorNames = ['Physical Aggression', 'Property Destruction', 'Social Isolation', 'Tantrum'];
  const rows = [
    // reduction block (must NOT leak into the roster — bounded by the behavior names)
    row(5, 10.0, ['Physical Aggression', 9.5]),
    row(5, 10.8, ['Property Destruction', 9.5]),
    row(5, 11.6, ['Social Isolation', 9.5]),
    row(5, 12.4, ['MASTERED:', 9.5]),
    row(5, 13.2, ['Tantrum', 11.0]), // reduction-mastered behavior — the top boundary
    // increase block (the roster)
    row(5, 14.0, ['Share a toy while refraining from engaging in maladaptive', 9.5]),
    row(5, 14.8, ['End structured games appropriately', 9.5]),
    row(5, 15.6, ['Compliance with daily living activities', 9.5]),
    // header row: the centered label (split fragments) shares its row with the first item
    row(5, 16.4, ['Behaviors', 2.2], ['to', 5.2], ['Increase', 5.9], ['FCT in the form of requesting attention.', 9.6]),
    row(5, 17.2, ['Increasing time on task', 9.5]),
    row(5, 18.0, ['Accepting Alternatives and Making Choices', 9.5]),
    row(5, 18.8, ['NEW', 9.6], [':', 11.1]),                 // sublabel — still active
    row(5, 19.6, ['Appropriate Physical Interaction with Peers, Caregivers, and Adults', 9.6]),
    row(5, 20.4, ['Comply with Activity Schedule', 9.6]),
    row(5, 21.2, ['MASTERED:', 9.6]),                         // sublabel — switches to mastered
    row(5, 22.0, ['Request a Break Properly', 11.7]),
    row(5, 22.8, ['Following Instructions', 11.7]),
    row(5, 23.6, ['Interventions', 3.4], ['Redirection', 9.4]), // next section — ends the roster
  ];
  const r = readReplacementRoster(rows, behaviorNames);
  assert.equal(r.found, true);
  assert.deepEqual(r.active, [
    'Share a toy while refraining from engaging in maladaptive',
    'End structured games appropriately',
    'Compliance with daily living activities',
    'FCT in the form of requesting attention.',
    'Increasing time on task',
    'Accepting Alternatives and Making Choices',
    'Appropriate Physical Interaction with Peers, Caregivers, and Adults',
    'Comply with Activity Schedule',
  ]);
  assert.deepEqual(r.mastered, ['Request a Break Properly', 'Following Instructions']);
  assert.ok(!r.active.some((n) => /tantrum/i.test(n)), 'the reduction-mastered Tantrum never leaks in');
});

test('simple single-column layout (label on its own row, items below) also reads', () => {
  const rows = [
    row(1, 5.0, ['Behaviors to Increase', 3]),
    row(1, 5.8, ['Manding for attention', 3]),
    row(1, 6.6, ['Requesting a break', 3]),
    row(1, 7.4, ['Interventions', 3]), // boundary
  ];
  const r = readReplacementRoster(rows, []);
  assert.equal(r.found, true);
  assert.deepEqual(r.active, ['Manding for attention', 'Requesting a break']);
  assert.deepEqual(r.mastered, []);
});

test('MARLON XIMENA: a header over a PROSE block (wrapped procedure sentences + client name) is REJECTED', () => {
  // Ximena's failure mode: "Replacement Behaviors" heading whose body is intervention PROCEDURE prose, not a
  // program list. The plausibility gate must reject it (found:false) so the caller keeps the LLM/previous set,
  // rather than storing 37 sentence fragments (and leaking the client's name) as replacement programs.
  const rows = [
    row(3, 5.0, ['Replacement Behaviors', 3]),
    row(3, 5.8, ['Differential reinforcement of alternative behaviors (DRA): If', 3]),
    row(3, 6.6, ['Ximena appropriately requests for attention (by asking to play,', 3]),
    row(3, 7.4, ['initiating a conversation, saying the person’s name, etc.), instead', 3]),
    row(3, 8.2, ['of current maladaptive behaviors, praise her and honor her request.', 3]),
    row(3, 9.0, ['If unable to provide attention, let Ximena know when you will be', 3]),
  ];
  assert.equal(readReplacementRoster(rows, []).found, false);
});

test('a prose sentence containing "…to increase…" is NOT a roster header (fails safe → not found)', () => {
  const rows = [
    row(1, 5, ['These reinforcers are incorporated into treatment to increase motivation and engagement.', 1]),
    row(1, 6, ['Some other narrative.', 1]),
  ];
  assert.equal(readReplacementRoster(rows, []).found, false);
});

// ── readPreferenceTable (READER 6) — the People | Tangibles | Activities | Other reinforcer grid ───────────
test('MARLON PREFERENCE TABLE: columns separated by x-band; People column DROPPED at the source', () => {
  const rows = [
    row(12, 23.0, ['RESULTS FROM STIMULUS PREFERENCE ASSESSMENT', 9.5]),
    row(12, 25.3, ['People', 4.4], ['Tangibles', 11.8], ['Activities', 22.0], ['Other', 31.3]),
    // content rows: each column left-aligned in its band; People content at the far left must NOT appear
    row(12, 26.1, ['Time and interaction with mother', 1.8], ['Blocks, playdough,', 9.0], ['Ball toss, movement play,', 17.5], ['Verbal praise,', 29.1]),
    row(12, 26.9, ['adult attention', 1.7], ['and an iPad.', 9.0], ['and mirror games.', 17.5], ['and high fives.', 29.1]),
    row(12, 48.3, ['Brandon Cruz', 31.0]), // footer — big gap ends the table
  ];
  const t = readPreferenceTable(rows);
  assert.ok(t, 'table located');
  assert.match(t.tangibles, /Blocks, playdough, and an iPad\./);
  assert.match(t.activities, /Ball toss, movement play, and mirror games\./);
  assert.match(t.social, /Verbal praise, and high fives\./);
  assert.ok(!/mother|adult attention/i.test(t.tangibles + t.activities + t.social), 'the People column never leaks in');
});

test('collapsed columns (header x-bands too close) → null (fail safe, keep the prose set)', () => {
  const rows = [
    row(12, 25.3, ['People', 4.0], ['Tangibles', 5.0], ['Activities', 6.0], ['Other', 7.0]), // all clustered
    row(12, 26.1, ['everything runs together mother iPad ball toss praise', 4.0]),
  ];
  assert.equal(readPreferenceTable(rows), null);
});

test('no preference grid present → null', () => {
  const rows = [row(1, 5, ['Reinforcement', 3]), row(1, 6, ['He likes Legos and praise.', 3])];
  assert.equal(readPreferenceTable(rows), null);
});

// ── Objectives-table format (Ximena) — readReduceTargets + readObjectivesStatus ───────────────────────────
test('readReduceTargets parses the "Maladaptive behaviors to reduce are: …" capsule across a wrap', () => {
  const rows = [
    row(1, 5, ['Major concern. Maladaptive behaviors to reduce are: Elopement, SIB, Physical', 3]),
    row(1, 6, ['Aggression, Tantrum and Nudist behavior. Current treatment and progress 7/2026', 3]),
  ];
  assert.deepEqual(readReduceTargets(rows), ['Elopement', 'SIB', 'Physical Aggression', 'Tantrum', 'Nudist behavior']);
});

test('readObjectivesStatus: STO#1-3 Mastered + STO#4 In progress → ACTIVE (an objective mastered ≠ target mastered)', () => {
  const rows = [
    row(2, 39, ['Self Injury Behavior', 3.4]),
    row(2, 40, ['Objectives:', 3.4]),
    row(2, 41, ['Name', 3.5], ['Start Date', 25], ['End Date', 28], ['Status', 31]),
    row(2, 42, ['STO#1: Client will decrease Self Injury Behavior to 82/week', 3.5], ['Mastered', 31]),
    row(2, 43, ['STO#2: Client will decrease Self Injury Behavior to 72/week', 3.5], ['Mastered', 31]),
    row(2, 44, ['STO#3: Client will decrease Self Injury Behavior to 62/week', 3.5], ['Mastered', 31]),
    row(2, 45, ['STO#4: Client will decrease Self Injury Behavior to 52/week', 3.5], ['In', 31.8]),
    row(2, 46, ['progress', 31.1]),
  ];
  const r = readObjectivesStatus(rows);
  assert.equal(r.length, 1);
  assert.match(r[0].name, /Self Injury Behavior/);
  assert.equal(r[0].status, 'active', 'STO#4 in progress → the behavior is active');
  assert.equal(r[0].masteredStos, 3);
  assert.ok(r[0].pendingStos >= 1);
});

test('readObjectivesStatus: ALL STOs Mastered, none pending → mastered', () => {
  const rows = [
    row(2, 39, ['Personal Hygiene', 3.4]),
    row(2, 40, ['Objectives:', 3.4]),
    row(2, 41, ['Name', 3.5], ['Status', 31]),
    row(2, 42, ['STO#1: Client will increase Personal Hygiene to 80%', 3.5], ['Mastered', 31]),
    row(2, 43, ['STO#2: Client will increase Personal Hygiene to 100%', 3.5], ['Mastered', 31]),
    row(2, 44, ['Catharsis Consultants Inc', 3.4]),
  ];
  const r = readObjectivesStatus(rows);
  assert.equal(r[0].status, 'mastered');
  assert.equal(r[0].pendingStos, 0);
});
