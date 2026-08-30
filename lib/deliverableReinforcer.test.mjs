// Tests for the community-outing firewall. Run with: npm test (node --test).
// Asserted against EVERY reinforcer on the live roster (11 clients): all 13 CLEAR outings caught, and every
// legitimate item + every BORDERLINE item left untouched. The borderline items are explicit negatives so a
// future edit that adds "playground"/"outside"/"recess"/"trampoline"/"water" to a keyword list breaks a test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCommunityOuting } from './deliverableReinforcer.ts';

// The 13 CLEAR community-outing / off-site items across the roster — MUST all be caught.
const CLEAR = [
  'park', 'recreational outings including walks', 'beach visits',   // 205d29d1
  'brief community outings', 'mall walks',                          // 45ad02f0
  'Go to park', 'Go to pool',                                       // c72edc7f
  'beach', 'pool', 'visiting family', 'attending birthday parties', // cb3d0695
  'Visiting the park',                                              // d6c8c5ae
  'Going to the park',                                              // edcb2c84
];

// BORDERLINE — location-dependent, deliberately HELD. MUST NOT be caught. Note "going to the playground"
// contains the travel verb "going to" yet must stay held (the borderline veto).
const BORDERLINE = [
  'playground time', 'Playing on the playground', 'going to the playground', // playground
  'Play outside', 'Playing outside',                                          // outside
  'Recess at school',                                                         // recess
  'Jumping on trampoline',                                                    // trampoline
  'water play', 'playing with water',                                         // water
];

// Legitimate in-session reinforcers from across the roster — MUST NOT be caught. Includes the collision
// traps: "Small…" (vs mall), "watching movies" (vs the movies/theater), "carpool"-shaped words.
const LEGIT = [
  'Legos', 'ball games', 'interactive table-top activities', 'structured play opportunities',
  'behavior-specific praise', 'social attention', 'high-fives', 'smiles', 'Small toys', 'a tablet', 'phone',
  'collectible items like Pokémon', 'novel items to maintain motivation', 'playing simple games on a tablet',
  'toys appropriate for age', 'pretend play materials', 'playing with slime', 'supervised dress-up play',
  'watching short age-appropriate cartoons', 'Tablet', 'Toys', 'Coloring', 'Music', 'Verbal praise',
  'High fives', 'Dancing', 'Painting', 'Praise', 'toys (cars)', 'animals', 'puzzles', 'colors',
  'Watching music videos', "Verbal Praise ('good boy!')", 'Physical contact and closeness', 'Hand clapping',
  'music', 'gaming time', 'phone time', 'preferred items', 'high interest items', 'taking turn',
  'scheduled exercise', 'sensory enriching activity schedule', 'complete toilet training', 'social praise',
  'greeting to other person in appropriate manner', 'iPad', 'Play with dolls', 'Draw', 'Attention',
  'Verbal praise: Great job', 'sensory toys with movement and sound', 'watching movies', 'YouTube Kids videos',
  'jumping', 'looking in the mirror', 'spending time alone in her room', 'closing doors',
  'Small animal figurines', 'Completed puzzles', 'Playing with Play-Doh', 'Blowing bubbles',
  'Toy cars', 'Dinosaurs', 'Monkey toys', 'Blocks', 'Puzzles', 'Balls', 'Superheroes', 'Gestural praise',
  'Kisses', 'Hugs', 'Claps', 'High five', 'Dragon Ball Z figurines', 'Drawing and coloring', 'playing UNO',
];

test('CLEAR: all 13 community-outing items are caught', () => {
  for (const item of CLEAR) {
    assert.equal(isCommunityOuting(item), true, `expected CAUGHT: ${JSON.stringify(item)}`);
  }
});

test('BORDERLINE: playground / outside / recess / trampoline / water are NOT caught (held for the RBT)', () => {
  for (const item of BORDERLINE) {
    assert.equal(isCommunityOuting(item), false, `expected HELD (not caught): ${JSON.stringify(item)}`);
  }
});

test('LEGIT: no legitimate in-session reinforcer is caught (zero false positives on the roster)', () => {
  for (const item of LEGIT) {
    assert.equal(isCommunityOuting(item), false, `false positive on legit item: ${JSON.stringify(item)}`);
  }
});

test('collision traps: "Small" is not "mall", "watching movies" is not "the movies"', () => {
  assert.equal(isCommunityOuting('Small toys'), false);
  assert.equal(isCommunityOuting('Small animal figurines'), false);
  assert.equal(isCommunityOuting('watching movies'), false);
  // but the real outing forms ARE caught
  assert.equal(isCommunityOuting('go to the movies'), true);
  assert.equal(isCommunityOuting('trip to the mall'), true);
});

test('empty / nullish input is not an outing', () => {
  for (const v of ['', '   ', null, undefined]) assert.equal(isCommunityOuting(v), false);
});
