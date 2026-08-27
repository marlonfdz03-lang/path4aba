// PARITY GUARD for the extension's hand-ported splitNoteStream.
//
// The Chrome extension (extension/popup.js) has no module system and no build step, so it cannot import
// lib/noteStream.ts — it carries a hand copy of splitNoteStream behind a // __PARITY_START__ / __PARITY_END__
// fence. That copy is a divergence risk (the exact kind we removed elsewhere with a shared helper). This test
// closes it WITHOUT a build step: it reads popup.js as TEXT, extracts the fenced function, evaluates it, and
// runs the SAME vectors as lib/noteStream.test.mjs against it. If the port ever drifts from the shared parser,
// `npm test` goes red. Runs under the existing `node --test "lib/**/*.test.mjs"`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitNoteStream as reference } from './noteStream.ts';

const POPUP = new URL('../extension/popup.js', import.meta.url);
const src = readFileSync(POPUP, 'utf8');

// The fence must still wrap the function — so nobody can quietly delete it and re-introduce the divergence.
const start = src.indexOf('__PARITY_START__');
const end = src.indexOf('__PARITY_END__');
assert.ok(start !== -1 && end !== -1 && start < end, 'popup.js must keep the __PARITY_START__/__PARITY_END__ fence');

// Extract ONLY the function declaration (its closing brace is the first column-0 `}` after it; inner braces
// are indented, so `\n}` matches the function end and not a nested block).
const fnMatch = src.slice(start, end).match(/\nfunction splitNoteStream\(raw\) \{[\s\S]*?\n\}/);
assert.ok(fnMatch, 'could not locate the ported splitNoteStream(raw) inside the fence');
// eslint-disable-next-line no-new-func — evaluating our own repo text in an isolated scope, not user input.
const ported = new Function(`${fnMatch[0]}\nreturn splitNoteStream;`)();

// The 8 vectors — identical to lib/noteStream.test.mjs. Asserted against the PORTED function, and also
// cross-checked field-for-field against the reference so the two implementations are proven equivalent.
test('parity: pass-1 streaming (live text, no meta, no regen)', () => {
  const r = ported('The client ');
  assert.deepEqual(r, { note: 'The client ', metaRaw: null, sawRegen: false });
  assert.deepEqual(r, reference('The client '));
});

test('parity: meta present — note before __META__, metaRaw is the JSON tail', () => {
  const s = 'Final note text.__META__{"similarityWarning":false}';
  assert.deepEqual(ported(s), reference(s));
  const r = ported(s);
  assert.equal(r.note, 'Final note text.');
  assert.equal(r.metaRaw, '{"similarityWarning":false}');
});

test('parity: __META__ JSON that spans reads accumulates until it parses (the null-context fix)', () => {
  const pieces = ['Note body.__META__{"generationContext":{"beh', 'aviorTiers":{"Tantrum":"FAVORABLE"}},"filte', 'redText":"Note body."}'];
  let raw = '';
  let parsed = null;
  for (const p of pieces) {
    raw += p;
    const { metaRaw } = ported(raw);
    assert.deepEqual(ported(raw), reference(raw));
    if (metaRaw) { try { parsed = JSON.parse(metaRaw); } catch { /* keep reading */ } }
  }
  assert.ok(parsed, 'the accumulated meta eventually parses');
  assert.equal(parsed.generationContext.behaviorTiers.Tantrum, 'FAVORABLE');
  assert.equal(parsed.filteredText, 'Note body.');
});

test('parity: regen (untagged) — note is pass-2 text, sawRegen true, pass-1 dropped', () => {
  const s = 'PASS ONE TEXT__REGEN__PASS TWO TEXT';
  assert.deepEqual(ported(s), reference(s));
  const r = ported(s);
  assert.equal(r.sawRegen, true);
  assert.equal(r.note, 'PASS TWO TEXT');
  assert.equal(r.metaRaw, null);
});

test('parity: regen (tagged with :source) — ":source" line dropped, pass-2 after the newline', () => {
  const s = 'PASS ONE__REGEN__:coverage\nPASS TWO';
  assert.deepEqual(ported(s), reference(s));
  assert.equal(ported(s).note, 'PASS TWO');
});

test('parity: regen then meta — final note is pass-2 before __META__', () => {
  const s = 'PASS ONE__REGEN__:coverage\nFinal pass two.__META__{"filteredText":"Final pass two."}';
  assert.deepEqual(ported(s), reference(s));
  const r = ported(s);
  assert.equal(r.sawRegen, true);
  assert.equal(r.note, 'Final pass two.');
  assert.equal(JSON.parse(r.metaRaw).filteredText, 'Final pass two.');
});

test('parity: multiple regens — only the last pass survives', () => {
  const s = 'one__REGEN__two__REGEN__three';
  assert.deepEqual(ported(s), reference(s));
  assert.equal(ported(s).note, 'three');
});

test('parity: empty / whitespace', () => {
  assert.deepEqual(ported(''), { note: '', metaRaw: null, sawRegen: false });
  assert.deepEqual(ported(''), reference(''));
});
