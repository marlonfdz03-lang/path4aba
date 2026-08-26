// SINGLE SOURCE OF TRUTH for the two inputs filterBlockedNarrative needs beyond its hardcoded list:
//   - learnedBlockedTerms (extraTerms): the shared blocked_narrative_terms table, with a per-client
//     clinical_profile.blockedNarrativeTerms fallback when the table isn't present yet.
//   - authorizedNames: plan-derived names a blocked term may legitimately sit inside (a "Calm-Down Routine"
//     program, a "sensory bin"/"Sensory Diet" name) — these spans are protected from substitution.
//
// The generation path (lib/generateSmartNote.ts) and the save-time backstop (extension/save-note,
// session-notes) BOTH call this, so the set of terms blocked and the set of names protected can never
// drift between "what we filtered when we generated" and "what we re-filter when we store".
//
// Fail-soft by construction: each source is best-effort. A missing table or an unreadable profile degrades
// to the hardcoded BLOCKED_NARRATIVE_TERMS list (applied by filterBlockedNarrative itself), never an error.

import { prisma } from '@/lib/prisma';
import type { BlockedTerm } from '@/lib/blockedNarrativeTerms';

export interface BlockedFilterContext {
  learnedBlockedTerms: BlockedTerm[];
  authorizedNames: string[];
}

export async function buildBlockedFilterContext(clientId: string): Promise<BlockedFilterContext> {
  let learnedBlockedTerms: BlockedTerm[] = [];
  let authorizedNames: string[] = [];
  // SHARED blocked-terms table (global, protects every client). Fail-soft: if the table isn't present yet
  // (migration scripts/blocked-narrative-terms-table.sql not run), fall back to the per-client list below.
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>('SELECT term, substitute FROM blocked_narrative_terms');
    if (Array.isArray(rows) && rows.length) learnedBlockedTerms = rows.map((r) => ({ term: String(r.term), substitute: r.substitute ?? null })).filter((t) => t.term);
  } catch { /* table not present yet → per-client fallback */ }
  try {
    const c = await prisma.clients.findUnique({ where: { id: clientId }, select: { clinical_profile: true } });
    const cp = (c?.clinical_profile as any) || {};
    const bt = cp?.blockedNarrativeTerms;
    if (!learnedBlockedTerms.length && Array.isArray(bt)) {
      learnedBlockedTerms = bt
        .map((t: any) => (typeof t === 'string' ? { term: t, substitute: null } : { term: t?.term, substitute: t?.substitute ?? null }))
        .filter((t: BlockedTerm) => t.term);
    }
    // PLAN-CONTENT PROTECTION: authorized names a blocked term may legitimately sit inside (a "Calm-Down
    // Routine" program, a "sensory bin" reinforcer). filterBlockedNarrative leaves these spans untouched.
    const reinf = cp.reinforcers;
    authorizedNames = [
      ...((cp.interventions || []) as any[]).map((x) => x?.name || x),
      ...((cp.replacementBehaviors || []) as any[]).map((x) => x?.name || x),
      ...((cp.skillAcquisition || []) as any[]).map((x) => x?.name || x),
      ...((cp.maladaptiveBehaviors || []) as any[]).flatMap((b) => [b?.name, ...((b?.topographies || []) as any[])]),
      ...(Array.isArray(reinf) ? reinf : reinf && typeof reinf === 'object' ? Object.values(reinf).flat() : []),
    ].map((n) => String(n || '')).filter((n) => n.trim().length >= 3);
  } catch { /* learned terms + protection are best-effort; the seeded list still applies */ }
  return { learnedBlockedTerms, authorizedNames };
}
