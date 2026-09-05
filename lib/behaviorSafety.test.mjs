// Behavior-safety classification + withhold-response exclusion — the clinical-safety gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isWithholdResponseIntervention, classifyBehaviorSafety, allowsWithholdResponse, filterUnsafeInterventions,
} from './behaviorSafety.ts';

test('withhold-response intervention recognition (Planned Ignoring + every Extinction variant)', () => {
  for (const n of ['Planned Ignoring', 'Planned Ignore', 'planned ignoring', 'Extinction',
                   'Escape Extinction', 'Attention Extinction', 'Tangible Extinction', 'Extinction procedures'])
    assert.equal(isWithholdResponseIntervention(n), true, `should flag: ${n}`);
  // NOT withhold-response — these reinforce an alternative / redirect, they don't withhold a reaction.
  for (const n of ['DRA', 'Differential Reinforcement of Alternative Behaviors (DRA)', 'DRI', 'DRO', 'NCR',
                   'FCT', 'Redirection', 'Behavioral Momentum', 'Premack Principle', 'Errorless Teaching',
                   'Guided Compliance', 'Environmental Manipulations'])
    assert.equal(isWithholdResponseIntervention(n), false, `should NOT flag: ${n}`);
});

test('FLIGHT / SELF-HARM / AGGRESSION classify unsafe — including the roster false-negatives', () => {
  const flight = ['Elopement', 'Bolting', 'Climbing'];
  const selfHarm = ['Self-Injurious Behavior (SIB)', 'SIB', 'Self-Injurious Behaviors', 'Skin picking',
                    'Mouthing Unsafe Objects'];
  const aggression = ['Physical Aggression', 'Physical Aggression: Pushing', 'Verbal Aggression',
                      'Throwing Objects', 'Inappropriate touching'];
  for (const n of flight) assert.equal(classifyBehaviorSafety(n), 'flight', n);
  for (const n of selfHarm) assert.equal(classifyBehaviorSafety(n), 'self-harm', n);
  for (const n of aggression) assert.equal(classifyBehaviorSafety(n), 'aggression', n);
  // none of them permit withhold-response
  for (const n of [...flight, ...selfHarm, ...aggression])
    assert.equal(allowsWithholdResponse(n), false, `must exclude withhold-response: ${n}`);
});

test('SAFE-list: attention-maintained non-harmful behaviors permit withhold-response', () => {
  for (const n of ['Tantrum', 'Tantrums', 'Arguing with Adults', 'Interrupting Others',
                   'Whining', 'Calling out', 'Attention-seeking behavior'])
    assert.equal(allowsWithholdResponse(n), true, `should allow: ${n}`);
});

test('FAIL-SAFE: an unclassified behavior does NOT permit withhold-response', () => {
  for (const n of ['Disruptive Behavior', 'Impulsive Behavior', 'Defiant Behavior', 'Perseverative Behavior'])
    assert.equal(classifyBehaviorSafety(n), 'unclassified', n);
  for (const n of ['Disruptive Behavior', 'Impulsive Behavior', 'Defiant Behavior'])
    assert.equal(allowsWithholdResponse(n), false, `unknown must be unsafe: ${n}`);
});

test('harm OVERRIDES the safe-list (an aggressive tantrum is not safe)', () => {
  assert.equal(classifyBehaviorSafety('Tantrum with aggression toward peers'), 'aggression');
  assert.equal(allowsWithholdResponse('Tantrum with aggression toward peers'), false);
  // topography reveals harm a generic name hides
  assert.equal(allowsWithholdResponse('Disruptive Behavior', 'runs toward the classroom exit and the doorknob'), false);
});

test('filterUnsafeInterventions: strips withhold-response for unsafe behaviors, keeps them for safe ones', () => {
  const approved = ['DRA', 'DRO', 'FCT', 'Planned Ignoring', 'Escape Extinction', 'Redirection'];
  // Elopement (flight) — withhold-response removed, safe options kept
  assert.deepEqual(filterUnsafeInterventions(approved, 'Elopement'),
    ['DRA', 'DRO', 'FCT', 'Redirection']);
  // Tantrum (safe) — full list preserved
  assert.deepEqual(filterUnsafeInterventions(approved, 'Tantrum'), approved);
  // unclassified — fail-safe strips withhold-response
  assert.deepEqual(filterUnsafeInterventions(approved, 'Disruptive Behavior'),
    ['DRA', 'DRO', 'FCT', 'Redirection']);
});

test('the reported live bug: Elopement never keeps Planned Ignoring as a candidate', () => {
  const approved = ['Differential Reinforcement of Alternative Behaviors (DRA)', 'Planned Ignoring',
                    'Escape Extinction', 'Functional Communication Training (FCT)'];
  const topo = 'runs away from caregivers, opening doors or placing his hand on the doorknob';
  const safe = filterUnsafeInterventions(approved, 'Elopement', topo);
  assert.ok(!safe.some(isWithholdResponseIntervention), 'no withhold-response survives for Elopement');
  assert.deepEqual(safe, ['Differential Reinforcement of Alternative Behaviors (DRA)',
                          'Functional Communication Training (FCT)']);
});
