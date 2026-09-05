// ─────────────────────────────────────────────────────────────────────────────
// COMPLIANCE-GATE FINDINGS — recorded, never blocking.
//
// The gates used to be able to stop a note reaching the RBT: an intervention violation that survived
// the single regeneration THREW, and the RBT saw "Note could not be generated within the client's
// approved treatment plan". That is a system failure presented as a user failure. An RBT at the end
// of a session cannot fix a treatment-plan mismatch, and blocking them does not make the note
// correct — it makes the note not exist.
//
// So the gates now report instead. Every finding lands here silently, the note ships, and the
// findings are reviewed in the admin panel where the ROOT cause can be fixed (an extraction gap, a
// prompt that teaches an unapproved procedure, a plan that needs updating). The clinical firewall
// does not weaken: the same detectors run, on the same rules — only the consequence moves from
// "punish the RBT" to "tell us".
//
// A prohibited procedure (RIRD, restraint, punishment) is recorded as CRITICAL and surfaced loudly
// in the panel. Preselection will make it structurally impossible to generate; until then it must be
// impossible to MISS.
//
// PHI: no note text is ever stored here. Ids and short clinical labels only.
// ─────────────────────────────────────────────────────────────────────────────

// prisma is imported lazily inside recordGateFindings, not at module load: the collection step below
// is pure and must stay importable by the unit tests (which run on bare node, where the `@/` alias
// does not resolve). It also means a note path that never records never pulls in the client.
import type { ComplianceState } from './complianceGate.ts'

export type GateName =
  | 'intervention' | 'approved-function' | 'coverage' | 'teaching-method'
  | 'coherence' | 'red-flag' | 'similarity' | 'blocked-term' | 'data-integrity'
  // Admin-only diagnostic: the per-behavior segmentation was unsound, so coverage + validity were suppressed
  // (record-only — never a repair, never surfaced to the RBT). See generateSmartNote + lib/segmentSoundness.ts.
  | 'segmentation_unsound'
  // Admin-only drift baseline: an ABC named a function outside the set preselect assigned for the note
  // (record-only — never a repair, never surfaced). See functionsOutsideAssignedSet in lib/functionPatterns.ts.
  | 'function_outside_assigned_set'

export type GateSeverity = 'critical' | 'warning' | 'info'

export interface GateFinding {
  gate: GateName
  severity: GateSeverity
  detail: string
  context?: Record<string, unknown>
}

// Build the finding list from the FINAL gate state — what survived the combined regeneration, i.e.
// what actually shipped in the note. Pure and synchronous so it is unit-testable without a database.
export function collectGateFindings(params: {
  state?: ComplianceState | null
  coherenceFlags?: string[]
  redFlags?: string[]
  blockedFlagged?: string[]
  similarityWarning?: boolean
  behaviorsWithoutFunction?: string[]
}): GateFinding[] {
  const out: GateFinding[] = []
  const s = params.state

  if (s) {
    // PROHIBITED is the one that must never be missed: a procedure no plan may ever authorize.
    for (const name of s.intervention.prohibited) {
      out.push({
        gate: 'intervention', severity: 'critical',
        detail: `Prohibited intervention documented: ${name}`,
        context: { intervention: name, kind: 'prohibited' },
      })
    }
    for (const name of s.intervention.unapproved) {
      out.push({
        gate: 'intervention', severity: 'warning',
        detail: `Intervention not in the client's approved plan: ${name}`,
        context: { intervention: name, kind: 'unapproved', approved: s.approvedInterventions },
      })
    }
    for (const name of s.intervention.skillAsReduction) {
      out.push({
        gate: 'intervention', severity: 'warning',
        detail: `Skill program documented as a reduction intervention: ${name}`,
        context: { intervention: name, kind: 'skill-as-reduction' },
      })
    }
    for (const v of s.functionViolations) {
      out.push({
        gate: 'approved-function', severity: 'warning',
        detail: `"${v.name}" written as ${v.wrote}, not approved for it`,
        context: { behavior: v.name, wrote: v.wrote, approved: v.approved },
      })
    }
    // SUPPRESSED coverage is an untrustworthy reading (segmentation unsound): file NO coverage finding — the
    // caller records a single 'segmentation_unsound' diagnostic instead, so this neither reports a false defect
    // nor duplicates that record. Only judge coverage when it was NOT suppressed.
    if (s.coverage.suppressed) {
      // intentionally nothing
    } else if (s.coverage.segmentable) {
      for (const m of s.coverage.missing) {
        out.push({
          gate: 'coverage', severity: 'warning',
          detail: `ABC for "${m.name}" does not state a documented function`,
          context: { behavior: m.name },
        })
      }
    } else {
      out.push({
        gate: 'coverage', severity: 'info',
        detail: 'Note could not be segmented per ABC to verify function coverage',
      })
    }
    for (const m of s.methodViolations) {
      out.push({
        gate: 'teaching-method', severity: 'warning',
        detail: `Teaching method not approved for this client: ${m}`,
        context: { method: m, approved: s.approvedMethodSet },
      })
    }
  }

  // A behavior the assessment records no function for is a DATA problem — a bad extraction — not a
  // generation case. It is never guessed around; it is surfaced so the assessment gets fixed.
  for (const name of params.behaviorsWithoutFunction ?? []) {
    out.push({
      gate: 'data-integrity', severity: 'warning',
      detail: `"${name}" has no documented function in the assessment — verify the assessment`,
      context: { behavior: name },
    })
  }

  for (const f of params.coherenceFlags ?? []) {
    out.push({ gate: 'coherence', severity: 'info', detail: f })
  }
  for (const f of params.redFlags ?? []) {
    out.push({ gate: 'red-flag', severity: 'info', detail: f })
  }
  for (const t of params.blockedFlagged ?? []) {
    out.push({ gate: 'blocked-term', severity: 'info', detail: `Host-EHR blocked term left in place: ${t}`, context: { term: t } })
  }
  if (params.similarityWarning) {
    out.push({ gate: 'similarity', severity: 'info', detail: 'Note is similar to a recent note for this client' })
  }

  return out
}

// Persist findings. FAIL-SOFT BY CONTRACT: recording is diagnostics, and diagnostics must never cost
// a user their note. Every failure — table not migrated yet, database down, malformed row — is
// swallowed. Nothing in this function may ever propagate to the caller.
export async function recordGateFindings(params: {
  findings: GateFinding[]
  clientId?: string | null
  userId?: string | null
  noteId?: string | null
  // Only 'generate' remains — the refiner is gone. The COLUMN stays permissive text so a future
  // second generation path can record without a migration; the type is narrow so today's callers
  // cannot invent a source value that nothing reads.
  source: 'generate'
  regenCount?: number
}): Promise<void> {
  if (!params.findings.length) return
  try {
    const { prisma } = await import('@/lib/prisma')
    await prisma.gate_findings.createMany({
      data: params.findings.map((f) => ({
        client_id: params.clientId || null,
        user_id: params.userId || null,
        note_id: params.noteId || null,
        source: params.source,
        gate: f.gate,
        severity: f.severity,
        detail: f.detail.slice(0, 500),
        context: (f.context ?? undefined) as never,
        regen_count: typeof params.regenCount === 'number' ? params.regenCount : null,
      })),
    })
  } catch (e) {
    // Deliberately silent for the user; visible to us in the server log.
    console.error('[gate-findings] record failed (note unaffected):', (e as Error)?.message)
  }
}
