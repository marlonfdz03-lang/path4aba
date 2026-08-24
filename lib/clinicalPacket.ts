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
  replacementDomainFound: boolean;   // the replacement-program domain — gates the replacement completeness guard
  interventionDomainFound: boolean;  // the interventions domain — gates the interventions completeness guard
  hasFunctionalAssessment: boolean;  // a FAST/MAS/FA source — gates function provenance
  totalChars: number;                // packet size (must stay < 90000)
}

export const PACKET_BUDGET = 80000; // hard ceiling, under the old 90K

// Function-assessment vocabulary — casing/whitespace/plural tolerant (adjustment 3).
const FUNCTION_TERMS = [/\bescape\b/i, /\battention\b/i, /\btangibles?\b/i, /\bautomatic(?:\s+reinforcement)?\b/i, /\bsensory\b/i];

type Tier = 'required' | 'optional';
interface SectionDef { key: string; label: string; tier: Tier; priority: number; cap: number; anchors: RegExp[]; fa?: boolean }
// RESERVED BUDGET (Marlon's rule): every REQUIRED clinical domain is guaranteed its minimum coverage FIRST;
// OPTIONAL detail/enrichment fills only what remains. This prevents a greedy fill from ever giving a mandatory
// domain zero space (Felix: behaviorDetail ate 32K while replacement got zero → 18 programs collapsed to 9).
// The required domains are the compact IDENTITY/SUMMARY lists (names + status) + the functional-assessment
// evidence — small and cheap; the voluminous per-program detail is optional. `priority` orders within a tier.
const SECTIONS: SectionDef[] = [
  // ── REQUIRED — identity + status + functional evidence (guaranteed first) ──
  { key: 'behaviorSummary', label: 'Behavior summary (identity + status)', tier: 'required', priority: 1, cap: 12000,
    anchors: [/maladaptive behaviors? summary/i, /behaviors? to reduce/i, /summary of behaviors/i, /problem behavior/i, /maladaptive behavior/i, /target behavior/i] },
  { key: 'replacementSummary', label: 'Replacement-program summary (identity + status)', tier: 'required', priority: 1, cap: 12000,
    anchors: [/replacement behaviors? summary/i, /summary of replacement/i, /active replacement/i, /replacement programs?/i, /replacement behavior/i, /skill acquisition/i, /alternative behavior/i] },
  { key: 'functionalAssessment', label: 'FAST / MAS / functional assessment', tier: 'required', priority: 1, cap: 10000, fa: true,
    anchors: [/motivation assessment scale/i, /functional analysis screening/i, /functional (behavior )?assessment/i, /\bQABF\b/] },
  // Interventions are note-critical (every ABC names one) and their identity list is compact, so — like the
  // behavior/replacement summaries — guaranteeing it is cheap; REQUIRED so the packet can never starve it.
  { key: 'interventions', label: 'Interventions', tier: 'required', priority: 1, cap: 6000,
    anchors: [/approved interventions?/i, /interventions? (summary|used|list)/i, /treatment procedure/i, /teaching procedure/i, /\bintervention/i] },
  // ── OPTIONAL — detail / enrichment (fills only the remaining budget) ──
  { key: 'behaviorDetail', label: 'Detailed behavior programs', tier: 'optional', priority: 2, cap: 24000,
    anchors: [/operational definition/i, /reduction target/i, /behavior program/i] },
  { key: 'replacementDetail', label: 'Detailed replacement programs', tier: 'optional', priority: 3, cap: 24000,
    anchors: [/replacement program/i, /alternative behavior/i, /replacement behavior/i, /skill acquisition/i] },
  { key: 'reinforcers', label: 'Reinforcers', tier: 'optional', priority: 5, cap: 3000,
    anchors: [/reinforcer/i, /preference assessment/i] },
  { key: 'diagnosis', label: 'Diagnosis / background', tier: 'optional', priority: 6, cap: 3000,
    anchors: [/diagnos/i, /background/i, /recipient/i] },
  { key: 'changes', label: 'Changes this authorization', tier: 'optional', priority: 7, cap: 2000,
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

// Collect small windows around every DISCONTINUED / MASTERED marker across the WHOLE doc, so a formal status
// CHANGE that appears very late (Felix: DISCONTINUED at ~99-101K) is never missed even if the main behavior
// region is early. Deliberately NOT "status:" / "maintenance" — those recur on every item and would flood the
// budget; active/unknown items are already inside the behavior/replacement regions. Only the authoritative
// status CHANGES (which can be name-only and late) need doc-wide capture.
function statusWindows(text: string, radius = 450): Array<[number, number]> {
  const rx = /\b(discontinued|mastered)\b/gi;
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

  const ranges: Array<{ range: [number, number]; priority: number; tier: Tier }> = [];
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
        ranges.push({ range: [start, end], priority: s.priority, tier: s.tier });
        manifest.push({ key: s.key, label: s.label, found: true, anchorMatched: 'function-column-signature', confidence: 'strong', start, end, chars: end - start });
      } else {
        manifest.push({ key: s.key, label: s.label, found: false, anchorMatched: null, confidence: 'none', start: -1, end: -1, chars: 0 });
      }
      continue;
    }
    const found = hit.index >= 0;
    let start = hit.index, end = hit.index;
    if (found) {
      // Extend to the next SAME-OR-HIGHER-priority section's anchor (not this section's own later anchors, and
      // not a LOWER-priority anchor that merely happens to appear mid-section — e.g. a "changes made" mention
      // inside the behavior detail must not truncate it), capped.
      const otherStarts = anchorHits.filter((a) => a.s.key !== s.key && a.s.priority <= s.priority && a.hit.index > hit.index).map((a) => a.hit.index);
      const nextBoundary = otherStarts.length ? Math.min(...otherStarts) : text.length;
      end = Math.min(hit.index + s.cap, nextBoundary);
      ranges.push({ range: [start, end], priority: s.priority, tier: s.tier });
    }
    manifest.push({ key: s.key, label: s.label, found, anchorMatched: found ? hit.anchor : null, confidence: found ? (hit.confidence === 'none' ? 'strong' : hit.confidence) : 'none', start: found ? start : -1, end: found ? end : -1, chars: found ? end - start : 0 });
  }

  // Status windows across the whole doc — REQUIRED (never lose a late DISCONTINUED block).
  for (const w of statusWindows(text)) ranges.push({ range: w, priority: 0, tier: 'required' });

  // RESERVED-BUDGET ASSEMBLY. Phase 1: include EVERY required range first (guaranteed minimum coverage of each
  // mandatory domain — identity/summary + FA + status). Phase 2: fill the remaining budget with optional detail
  // by priority. Separators are counted so the assembled packet never exceeds budget (no hard slice that would
  // drop late sections). This is what stops a mandatory domain (e.g. replacement) from ever getting zero space.
  const SEP = '\n\n…\n\n';
  const sizeOf = (rs: Array<[number, number]>) => rs.reduce((n, [a, b]) => n + (b - a), 0) + Math.max(0, rs.length - 1) * SEP.length;
  const chosen: Array<[number, number]> = [];
  for (const r of ranges.filter((r) => r.tier === 'required')) chosen.push(r.range); // guaranteed
  for (const r of ranges.filter((r) => r.tier === 'optional').sort((a, b) => a.priority - b.priority)) {
    if (sizeOf(mergeRanges([...chosen, r.range])) <= PACKET_BUDGET) chosen.push(r.range);
  }
  const finalRanges = mergeRanges(chosen).sort((a, b) => a[0] - b[0]);

  // Fail-safe: located nothing → bounded fallback slice (never worse than today), flagged behaviorDomainFound=false.
  let packet = finalRanges.length ? finalRanges.map(([a, b]) => text.slice(a, b)).join(SEP) : text.slice(0, PACKET_BUDGET);
  if (packet.length > PACKET_BUDGET) packet = packet.slice(0, PACKET_BUDGET); // defensive; greedy already fits

  // Flags reflect what is ACTUALLY in the assembled packet (not merely detected) — so provenance can never
  // claim a functional assessment the LLM did not receive.
  const inPacket = (m: SectionMatch) => m.found && finalRanges.some(([a, b]) => m.start < b && m.end > a);
  const has = (...keys: string[]) => manifest.some((m) => keys.includes(m.key) && inPacket(m));
  const behaviorDomainFound = has('behaviorSummary', 'behaviorDetail');
  const replacementDomainFound = has('replacementSummary', 'replacementDetail');
  const interventionDomainFound = has('interventions');
  const hasFunctionalAssessment = has('functionalAssessment');
  const REQUIRED_LABELS: Record<string, string> = { behaviorSummary: 'Behavior summary', replacementSummary: 'Replacement-program summary', interventions: 'Interventions', functionalAssessment: 'Functional assessment' };
  const missing = Object.keys(REQUIRED_LABELS).filter((k) => !has(k)).map((k) => REQUIRED_LABELS[k]);

  return { packet, manifest, missing, behaviorDomainFound, replacementDomainFound, interventionDomainFound, hasFunctionalAssessment, totalChars: packet.length };
}
