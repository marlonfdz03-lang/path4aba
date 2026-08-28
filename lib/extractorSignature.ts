// Pure routing logic for parsePdf's extractor choice. ZERO imports on purpose so it is unit-testable from
// bare node (lib/extractorSignature.test.mjs) without pulling in prisma or the `@/` alias.
//
// THE SIGNATURE: leading-capital splits per 1000 chars. pdf2json extracts some fonts with a space inserted
// after a word's leading capital ("Topography" -> "T opography"); a clean export has almost none. Measured
// on the five stored assessments: Brandon 0.18, Alexandra 0.19, Ximena 0.11 (clean) vs Felix 5.82,
// Hendrex 6.44 (corrupted) — a ~30x separation, so a threshold of 1.0 routes each side with wide margin.
// This is a FORM measure, not a vocabulary one, and it fires on the split problem specifically (not on
// ligatures, which normalizeLigatures handles and which do not create `[A-Z] [a-z]` matches).

export const SIGNATURE_THRESHOLD = 1.0;

// Leading-capital-split rate per 1000 characters.
export function capSplitSignature(text: string): number {
  if (!text) return 0;
  const matches = text.match(/\b[A-Z] [a-z]{2,}\b/g);
  return ((matches?.length ?? 0) / text.length) * 1000;
}

// At or above threshold => the document is fragmented enough that pd2json's flat join is unreliable and we
// re-extract with pdfjs (layout-aware). Below => keep pd2json's output byte-identical to today.
export function shouldUsePdfjs(signature: number): boolean {
  return signature >= SIGNATURE_THRESHOLD;
}
