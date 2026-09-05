// Segmentation-soundness classification — the gate uses this to suppress the two segmentation-dependent
// checks (function coverage + validity) when the split can't be trusted. Cases mirror the three real shapes
// measured 2026-09-05: unsegmentable, one segment spanning the whole note (degenerate), and sparse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segmentationIsUnsound } from './segmentSoundness.ts';

const NOTE = 'x'.repeat(1000); // note length 1000 for easy ratios

test('SOUND: evenly sized segments, segmentable', () => {
  const r = segmentationIsUnsound(NOTE, ['a'.repeat(300), 'b'.repeat(350), 'c'.repeat(300)], true);
  assert.equal(r.unsound, false);
  assert.equal(r.reason, null);
});

test('UNSEGMENTABLE: the segmenter reported it could not segment', () => {
  // Even with fine-looking segments, segmentable=false is decisive (findMissingFunctionABCs failed to anchor/bound).
  const r = segmentationIsUnsound(NOTE, ['a'.repeat(300), 'b'.repeat(300)], false);
  assert.equal(r.unsound, true);
  assert.equal(r.reason, 'unsegmentable');
  assert.equal(r.stats.unsegmentable, true);
});

test('DEGENERATE: one segment is the whole note (>=90%)', () => {
  // The real shape: "Throwing Objects" got segAsmLen == whole note; others tiny.
  const r = segmentationIsUnsound(NOTE, [NOTE, 'a'.repeat(50), 'b'.repeat(50)], true);
  assert.equal(r.unsound, true);
  assert.equal(r.reason, 'degenerate');
  assert.equal(r.stats.degenerateSegments, 1);
});

test('SPARSE: a <120-char segment while another exceeds 400', () => {
  const r = segmentationIsUnsound(NOTE, ['a'.repeat(500), 'b'.repeat(80), 'c'.repeat(300)], true);
  assert.equal(r.unsound, true);
  assert.equal(r.reason, 'sparse');
  assert.equal(r.stats.sparseSegments, 1);
});

test('NOT sparse: short segments only, none exceeding 400 (no peer)', () => {
  const r = segmentationIsUnsound(NOTE, ['a'.repeat(80), 'b'.repeat(90)], true);
  assert.equal(r.unsound, false, 'short-but-balanced is not the sparse failure shape');
});

test('stats are reported for the admin record', () => {
  const r = segmentationIsUnsound(NOTE, [NOTE, 'a'.repeat(50)], true);
  assert.equal(r.stats.behaviorCount, 2);
  assert.equal(r.stats.noteLen, 1000);
  assert.equal(r.stats.maxSegLen, 1000);
  assert.equal(r.stats.minSegLen, 50);
});
