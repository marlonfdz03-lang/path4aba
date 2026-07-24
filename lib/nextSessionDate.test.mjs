// Regression battery for the next-session date rule (see nextSessionDate.ts). Run with `npm test`.
// The invariant: a next-session date must be STRICTLY AFTER the note's session date, else omitted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidNextSessionDate, nextSessionClause, stripInvalidNextSession, stripInvalidNextSessionSentence } from './nextSessionDate.ts';

test('a next-session date strictly after the session date is valid', () => {
  assert.equal(isValidNextSessionDate('2026-07-30', '2026-07-23'), true);
  assert.equal(isValidNextSessionDate('2026-08-01', '2026-07-31'), true);
});

test('a next-session date on OR before the session date fails validation', () => {
  assert.equal(isValidNextSessionDate('2026-07-16', '2026-07-23'), false); // a week earlier (real audit case)
  assert.equal(isValidNextSessionDate('2026-06-25', '2026-06-29'), false); // earlier (real audit case)
  assert.equal(isValidNextSessionDate('2026-07-23', '2026-07-23'), false); // same day
});

test('missing / blank / unparseable dates are never valid (no default)', () => {
  assert.equal(isValidNextSessionDate('', '2026-07-23'), false);
  assert.equal(isValidNextSessionDate('2026-07-30', ''), false);
  assert.equal(isValidNextSessionDate(null, '2026-07-23'), false);
  assert.equal(isValidNextSessionDate('not-a-date', '2026-07-23'), false);
});

test('nextSessionClause emits the sentence only when strictly future', () => {
  assert.equal(nextSessionClause('2026-07-30', '2026-07-23'), 'Next scheduled appointment: 2026-07-30.');
  assert.equal(nextSessionClause('2026-07-16', '2026-07-23'), '');
  assert.equal(nextSessionClause('', '2026-07-23'), '');
});

test('stripInvalidNextSession removes a past/equal clause but keeps a valid one', () => {
  assert.equal(
    stripInvalidNextSession('Medication consumed today. Next scheduled appointment: 2026-07-16.', '2026-07-23'),
    'Medication consumed today.',
  );
  assert.equal(
    stripInvalidNextSession('Next scheduled appointment: 2026-07-23.', '2026-07-23'),
    '',
  );
  const valid = 'Medication consumed today. Next scheduled appointment: 2026-07-30.';
  assert.equal(stripInvalidNextSession(valid, '2026-07-23'), valid);
});

test('stripInvalidNextSessionSentence removes a wrong closing sentence that survives a rewrite', () => {
  const note = 'The client participated well throughout the session. The next scheduled session is on 2026-07-16.';
  assert.equal(
    stripInvalidNextSessionSentence(note, '2026-07-23'),
    'The client participated well throughout the session.',
  );
});

test('stripInvalidNextSessionSentence keeps a valid sentence, and leaves what it cannot prove wrong', () => {
  const good = 'Great session. The next scheduled session is on 2026-07-30.';
  assert.equal(stripInvalidNextSessionSentence(good, '2026-07-23'), good); // strictly future -> keep
  // Unknown session date -> leave untouched (never risk deleting a valid sentence).
  assert.equal(stripInvalidNextSessionSentence(good, ''), good);
  // Unparseable date -> leave untouched.
  const fuzzy = 'Good session. The next scheduled session is on a date to be confirmed.';
  assert.equal(stripInvalidNextSessionSentence(fuzzy, '2026-07-23'), fuzzy);
});
