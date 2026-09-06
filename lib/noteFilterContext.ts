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
import { redactText } from '@/lib/pdfGeometry';
import type { BlockedTerm } from '@/lib/blockedNarrativeTerms';

export interface BlockedFilterContext {
  learnedBlockedTerms: BlockedTerm[];
  authorizedNames: string[];
  // The client's own identifiers (clinical_profile.name + caregivers), tokenized. This is the SINGLE source
  // the note-generation prompt scrub uses to strip names from topographies before they reach the model (see
  // lib/generateSmartNote).
  personalNames: string[];
  // Distinguishes the two states the prompt scrub must NOT conflate:
  //   'ok'     — the profile was read and the client has a name on file (scrub normally).
  //   'absent' — the profile was read and the client has NO name on file (a legitimate state — GENERATE, but
  //              record the gap; do not block the RBT).
  //   'error'  — the profile read/parse THREW (we cannot verify anything — the caller FAILS CLOSED).
  // Only the read failure blocks a note; a genuinely name-less client still generates.
  nameStatus: 'ok' | 'absent' | 'error';
}

export async function buildBlockedFilterContext(clientId: string): Promise<BlockedFilterContext> {
  let learnedBlockedTerms: BlockedTerm[] = [];
  let authorizedNames: string[] = [];
  let personalNames: string[] = [];
  // Default to 'error': it only becomes 'ok'/'absent' after the profile read below actually succeeds. If that
  // read throws, this stays 'error' and the generation path fails closed.
  let nameStatus: 'ok' | 'absent' | 'error' = 'error';
  // (1) SHARED blocked-terms table (global, protects every client). Fail-soft in its OWN try: if the table isn't
  // present yet (migration scripts/blocked-narrative-terms-table.sql not run), fall back to the per-client list.
  // This is unrelated to PHI and must NEVER touch nameStatus — a table blip stays a quiet degrade, never a block.
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>('SELECT term, substitute FROM blocked_narrative_terms');
    if (Array.isArray(rows) && rows.length) learnedBlockedTerms = rows.map((r) => ({ term: String(r.term), substitute: r.substitute ?? null })).filter((t) => t.term);
  } catch { /* table not present yet → per-client fallback below */ }

  // (2) THE PROFILE READ — the ONLY determinant of nameStatus, in its OWN try so ONLY a profile failure fails
  // closed. On success nameStatus is set from whether the client has a name on file; on failure it STAYS 'error'
  // and the generation path blocks. The catch is NOT silent: a blocked note must leave a trace (the block itself
  // is also recorded as note.generation_failed by the route that catches the resulting throw).
  let cp: any = null;
  try {
    const c = await prisma.clients.findUnique({ where: { id: clientId }, select: { clinical_profile: true } });
    cp = (c?.clinical_profile as any) || {};
    // The client's own identifiers: name + caregiver roster. Tokenized by redactText's own rule (full names +
    // word-parts). nameStatus is 'ok'/'absent' by whether the client's OWN name yields a usable token.
    const clientName = String(cp.name || '').trim();
    nameStatus = clientName.split(/\s+/).some((s) => s.length >= 3) ? 'ok' : 'absent';
    const caregivers = ((cp.caregivers || []) as any[]).map((c2) => (typeof c2 === 'string' ? c2 : c2?.name || '')).filter(Boolean);
    personalNames = [clientName, ...caregivers].map((n) => String(n || '').trim()).filter((n) => n.length >= 3);
  } catch (e) {
    // nameStatus stays 'error' → the generation path FAILS CLOSED. Deliberately logged (not a bare catch): this
    // now blocks an RBT's note, so the reason must be recoverable from the server log.
    nameStatus = 'error';
    console.error(`[note-filter] client profile read FAILED for ${clientId} — note generation will fail closed (PHI cannot be verified):`, (e as Error)?.message);
  }

  // (3) PLAN-CONTENT PROTECTION + the per-client blocked-terms fallback — fail-soft, EXACTLY as before this
  // change. Runs only if the profile read succeeded (cp set); any failure here degrades (authorizedNames stays
  // []), and it can NEVER revert nameStatus or block — this is the quiet-degrade this code always had.
  //   authorizedNames = names a blocked term may legitimately sit inside (a "Calm-Down Routine" program, a
  //   "sensory bin" reinforcer) — filterBlockedNarrative leaves those spans untouched. Topographies are here so
  //   their CLINICAL VOCABULARY ("climbs", "sensory bin") survives the filter; the client's NAME is stripped
  //   from each (names-only, vocabulary untouched) so the last fence no longer protects the name-bearing span.
  if (cp) {
    try {
      const bt = cp?.blockedNarrativeTerms;
      if (!learnedBlockedTerms.length && Array.isArray(bt)) {
        learnedBlockedTerms = bt
          .map((t: any) => (typeof t === 'string' ? { term: t, substitute: null } : { term: t?.term, substitute: t?.substitute ?? null }))
          .filter((t: BlockedTerm) => t.term);
      }
      const reinf = cp.reinforcers;
      authorizedNames = [
        ...((cp.interventions || []) as any[]).map((x) => x?.name || x),
        ...((cp.replacementBehaviors || []) as any[]).map((x) => x?.name || x),
        ...((cp.skillAcquisition || []) as any[]).map((x) => x?.name || x),
        ...((cp.maladaptiveBehaviors || []) as any[]).flatMap((b) => [b?.name, ...((b?.topographies || []) as any[]).map((t) => redactText(String(t || ''), personalNames, { namesOnly: true }))]),
        ...(Array.isArray(reinf) ? reinf : reinf && typeof reinf === 'object' ? Object.values(reinf).flat() : []),
      ].map((n) => String(n || '')).filter((n) => n.trim().length >= 3);
    } catch { /* plan-content protection is best-effort; the seeded blocked list still applies. Never blocks, never touches nameStatus. */ }
  }

  return { learnedBlockedTerms, authorizedNames, personalNames, nameStatus };
}
