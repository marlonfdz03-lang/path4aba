// Regression guard: the note prompt must NOT read the shared, unscoped knowledge-base tables. Those reads fed
// OTHER clients' operational definitions into a client's prompt (a cross-client firewall breach) and were
// referenced by no instruction. generateSmartNote.ts pulls @/prisma + @/openai, so it is not importable under
// bare node — this asserts on its SOURCE (the established pattern in curatedActivities.test.mjs). Run: `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../lib/generateSmartNote.ts', import.meta.url), 'utf8');

test('the unscoped KB queries are gone from the prompt path', () => {
  assert.ok(!/prisma\.topographies\.findMany/.test(src), 'must not query the shared topographies KB');
  assert.ok(!/prisma\.replacement_skills\.findMany/.test(src), 'must not query the shared replacement_skills KB');
});

test('the KB-derived prompt fields are gone', () => {
  // Anchor on object-KEY syntax ("field:") so these match CODE, not the explanatory comments that name them.
  assert.ok(!/knowledgeBase\s*:/.test(src), 'no knowledgeBase block in sessionContext');
  assert.ok(!/topographyVariants\s*:/.test(src), 'no topographyVariants field (per-behavior or knowledgeBase)');
  assert.ok(!/vocabularyVariants\s*:/.test(src), 'no per-skill vocabularyVariants field');
  assert.ok(!/replacementSkillVariants\s*:/.test(src), 'no knowledgeBase replacementSkillVariants field');
});

test("the client's OWN behaviors (with their own topographies) still reach the prompt", () => {
  assert.ok(/behaviorsObserved:\s*input\.behaviorsObserved\b/.test(src), 'behaviorsObserved passes the client\'s own behaviors through');
  assert.ok(/replacementSkillsAddressed:\s*input\.replacementSkillsAddressed\b/.test(src), 'replacementSkillsAddressed passes the client\'s own skills through');
});
