// Is a note's per-behavior segmentation trustworthy? The compliance gate's function-COVERAGE and
// function-VALIDITY checks both split a note into per-behavior ABC segments (segmentNoteByBehavior) and read
// each segment. When that split is wrong, both checks read garbage — they report missing/invalid functions
// that are actually fine, which drives a spurious repair and a false "verify this function" flag.
//
// HOW UNRELIABLE (measured 2026-09-05 across all 421 active notes): the segmenter is SOUND on at most ~53% of
// notes at ANY behavior count and 0% at 7+ behaviors. Its failure modes are concrete: it hands one behavior
// the ENTIRE note (a segment ≥ 90% of note length) while others get 100-char scraps, or the coverage check
// cannot anchor/bound the ABCs at all (reports unsegmentable). The three thresholds below are exactly those
// observed shapes — UNSEGMENTABLE, DEGENERATE (≥90%), SPARSE (<120 vs >400).
//
// PURE + import-free (same shape as lib/behaviorSafety.ts, lib/activeNote.ts) so soundness is defined ONCE and
// is unit-testable with injected segment arrays. It takes the ALREADY-COMPUTED segments and the segmenter's
// `segmentable` verdict (from findMissingFunctionABCs) rather than importing the segmenter — that is what keeps
// it import-free; the caller computes both once and passes them in.

export type SegmentUnsoundReason = 'unsegmentable' | 'degenerate' | 'sparse';

export interface SegmentationSoundness {
  unsound: boolean;
  reason: SegmentUnsoundReason | null;
  stats: {
    behaviorCount: number;
    noteLen: number;
    unsegmentable: boolean;
    degenerateSegments: number; // segments >= 90% of note length (one behavior absorbed the whole note)
    sparseSegments: number;     // segments < 120 chars, counted only when another segment exceeds 400
    maxSegLen: number;
    minSegLen: number;
  };
}

const DEGENERATE_FRACTION = 0.9; // a single segment >= 90% of the note → the split collapsed onto one behavior
const SPARSE_FLOOR = 120;        // a segment this short, while another is substantial, is a boundary miss
const SPARSE_PEER = 400;         // "substantial" peer segment

/**
 * `segmentable` is findMissingFunctionABCs(...).segmentable — the segmenter's own "I could not anchor/bound
 * the ABCs" verdict. `segments` is segmentNoteByBehavior(note, behaviors). Both computed by the caller.
 */
export function segmentationIsUnsound(note: string, segments: string[], segmentable = true): SegmentationSoundness {
  const noteLen = (note || '').length;
  const lens = (segments || []).map((s) => (s || '').length);
  const maxSegLen = lens.length ? Math.max(...lens) : 0;
  const minSegLen = lens.length ? Math.min(...lens) : 0;
  const degenerateSegments = noteLen > 0 ? lens.filter((l) => l >= DEGENERATE_FRACTION * noteLen).length : 0;
  const hasSparse = lens.some((l) => l < SPARSE_FLOOR) && lens.some((l) => l > SPARSE_PEER);
  const sparseSegments = hasSparse ? lens.filter((l) => l < SPARSE_FLOOR).length : 0;

  const stats = { behaviorCount: lens.length, noteLen, unsegmentable: !segmentable, degenerateSegments, sparseSegments, maxSegLen, minSegLen };

  // Order matters only for the reason label; any one condition makes it unsound.
  if (!segmentable) return { unsound: true, reason: 'unsegmentable', stats };
  if (degenerateSegments > 0) return { unsound: true, reason: 'degenerate', stats };
  if (hasSparse) return { unsound: true, reason: 'sparse', stats };
  return { unsound: false, reason: null, stats };
}
