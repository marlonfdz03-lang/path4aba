// Clinical Extraction Packet — replaces `text.slice(0, 90000)` at the extractor boundary. A large assessment
// (Felix's is 286K chars) puts the authoritative content at the END: behaviors at ~pp.28-42, the formal
// DISCONTINUED status blocks at ~99-101K, and the FAST/MAS function tables at ~153K/241K — all past the old
// 90K cut. "First N characters" ≠ "the necessary clinical information". This builds a compact packet by
// locating the clinically relevant regions across the WHOLE document, staying UNDER the old 90K (so cost /
// latency / 429s improve, not worsen).
//
// Two SEPARATE confidences (Marlon's adjustment 1):
//   • behaviorDomainFound — did we locate the maladaptive-behavior / behavior-detail domain being replaced?
//     If NOT, the caller preserves via the guard (adjustment 2 — hard-fail only when the essential domain is
//     missing). A missing FAST/MAS does NOT block the behavior overwrite.
//   • hasFunctionalAssessment — was a FAST/MAS/functional-assessment source located? Drives function
//     PROVENANCE: present → functions may be 'documented-functional-assessment'; absent → 'inferred'. Never
//     store an unverified function as documented (adjustment: provenance at its root).
//
// The manifest records per section: found, anchorMatched, confidence, char range (adjustment 4 — auditable).
// Pure, unit-tested; no LLM, no DB.

export type SectionConfidence = 'strong' | 'weak' | 'none';
export interface SectionMatch {
  key: string;
  label: string;
  found: boolean;
  anchorMatched: string | null;   // which anchor hit (auditable)
  confidence: SectionConfidence;  // strong = heading-like; weak = mid-prose coincidental
  start: number;
  end: number;
  chars: number;
}
export interface PacketResult {
  packet: string;
  manifest: SectionMatch[];
  missing: string[];                 // required/expected sections not located
  behaviorDomainFound: boolean;      // the essential behavior domain — gates preserve-vs-overwrite
  hasFunctionalAssessment: boolean;  // a FAST/MAS/FA source — gates function provenance
  totalChars: number;                // packet size (must stay < 90000)
}

export const PACKET_BUDGET = 80000; // hard ceiling, under the old 90K

// Function-assessment vocabulary — casing/whitespace/plural tolerant (adjustment 3).
const FUNCTION_TERMS = [/\bescape\b/i, /\battention\b/i, /\btangibles?\b/i, /\bautomatic(?:\s+reinforcement)?\b/i, /\bsensory\b/i];

interface SectionDef { key: string; label: string; priority: number; cap: number; anchors: RegExp[]; required?: boolean; fa?: boolean }
// Priority = clinical importance for the budget (1 = keep first). Caps bound each section.
const SECTIONS: SectionDef[] = [
  { key: 'behaviorDetail', label: 'Detailed behavior programs', priority: 1, cap: 30000, required: true,
    anchors: [/maladaptive behavior/i, /operational definition/i, /reduction target/i, /behavior program/i, /target behavior/i] },
  { key: 'maladaptiveSummary', label: 'Maladaptive behaviors summary', priority: 2, cap: 6000, required: true,
    anchors: [/maladaptive behaviors? summary/i, /behaviors? to reduce/i, /problem behavior/i, /summary of behaviors/i] },
  { key: 'functionalAssessment', label: 'FAST / MAS / functional assessment', priority: 3, cap: 9000, fa: true,
    anchors: [/motivation assessment scale/i, /functional analysis screening/i, /functional (behavior )?assessment/i, /\bQABF\b/] },
  { key: 'replacement', label: 'Replacement behaviors / programs', priority: 4, cap: 18000,
    anchors: [/replacement behaviors? summary/i, /replacement behavior/i, /replacement program/i, /skill acquisition/i, /alternative behavior/i] },
  { key: 'interventions', label: 'Interventions', priority: 5, cap: 4000,
    anchors: [/treatment procedure/i, /teaching procedure/i, /\bintervention/i] },
  { key: 'reinforcers', label: 'Reinforcers', priority: 6, cap: 3000,
    anchors: [/reinforcer/i, /preference assessment/i] },
  { key: 'diagnosis', label: 'Diagnosis / background', priority: 7, cap: 3000,
    anchors: [/diagnos/i, /background/i, /recipient/i] },
  { key: 'changes', label: 'Changes this authorization', priority: 8, cap: 2000,
    anchors: [/changes made/i, /modifications/i, /since (the )?last authorization/i] },
];

// Heading-like = the match sits at (or very near) the start of a line — a real section header, not a
// coincidental mid-sentence mention.
function headingLike(text: string, idx: number): boolean {
  if (idx <= 0) return true;
  const before = text.slice(Math.max(0, idx - 5), idx);
  return /[\n\r]\s{0,4}$/.test(before) || /^\s{0,4}$/.test(before);
}

interface Hit { index: number; anchor: string; confidence: SectionConfidence }
function locate(text: string, anchors: RegExp[]): Hit {
  let weak: Hit | null = null;
  for (const re of anchors) {
    const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = rx.exec(text)) !== null) {
      if (headingLike(text, m.index)) return { index: m.index, anchor: re.source, confidence: 'strong' };
      if (!weak) weak = { index: m.index, anchor: re.source, confidence: 'weak' };
      if (m.index === rx.lastIndex) rx.lastIndex++;
    }
  }
  return weak ?? { index: -1, anchor: '', confidence: 'none' };
}

// Detect the actual FAST/MAS function TABLE: a functional-assessment HEADING with the function-column
// signature (>=4 distinct function terms) within the window right after it. Requiring BOTH distinguishes the
// real scored table from (a) a table-of-contents mention of "Motivation Assessment Scale" with no data, and
// (b) ordinary prose that merely lists functions. Precision over recall — better to under-claim (functions
// marked inferred) than to falsely claim a documented functional assessment. Returns the heading index or -1.
// Prefer FULL-NAME headings (they mark the table's title, so the region we build captures title + column
// headers + rows); fall back to the bare MAS/FAST acronyms only if no full name carries the signature. A
// heading counts only when >=4 distinct function terms appear within the window right after it.
const FA_HEADING_STRONG = /\b(motivation assessment scale|functional analysis screening(?: tool)?|functional (?:behavior )?assessment|QABF)\b/gi;
const FA_HEADING_WEAK = /\b(MAS|FAST)\b/g;
function detectFunctionTable(text: string): number {
  for (const re of [FA_HEADING_STRONG, FA_HEADING_WEAK]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const win = text.slice(m.index, m.index + 2000); // title + column headers + first rows
      if (FUNCTION_TERMS.filter((t) => t.test(win)).length >= 4) return m.index;
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  return -1;
}

// Collect small windows around every status marker across the WHOLE doc, so a formal DISCONTINUED block that
// appears very late (Felix: ~99-101K) is never missed even if the main behavior region is early.
function statusWindows(text: string, radius = 450): Array<[number, number]> {
  const rx = /\b(discontinued|status\s*:|\bmastered\b|\bmaintenance\b)/gi;
  const ranges: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text)) !== null) {
    ranges.push([Math.max(0, m.index - radius), Math.min(text.length, m.index + radius)]);
    if (m.index === rx.lastIndex) rx.lastIndex++;
  }
  return ranges;
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  if (!ranges.length) return [];
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    if (sorted[i][0] <= last[1] + 200) last[1] = Math.max(last[1], sorted[i][1]); // merge overlapping/adjacent
    else out.push(sorted[i]);
  }
  return out;
}

export function buildClinicalPacket(fullText: string): PacketResult {
  const text = String(fullText ?? '');
  const manifest: SectionMatch[] = [];

  // Locate each section; region = anchor → next DIFFERENT-section start (or the section's cap).
  const anchorHits = SECTIONS.map((s) => ({ s, hit: locate(text, s.anchors) }));

  const ranges: Array<{ range: [number, number]; priority: number }> = [];
  for (const { s, hit } of anchorHits) {
    // FUNCTIONAL ASSESSMENT is located by the function-column SIGNATURE (the real table), NOT a heading word —
    // a bare "Motivation Assessment Scale" can be a table-of-contents mention with no functional data. Requiring
    // the signature is what makes hasFunctionalAssessment trustworthy for provenance ("documented" only when the
    // actual table was seen). A heading with no table → not found → functions stay INFERRED (conservative).
    if (s.fa) {
      const sig = detectFunctionTable(text);
      if (sig >= 0) {
        const start = Math.max(0, sig - 300);
        const end = Math.min(sig + s.cap, text.length);
        ranges.push({ range: [start, end], priority: s.priority });
        manifest.push({ key: s.key, label: s.label, found: true, anchorMatched: 'function-column-signature', confidence: 'strong', start, end, chars: end - start });
      } else {
        manifest.push({ key: s.key, label: s.label, found: false, anchorMatched: null, confidence: 'none', start: -1, end: -1, chars: 0 });
      }
      continue;
    }
    const found = hit.index >= 0;
    let start = hit.index, end = hit.index;
    if (found) {
      // Extend to the next OTHER section's anchor (not this section's own later anchors), capped.
      const otherStarts = anchorHits.filter((a) => a.s.key !== s.key && a.hit.index > hit.index).map((a) => a.hit.index);
      const nextBoundary = otherStarts.length ? Math.min(...otherStarts) : text.length;
      end = Math.min(hit.index + s.cap, nextBoundary);
      ranges.push({ range: [start, end], priority: s.priority });
    }
    manifest.push({ key: s.key, label: s.label, found, anchorMatched: found ? hit.anchor : null, confidence: found ? (hit.confidence === 'none' ? 'strong' : hit.confidence) : 'none', start: found ? start : -1, end: found ? end : -1, chars: found ? end - start : 0 });
  }

  // Status windows across the whole doc — highest priority (never lose a late DISCONTINUED block).
  for (const w of statusWindows(text)) ranges.push({ range: w, priority: 0 });

  // Greedy include by priority within budget, then present in document order.
  ranges.sort((a, b) => a.priority - b.priority);
  const chosen: Array<[number, number]> = [];
  let used = 0;
  for (const { range } of ranges) {
    const merged = mergeRanges([...chosen, range]);
    const size = merged.reduce((n, [a, b]) => n + (b - a), 0);
    if (size <= PACKET_BUDGET) { chosen.push(range); used = size; }
  }
  const finalRanges = mergeRanges(chosen).sort((a, b) => a[0] - b[0]);

  // Fail-safe: located nothing → bounded fallback slice (never worse than today), flagged by behaviorDomainFound=false.
  let packet: string;
  if (!finalRanges.length) packet = text.slice(0, PACKET_BUDGET);
  else packet = finalRanges.map(([a, b]) => text.slice(a, b)).join('\n\n…\n\n');
  if (packet.length > PACKET_BUDGET) packet = packet.slice(0, PACKET_BUDGET);

  const behaviorDomainFound = manifest.some((m) => (m.key === 'behaviorDetail' || m.key === 'maladaptiveSummary') && m.found);
  const hasFunctionalAssessment = manifest.some((m) => m.key === 'functionalAssessment' && m.found);
  const missing = manifest.filter((m) => (m.key === 'behaviorDetail' || m.key === 'maladaptiveSummary' || m.key === 'functionalAssessment') && !m.found).map((m) => m.label);

  return { packet, manifest, missing, behaviorDomainFound, hasFunctionalAssessment, totalChars: packet.length };
}
