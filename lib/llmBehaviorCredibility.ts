// Credibility gate for using an LLM-extracted behavior set when the geometry read is UNREAD (prose-woven
// assessments). The behavior guard stays: we only OVERWRITE real behaviors with an LLM read that passes a
// conservative check — "uncertain → preserve; credible → llm-fallback (requires review)". Overwriting a real
// profile with a bad read is the exact failure the guard exists to prevent, so this errs toward preserve.
//
// Also encodes the DISCONTINUED-AUTHORITY rule (post-extraction reconciliation): a formal "Status:
// Discontinued" for a behavior name outranks any incidental narrative mention of the same name as active.
// (Felix: Climbing and Lining up Objects carry formal DISCONTINUED declarations yet reappear in a later
// "13 active" narrative list — they must NOT be active.)
//
// Pure + unit-tested. No DB, no LLM. Statuses/functions match lib/extractAssessment.ts.

const VALID_FUNCTIONS = new Set(['attention', 'escape', 'tangible', 'automatic']);
const VALID_STATUS = new Set(['active', 'maintenance', 'unknown', 'mastered', 'discontinued', '']);
const INACTIVE_STATUS = new Set(['mastered', 'discontinued']);

export const normName = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const statusOf = (b: any): string => String(b?.status ?? '').toLowerCase();

// A name that is clearly not a behavior label: empty, a bare number, a section heading, or a
// sentence/paragraph fragment (a real behavior name is a short noun phrase).
const HEADING_RE = /^(section|target behaviors?|behaviors? to (reduce|increase)|replacement|goals?|introduction|summary|background|assessment|reinforc|intervention|history|note|table|appendix)\b/i;
export function looksLikeGarbageName(name: unknown): boolean {
  const t = String(name ?? '').trim();
  if (!t) return true;
  if (/^\d+[.)]?$/.test(t)) return true;                 // bare number "3" / "3."
  if (HEADING_RE.test(t)) return true;                   // a section heading pulled in as a behavior
  const words = t.split(/\s+/);
  if (words.length > 10) return true;                    // paragraph fragment
  if (words.length > 6 && /[.!?]$/.test(t)) return true; // full sentence
  return false;
}

// DISCONTINUED-AUTHORITY reconciliation + active extraction. Groups by normalized name; if ANY instance of a
// name is discontinued (a formal status block), the name is treated as discontinued and dropped from active,
// even if another instance says active (an incidental narrative mention). Also drops mastered, and de-dupes
// active names by normalization. Returns the reconciled ACTIVE behavior objects (original casing preserved).
export function reconcileBehaviors(llmBehaviors: any[]): { active: any[]; droppedDiscontinued: string[] } {
  const list = Array.isArray(llmBehaviors) ? llmBehaviors : [];
  const statusesByName = new Map<string, Set<string>>();
  for (const b of list) {
    const k = normName(b?.name);
    if (!k) continue;
    const set = statusesByName.get(k) ?? new Set<string>();
    set.add(statusOf(b));
    statusesByName.set(k, set);
  }
  const active: any[] = [];
  const seen = new Set<string>();
  const droppedDiscontinued: string[] = [];
  for (const b of list) {
    const k = normName(b?.name);
    const statuses = k ? statusesByName.get(k) : undefined;
    const nameIsDiscontinued = !!statuses && statuses.has('discontinued'); // authority: any discontinued wins
    if (nameIsDiscontinued) { if (k && !droppedDiscontinued.includes(k)) droppedDiscontinued.push(String(b?.name || k)); continue; }
    if (INACTIVE_STATUS.has(statusOf(b))) continue;       // mastered (and belt-and-suspenders discontinued)
    if (k && seen.has(k)) continue;                       // de-dupe active by normalized name
    if (k) seen.add(k);
    active.push(b);
  }
  return { active, droppedDiscontinued };
}

// REPLACEMENT COMPLETENESS GUARD — the second barrier the skills side was missing. A starved packet or a
// partial extraction must never silently wholesale-overwrite the replacement-program catalog (Felix: 18→9).
//
// The blind spot Brandon exposed: the old guard fired on "newCount < 60% of prevCount" and PRESERVED — which
// treats a READ FAILURE (the document lists 11, we extracted 4) identically to a REAL plan shrinkage (the
// document genuinely lists 4). It can't tell them apart because it never looks at the SOURCE. Brandon's
// preserve was correct only by continuity luck (old 11 == the document's 11 active).
//
// FIX: `regionItemCount` — a DETERMINISTIC count of the programs actually present in the located roster region
// (lib/pdfGeometry readReplacementRoster). It is the source ground truth:
//   • region lists ~11 but we extracted 4  → READ FAILURE  → do NOT silently preserve; caller flags "under-read"
//   • region lists ~4 and we extracted ~4  → REAL SHRINKAGE → refresh to 4 (even though it dropped vs previous)
// When no region count is available (-1, roster not located), fall back to the previous-count heuristic.
export interface CompletenessResult { refresh: boolean; readFailure: boolean; reason: string }

function assessCompleteness(kind: 'replacement programs' | 'interventions', newCount: number, prevCount: number, domainFound: boolean, regionItemCount: number): CompletenessResult {
  if (!domainFound) return { refresh: false, readFailure: false, reason: `the ${kind} domain was not located in the assessment — preserved from the previous assessment, review` };
  if (newCount === 0) return { refresh: false, readFailure: false, reason: `no ${kind} were extracted — preserved from the previous assessment, review` };
  // Region-aware branch (the source ground truth): distinguish read-failure from real shrinkage.
  if (regionItemCount >= 5 && newCount < Math.ceil(regionItemCount * 0.6))
    return { refresh: false, readFailure: true, reason: `under-read: the assessment lists ~${regionItemCount} ${kind} but only ${newCount} were extracted — re-read needed, NOT silently preserved` };
  if (regionItemCount >= 0 && newCount >= Math.ceil(regionItemCount * 0.6))
    return { refresh: true, readFailure: false, reason: '' }; // we read essentially the whole region → trust it (change is real, not a miss)
  // No region signal → previous-count heuristic (unchanged legacy behavior).
  if (prevCount >= 5 && newCount < Math.ceil(prevCount * 0.6))
    return { refresh: false, readFailure: false, reason: `large unexplained drop in ${kind} (${prevCount} → ${newCount}) — preserved from the previous assessment, review the assessment` };
  return { refresh: true, readFailure: false, reason: '' };
}

export function assessReplacementCompleteness(newCount: number, prevCount: number, domainFound: boolean, regionItemCount = -1): CompletenessResult {
  return assessCompleteness('replacement programs', newCount, prevCount, domainFound, regionItemCount);
}

// INTERVENTIONS COMPLETENESS GUARD — same shape, same blind spot. Interventions are note-critical (every ABC
// names one) and wholesale-refreshed with only empty-validation, so a partial drop (e.g. 33→3) would overwrite
// silently. `regionItemCount` here is an APPROXIMATE deterministic count (readInterventionRoster) — an
// under-read of the region is safe (the guard only uses it to catch a gross under-extraction, never to preserve).
export function assessInterventionCompleteness(newCount: number, prevCount: number, domainFound: boolean, regionItemCount = -1): CompletenessResult {
  return assessCompleteness('interventions', newCount, prevCount, domainFound, regionItemCount);
}

export interface CredibilityResult { credible: boolean; reasons: string[]; behaviors: any[] }

// Assess whether the reconciled ACTIVE LLM behavior set is credible enough to OVERWRITE the existing profile.
// `previousCount` is the count of the existing active behaviors being replaced (for the collapse sanity check).
export function assessLlmBehaviorCredibility(reconciledActive: any[], previousCount = 0): CredibilityResult {
  const bs = Array.isArray(reconciledActive) ? reconciledActive : [];
  const reasons: string[] = [];

  if (bs.length === 0) reasons.push('empty active behavior set after reconciliation');

  let functionBearing = 0;
  for (const b of bs) {
    const name = String(b?.name ?? '').trim();
    if (!name) { reasons.push('a behavior has no name'); continue; }
    if (looksLikeGarbageName(name)) { reasons.push(`non-behavior / garbage name: "${name.slice(0, 48)}"`); continue; }
    if (!VALID_STATUS.has(statusOf(b))) reasons.push(`invalid status "${b?.status}" on "${name}"`);
    const fns = (Array.isArray(b?.functions) ? b.functions : []).map((f: any) => String(f).toLowerCase());
    if (fns.length) {
      functionBearing++;
      const bad = fns.filter((f: string) => !VALID_FUNCTIONS.has(f));
      if (bad.length) reasons.push(`invalid function(s) on "${name}": ${bad.join(', ')}`);
    }
  }

  // Schema allows a name-only behavior with no function, so a missing function is not itself a rejection —
  // but a set where NOT ONE behavior carries a function reads as a partial parse, so preserve instead.
  if (bs.length > 0 && functionBearing === 0) reasons.push('no behavior in the set carries any function — likely a partial parse');

  // Cardinality: a reassessment may legitimately add/remove many, so we do NOT require similarity to the
  // previous count. We only reject a near-total collapse with no corroboration (e.g. 14 previous → 1 new).
  if (previousCount >= 5 && bs.length === 1) reasons.push(`suspicious collapse: ${previousCount} previous behaviors → 1 new`);

  const credible = reasons.length === 0;
  return { credible, reasons, behaviors: bs };
}
