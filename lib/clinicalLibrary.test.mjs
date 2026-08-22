// Clinical Library helpers — the make-or-break dedup + PHI discard. Run: `npm test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalKey, phiDiscardReason, collectLibraryEntries, filterLibraryEntries, unionCI, collectLibraryEntriesFromProfile, looksLikePersonReinforcer } from './clinicalLibrary.ts';

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
