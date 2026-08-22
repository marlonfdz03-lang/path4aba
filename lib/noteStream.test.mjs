// Shared note-stream parsing. Run: `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitNoteStream } from './noteStream.ts';

test('pass-1 streaming: live note text, no meta, no regen', () => {
  const r = splitNoteStream('The client ');
  assert.equal(r.note, 'The client ');
  assert.equal(r.metaRaw, null);
  assert.equal(r.sawRegen, false);
});

test('meta present: note is everything before __META__; metaRaw is the JSON tail', () => {
  const r = splitNoteStream('Final note text.__META__{"similarityWarning":false}');
  assert.equal(r.note, 'Final note text.');
  assert.equal(r.metaRaw, '{"similarityWarning":false}');
  assert.equal(JSON.parse(r.metaRaw).similarityWarning, false);
});

test('MARLON/AUDIT-B: __META__ JSON that spans reads accumulates until it parses (the null-context fix)', () => {
  // simulate the tail arriving in pieces
  const pieces = ['Note body.__META__{"generationContext":{"beh', 'aviorTiers":{"Tantrum":"FAVORABLE"}},"filte', 'redText":"Note body."}'];
  let raw = '';
  let parsed = null;
  for (const p of pieces) {
    raw += p;
    const { metaRaw } = splitNoteStream(raw);
    if (metaRaw) { try { parsed = JSON.parse(metaRaw); } catch { /* keep reading */ } }
  }
  assert.ok(parsed, 'the accumulated meta eventually parses');
  assert.equal(parsed.generationContext.behaviorTiers.Tantrum, 'FAVORABLE');
  assert.equal(parsed.filteredText, 'Note body.');
});

test('regen (untagged): note is the pass-2 text after the marker; sawRegen true; pass-1 is dropped from note', () => {
  const r = splitNoteStream('PASS ONE TEXT__REGEN__PASS TWO TEXT');
  assert.equal(r.sawRegen, true);
  assert.equal(r.note, 'PASS TWO TEXT');
  assert.equal(r.metaRaw, null);
});

test('regen (tagged with :source): the ":source" line is dropped, pass-2 begins after the newline', () => {
  const r = splitNoteStream('PASS ONE__REGEN__:coverage\nPASS TWO');
  assert.equal(r.sawRegen, true);
  assert.equal(r.note, 'PASS TWO');
});

test('regen then meta: final note is the pass-2 text before __META__', () => {
  const r = splitNoteStream('PASS ONE__REGEN__:coverage\nFinal pass two.__META__{"filteredText":"Final pass two."}');
  assert.equal(r.sawRegen, true);
  assert.equal(r.note, 'Final pass two.');
  assert.equal(JSON.parse(r.metaRaw).filteredText, 'Final pass two.');
});

test('multiple regens: only the last pass survives in note', () => {
  const r = splitNoteStream('one__REGEN__two__REGEN__three');
  assert.equal(r.sawRegen, true);
  assert.equal(r.note, 'three');
});

test('empty / whitespace', () => {
  assert.deepEqual(splitNoteStream(''), { note: '', metaRaw: null, sawRegen: false });
});
