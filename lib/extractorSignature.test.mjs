// Routing guard for parsePdf's extractor choice. Imports ONLY the pure signature module (no prisma / @/
// alias), so it runs under `npm test` (node --test "lib/**/*.test.mjs").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capSplitSignature, shouldUsePdfjs, SIGNATURE_THRESHOLD } from './extractorSignature.ts';

// The leading-capital-split signatures measured on the five stored assessment PDFs (per 1000 chars). The
// three clean exports sit far below 1.0; the two corrupted fonts far above — a ~30x separation.
const MEASURED = [
  { name: 'Brandon', signature: 0.18, expect: 'pdf2json' },
  { name: 'Alexandra', signature: 0.19, expect: 'pdf2json' },
  { name: 'Ximena', signature: 0.11, expect: 'pdf2json' },
  { name: 'Felix', signature: 5.82, expect: 'pdfjs' },
  { name: 'Hendrex', signature: 6.44, expect: 'pdfjs' },
];

test('routing: clean docs route to pd2json, corrupted docs route to pdfjs (measured signatures)', () => {
  for (const d of MEASURED) {
    const route = shouldUsePdfjs(d.signature) ? 'pdfjs' : 'pdf2json';
    assert.equal(route, d.expect, `${d.name} (signature ${d.signature}) must route to ${d.expect}`);
  }
});

test('threshold is 1.0 and the boundary is inclusive (>=)', () => {
  assert.equal(SIGNATURE_THRESHOLD, 1.0);
  assert.equal(shouldUsePdfjs(0.99), false);
  assert.equal(shouldUsePdfjs(1.0), true); // exactly at threshold -> pdfjs
  assert.equal(shouldUsePdfjs(1.01), true);
});

test('capSplitSignature: rate = 1000 * matches / length', () => {
  // one split ("T opography") in 11 chars
  assert.ok(Math.abs(capSplitSignature('T opography') - 1000 / 11) < 0.01);
  // two splits ("T opography", "R ecipient") padded to exactly 1000 chars -> 2.0
  const head = 'T opography R ecipient ';
  const padded = head + 'x'.repeat(1000 - head.length);
  assert.equal(padded.length, 1000);
  assert.ok(Math.abs(capSplitSignature(padded) - 2.0) < 0.001, `expected ~2.0, got ${capSplitSignature(padded)}`);
});

test('capSplitSignature: empty and split-free text score 0', () => {
  assert.equal(capSplitSignature(''), 0);
  assert.equal(capSplitSignature('no leading capital splits here just lowercase prose'), 0);
});
