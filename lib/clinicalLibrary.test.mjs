// Clinical Library helpers — the make-or-break dedup + PHI discard. Run: `npm test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalKey, phiDiscardReason, collectLibraryEntries, filterLibraryEntries, unionCI, collectLibraryEntriesFromProfile, looksLikePersonReinforcer, looksLikePersonRole, PERSON_WARNING } from './clinicalLibrary.ts';

// ── canonicalKey: collapse variants to ONE key ──────────────────────────────────────────────────────────
test('MARLON REQUIRED: Tantrum variants all collapse to one key', () => {
  const forms = ['Tantrum', 'tantrums', 'Tantrum Behavior', 'Behavior Tantrum', 'TANTRUMS', '  Tantrum!  '];
  const keys = new Set(forms.map(canonicalKey));
  assert.equal(keys.size, 1, `all Tantrum forms → one key, got ${[...keys].join(' | ')}`);
  assert.equal(canonicalKey('Tantrum'), 'tantrum');
});

test('distinct concepts stay distinct', () => {
  const k = (s) => canonicalKey(s);
  assert.notEqual(k('Property Destruction'), k('Self-Injurious Behavior'));
  assert.notEqual(k('Elopement'), k('Aggression'));
  assert.notEqual(k('Manding'), k('Tacting'));
  // Self-Injurious Behavior: "behavior" dropped, hyphen split; stays its own key.
  assert.equal(k('Self-Injurious Behavior'), k('self injurious'));
  assert.equal(k('Self Injurious Behaviors'), k('injurious self'), 'order-independent + plural + generic-suffix');
});

test('canonicalKey handles skills / procedures / reinforcers / activities the same way', () => {
  const k = canonicalKey;
  assert.equal(k('Break Requests'), k('break request'));
  assert.equal(k('Requesting a Break'), k('a requesting break'));       // order-independent
  assert.equal(k('Differential Reinforcement'), k('differential reinforcement'));
  assert.equal(k('Fidget Toys'), k('fidget toy'));
  // "activity" is NOT a generic-suffix word, so it stays part of the key; matching is order-independent.
  assert.equal(k('Structured Table Activity'), k('Table Activity Structured'));
  assert.equal(k('Structured Table Activity'), 'activity structured table');
});

// ── PHI discard filter (Marlon's modified rules) ────────────────────────────────────────────────────────
test('MARLON REQUIRED: KEEP legitimate clinical strings (numbers-as-duration are NOT PHI)', () => {
  for (const s of [
    'gazing away for over 5 seconds',
    'hitting with an open hand',
    'tantrums lasting more than 2 minutes',
    'requesting a break using words',
    'Premack Principle',
    'DRA',
    'Behavior Momentum',
    'completed 4 of 5 trials',            // count — clinical, not PHI
    'screaming for up to 30 seconds',
    'differential reinforcement of alternative behavior',
  ]) {
    assert.equal(phiDiscardReason(s), null, `should KEEP: ${s}`);
  }
});

test('MARLON REQUIRED: DISCARD genuine identifiers', () => {
  const cases = [
    ['at grandmother\'s house', 'location'],
    ['Lincoln Elementary', 'location'],
    ['transitions on Maple Street', 'location'],
    ['5-year-old client', 'age'],
    ['age 7', 'age'],
    ['7 y/o male', 'age'],
    ['on March 3', 'date'],
    ['assessed 3/15/24', 'date'],
    ['reassessment in 2024', 'date'],
    ['contact parent@example.com', 'hipaa-id'],
    ['call 555-123-4567', 'hipaa-id'],
    ['SSN 123-45-6789', 'hipaa-id'],
    ['MRN: A1234567', 'hipaa-id'],
    ['the client hit Marlon', 'proper-name'],
    ['redirected by Ms Garcia', 'proper-name'],
  ];
  for (const [s, reason] of cases) {
    const got = phiDiscardReason(s);
    assert.ok(got !== null, `should DISCARD: ${s} (got null)`);
    assert.equal(got, reason, `${s} → expected ${reason}, got ${got}`);
  }
});

test('age vs duration disambiguation is exact', () => {
  assert.equal(phiDiscardReason('5 seconds'), null);
  assert.equal(phiDiscardReason('5 minutes'), null);
  assert.equal(phiDiscardReason('5 years old'), 'age');
  assert.equal(phiDiscardReason('5-year-old'), 'age');
  assert.equal(phiDiscardReason('for 3 times'), null);
});

test('a bare month WORD (no adjacent number) is not a date', () => {
  assert.equal(phiDiscardReason('may engage in tantrums'), null);   // "may" = modal
  assert.equal(phiDiscardReason('on March 3'), 'date');             // month + day
});

test('Title-Case clinical runs are not flagged as proper names', () => {
  for (const s of ['Premack Principle', 'Behavior Momentum', 'Functional Communication Training', 'Noncontingent Reinforcement']) {
    assert.equal(phiDiscardReason(s), null, `clinical name should KEEP: ${s}`);
  }
  // but an embedded person name (capitalized, preceded by a lowercase word) is caught
  assert.equal(phiDiscardReason('practiced manding with Sarah'), 'proper-name');
});

// REGRESSION BATTERY (real bug from the backfill): Title-Case clinical LABELS with lowercase connectors
// (of/for/with/to/on) must NOT be misread as proper names. Without prose-gating these were all discarded,
// taking DRA/DRI/DRO and dozens of legitimate skills with them. Per AGENTS.md: match the assertion, not the
// bare capitalized noun.
test('MARLON REQUIRED: mixed-case clinical labels are KEPT (not flagged as proper names)', () => {
  for (const s of [
    'Differential Reinforcement of Alternative Behavior (DRA)',
    'Differential Reinforcement of Incompatible Behaviors (DRI)',
    'Differential Reinforcement of Other Behavior (DRO)',
    'Manding for Tangibles Response',
    'Time on Task',
    'Increasing Time on Task',
    'Arguing with Adults',
    'Lining up Objects',
    'FCT - Request for Help',
    "Use Appropriate Ways to Say 'No' to a Task, Activity, or Demand",
    'Wait Appropriately for Reinforcer/Preferred Activity',
    'Appropriate Physical Interaction with Peers, Caregivers, and Adults',
    'Systematic Prompting with Fading',
    'Accept a Break',
  ]) {
    assert.equal(phiDiscardReason(s), null, `clinical LABEL should KEEP: ${s}`);
  }
});

test('the "id" identifier keyword does not match the verb "identify"', () => {
  // real bug from the backfill: "id" matched the "Id" prefix of "Identify"/"identify"
  assert.equal(phiDiscardReason('Identify Major Norms and Rules in the Community'), null);
  assert.equal(phiDiscardReason('identify what is dangerous and what is not'), null);
  assert.equal(phiDiscardReason('Identify emotions in self and others'), null);
  // but a real record/patient id (with a digit) is still discarded
  assert.equal(phiDiscardReason('patient id 48213'), 'hipaa-id');
  assert.equal(phiDiscardReason('MRN: A1234567'), 'hipaa-id');
});

test('embedded client names in PROSE topography definitions are still caught', () => {
  for (const s of [
    'Defined as any instance of Alexandra moving out of a safe area',
    'Any instance Gabriel cries and screams with or without tears',
    'Defined as any instance in which Felix interrupts his engagement in a task',
    'redirected by Ms Garcia during the session',   // titled name, any context
  ]) {
    assert.equal(phiDiscardReason(s), 'proper-name', `prose with a person name should DISCARD: ${s}`);
  }
});

test('extended reinforcer guard also drops leaked role-word plurals', () => {
  for (const s of ['Caregivers', 'Parents', 'Adult', 'Teachers', 'Therapists', 'mothers'])
    assert.equal(looksLikePersonReinforcer(s), true, `role-word should DROP: ${s}`);
  // but multi-word social-attention reinforcers are NOT bare role words → kept
  assert.equal(looksLikePersonReinforcer('adult attention through conversation'), false);
});

test('empty / whitespace → keep (null)', () => {
  assert.equal(phiDiscardReason(''), null);
  assert.equal(phiDiscardReason('   '), null);
});

// ── extraction: collect → filter (Step 3 pure part) ─────────────────────────────────────────────────────
test('collectLibraryEntries pulls all six kinds and excludes reinforcer people (PHI)', () => {
  const extracted = {
    maladaptiveBehaviors: [{ name: 'Tantrum', topography: 'crying and dropping to the floor', function: 'escape' }],
    replacementSkills: [{ name: 'Requesting a Break', targetFunction: 'escape' }],
    approvedInterventions: ['Differential Reinforcement', 'Functional Communication Training'],
    reinforcers: { tangibles: ['fidget toy'], social: ['high five'], activities: ['bubbles'], people: ['Mom', 'Ms Garcia'] },
    homeActivities: ['coloring at the table'],
    schoolActivities: ['circle time'],
    preferredActivities: ['trampoline'],
  };
  const e = collectLibraryEntries(extracted);
  const byKind = (k) => e.filter((x) => x.kind === k).map((x) => x.name);
  assert.deepEqual(byKind('behavior'), ['Tantrum']);
  assert.equal(e.find((x) => x.kind === 'behavior').variants[0], 'crying and dropping to the floor');
  assert.deepEqual(e.find((x) => x.kind === 'behavior').functions, ['escape']);
  assert.deepEqual(byKind('skill'), ['Requesting a Break']);
  assert.deepEqual(byKind('procedure'), ['Differential Reinforcement', 'Functional Communication Training']);
  assert.deepEqual(byKind('reinforcer').sort(), ['fidget toy', 'high five']);
  assert.ok(byKind('activity').includes('bubbles') && byKind('activity').includes('trampoline'));
  // people are caregiver names — never collected as reinforcers.
  assert.ok(!e.some((x) => x.name === 'Mom' || x.name === 'Ms Garcia'));
});

test('filterLibraryEntries: dirty NAME drops the entry; dirty VARIANT is dropped but entry survives', () => {
  const entries = [
    { kind: 'behavior', name: 'Tantrum', variants: ['crying for 5 seconds', 'happens at grandmother\'s house'], functions: ['escape'] },
    { kind: 'behavior', name: '5-year-old meltdown', variants: [], functions: [] }, // age in name → whole entry gone
    { kind: 'activity', name: 'bubbles', variants: [], functions: [] },
  ];
  const { kept, discards } = filterLibraryEntries(entries);
  const names = kept.map((k) => k.name);
  assert.deepEqual(names.sort(), ['Tantrum', 'bubbles']);
  const tantrum = kept.find((k) => k.name === 'Tantrum');
  assert.deepEqual(tantrum.variants, ['crying for 5 seconds']); // duration variant kept, location variant dropped
  // one location variant + one age name = two discards, reasons logged (no text)
  assert.equal(discards.length, 2);
  assert.ok(discards.some((d) => d.reason === 'location' && d.kind === 'behavior'));
  assert.ok(discards.some((d) => d.reason === 'age' && d.kind === 'behavior'));
  assert.ok(discards.every((d) => !('text' in d)));
});

test('unionCI dedups case-insensitively, preserves first casing', () => {
  assert.deepEqual(unionCI(['Crying', 'crying', 'CRYING', 'dropping']), ['Crying', 'dropping']);
  assert.deepEqual(unionCI(['  a ', 'a', '']), ['a']);
});

// ── historical backfill adapter ─────────────────────────────────────────────────────────────────────────
test('collectLibraryEntriesFromProfile reads the STORED profile shape and EXCLUDES activities', () => {
  const profile = {
    // clinical keys (read)
    maladaptiveBehaviors: [{ name: 'Tantrum', topographies: ['crying', 'dropping to the floor'], functions: ['escape', 'attention'] }],
    masteredBehaviors: ['Elopement'],
    replacementBehaviors: [{ name: 'Requesting a Break', targetFunction: 'escape' }],
    skillAcquisition: [{ name: 'Manding for items', targetFunction: 'tangible' }],
    interventions: [{ name: 'Differential Reinforcement', status: 'active' }, { name: 'FCT', status: 'active' }],
    reinforcers: ['fidget toy', 'high five', 'iPad'],
    // activities present in the stored profile — MUST be ignored (Path-curated baseline, provenance)
    homeActivities: ['coloring activity', 'puzzle activity'],
    schoolActivities: ['circle time'],
    // PHI keys — must never be read
    clientName: 'Felix R.', name: 'Felix R.', gender: 'male', caregivers: ['Mom'], whoWasPresent: ['Ms Garcia'],
  };
  const e = collectLibraryEntriesFromProfile(profile);
  const byKind = (k) => e.filter((x) => x.kind === k).map((x) => x.name);
  assert.deepEqual(byKind('behavior').sort(), ['Elopement', 'Tantrum']);
  const tantrum = e.find((x) => x.name === 'Tantrum');
  assert.deepEqual(tantrum.variants, ['crying', 'dropping to the floor']); // topographies -> variants
  assert.deepEqual(tantrum.functions, ['escape', 'attention']);            // functions carried
  assert.deepEqual(byKind('skill').sort(), ['Manding for items', 'Requesting a Break']); // both stored keys
  assert.deepEqual(byKind('procedure'), ['Differential Reinforcement', 'FCT']);
  assert.deepEqual(byKind('reinforcer'), ['fidget toy', 'high five', 'iPad']);
  // NO activities, and NO PHI leaked in as any kind
  assert.equal(byKind('activity').length, 0);
  assert.ok(!e.some((x) => /Felix|Garcia|male|Mom/.test(x.name)));
});

test('looksLikePersonReinforcer: extra guard drops person names, keeps real reinforcers', () => {
  for (const s of ['Mom', 'dad', 'Grandma', 'teacher', 'Ms Garcia', 'Dr Smith', 'John Smith', 'Aunt Mary'])
    assert.equal(looksLikePersonReinforcer(s), true, `should DROP as person: ${s}`);
  for (const s of ['fidget toy', 'iPad', 'bubbles', 'high five', 'kinetic sand', 'Legos', 'Pokemon cards', 'goldfish crackers'])
    assert.equal(looksLikePersonReinforcer(s), false, `should KEEP as reinforcer: ${s}`);
});

// ── looksLikePersonRole: the SELECTION-SAFE predicate (rules 1-2 only; Title-Case rule 3 deliberately OUT). ──
// Used at the note-selection choke point and the client-create path, where a wrong call is silent.
test('looksLikePersonRole: all 5 roster person-name reinforcers are caught', () => {
  for (const s of ['mother', 'father', 'Parents', 'Adult', 'Teacher'])
    assert.equal(looksLikePersonRole(s), true, `should catch person: ${s}`);
});

test('looksLikePersonRole: the boundary — "Social interaction with parents" is NOT caught', () => {
  assert.equal(looksLikePersonRole('Social interaction with parents'), false);
});

test('looksLikePersonRole: Title-Case brand/show reinforcers are NOT caught (rule 3 stays off this path)', () => {
  for (const s of ['Hot Wheels', 'Paw Patrol', 'Dragon Ball Z', 'Verbal Praise'])
    assert.equal(looksLikePersonRole(s), false, `must NOT drop legit reinforcer: ${s}`);
  // ...and the FULL guard DOES flag them via rule 3 — exactly why rule 3 is confined to the reviewed path.
  for (const s of ['Hot Wheels', 'Dragon Ball Z', 'Verbal Praise'])
    assert.equal(looksLikePersonReinforcer(s), true, `full guard (rule 3) still flags: ${s}`);
});

test('looksLikePersonRole: titled names caught; empty/whitespace not', () => {
  assert.equal(looksLikePersonRole('Ms Garcia'), true);
  assert.equal(looksLikePersonRole('Dr Smith'), true);
  for (const v of ['', '   ', null, undefined]) assert.equal(looksLikePersonRole(v), false);
  assert.ok(typeof PERSON_WARNING === 'string' && PERSON_WARNING.length > 0);
});
