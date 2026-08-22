// Shared parsing for the /api/generate-note streamed response. Pure + unit-testable — the fragile part that
// bit us twice (a red-banner wipe on regen; generation_context saved NULL because a per-chunk JSON.parse of a
// chunk-split __META__ tail threw into an empty catch).
//
// The stream is: <pass-1 tokens> [ __REGEN__[:src]\n <pass-2 tokens> ]* __META__{json}
//  - __REGEN__ is the compliance coverage retry marker (optionally ":source"). The note text after the LAST
//    __REGEN__ is the current pass.
//  - __META__ is always LAST; the JSON after it can arrive across several reads, so callers accumulate `raw`
//    and re-run this until the JSON parses.
//
// Callers feed the FULL accumulated stream (`raw`), not a single chunk, so a marker or the meta JSON that
// spans read boundaries is handled correctly.

export interface SplitStream {
  note: string;          // the note text to display for the CURRENT pass (after the last __REGEN__, before __META__)
  metaRaw: string | null; // everything after __META__ (may be partial JSON), or null if __META__ not seen yet
  sawRegen: boolean;      // a coverage retry has begun — freeze the displayed text, show the calm state
}

const META = "__META__";
const REGEN = "__REGEN__";

export function splitNoteStream(raw: string): SplitStream {
  const s = String(raw ?? "");
  const mi = s.indexOf(META);
  const body = mi === -1 ? s : s.slice(0, mi);
  const metaRaw = mi === -1 ? null : s.slice(mi + META.length);

  let note = body;
  let sawRegen = false;
  const ri = body.lastIndexOf(REGEN);
  if (ri !== -1) {
    sawRegen = true;
    let after = body.slice(ri + REGEN.length);
    // Tagged form "__REGEN__:source\n<pass2>": drop the ":source" up to (and including) its newline. Until the
    // newline arrives, the pass-2 text hasn't started, so note is empty.
    if (after.startsWith(":")) {
      const nl = after.indexOf("\n");
      after = nl === -1 ? "" : after.slice(nl + 1);
    }
    note = after;
  }
  return { note, metaRaw, sawRegen };
}
