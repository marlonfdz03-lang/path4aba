// Combined compliance gate (consolidation). Two whole-note compliance checks — approved-intervention and
// teaching-method — drive this gate: build ONE combined instruction naming every defect, regenerate ONCE,
// re-run both. It is extracted pure (no prisma/openai deps) so the "exactly one combined regeneration"
// contract is unit-testable — the caller passes plain detection functions and a regenerate callback; the
// counter proves the consolidation.
//
// HISTORY: two further checks — approved-function (validity) and function-coverage (Bug 3) — used to drive
// this gate too. Both were REMOVED on 2026-09-06 because they read a per-behavior segmentation that
// misattributes ABC boundaries and therefore fired on CORRECT notes (full evidence in the header of
// buildComplianceRegenInstruction). Do not reinstate them. Function drift is now MONITORED post-gate by
// function_tag (a signal, not a repair).
//
// This module owns WHEN a regeneration happens (once, combined) — never WHAT each check requires (the
// detectors and the caller own that) and never the persistence policy (the caller still THROWS on a
// surviving intervention violation and FLAGS the other survivors).


export interface InterventionViolations {
  prohibited: string[];
  unapproved: string[];
  skillAsReduction: string[];
}

// What the combined instruction needs. ONLY the WHOLE-NOTE checks — intervention and teaching-method — drive
// the gate. The approved-function (validity) and function-coverage checks were REMOVED on 2026-09-06 (the
// per-behavior segmenter misattributes ABC boundaries; see buildComplianceRegenInstruction's header). Their
// state fields (functionViolations, coverage) and their result types (FunctionValidityViolation, CoverageResult)
// are DELETED, not deprecated — a caller that still passes them must fail to compile rather than receive a
// reassuring zero that the metric would read as "no defects".
export interface ComplianceState {
  intervention: InterventionViolations;
  methodViolations: string[];
  approvedInterventions: string[];
  approvedMethodSet: string[];
}

// Distinct intervention names across the three prohibition buckets (prohibited / unapproved / skill-as-
// reduction). An intervention survivor named here after the combined regen is a HARD stop for the caller.
export function interventionViolationNames(v: InterventionViolations): string[] {
  return [...new Set([...v.prohibited, ...v.unapproved, ...v.skillAsReduction])];
}

// What survived the combined gate, summarized for the note-outcome record (admin_alerts
// 'note.generated'). Pure, and it lives here rather than at the emit site because `clean` IS the
// pass-rate metric — if its definition drifts, every number computed from the feed drifts silently
// with it. Pinned by tests in complianceGate.test.mjs.
//
// This carries ONLY the survivors of the two whole-note checks. The approvedFunction / coverageMissing /
// unsegmentable / coverageSuppressed fields were DELETED on 2026-09-06 along with their checks — they are not
// zeroed, because a hardcoded empty/false/null is a "no check ran" masquerading as "no defect", and this is the
// exact object gateClean is computed from. Function drift is now recorded post-gate via function_tag, not here.
export interface SurvivingViolations {
  prohibited: string[]
  unapproved: string[]
  skillAsReduction: string[]
  teachingMethod: string[]
}

export function summarizeSurvivingViolations(
  state: ComplianceState,
): { clean: boolean; violations: SurvivingViolations } {
  const violations: SurvivingViolations = {
    prohibited: state.intervention.prohibited,
    unapproved: state.intervention.unapproved,
    skillAsReduction: state.intervention.skillAsReduction,
    teachingMethod: state.methodViolations,
  }
  // gateClean METRIC — MEANING CHANGED 2026-09-06, NOT COMPARABLE ACROSS THAT DATE. Before, `clean` also
  // required approved-function + function-coverage to pass; both were removed (segmenter misattributes ABC
  // boundaries — see buildComplianceRegenInstruction), so `clean` now means ONLY "no intervention and no
  // teaching-method violation survived". A note that would have been marked NOT clean by those two checks is
  // now counted clean. Any pass-rate trend that straddles 2026-09-06 is measuring two different definitions —
  // segment the series at that date. This is a genuine loosening of the metric, not a bug: the removed checks
  // produced false negatives on correct notes, so their contribution to `clean` was itself untrustworthy.
  const clean =
    !violations.prohibited.length &&
    !violations.unapproved.length &&
    !violations.skillAsReduction.length &&
    !violations.teachingMethod.length
  return { clean, violations }
}

// Build ONE combined regeneration instruction from ONLY the checks that failed, or null when the note is
// clean. Order: interventions, then teaching methods. Each clause preserves its original gate's instruction
// language. Nothing here pulls toward less specificity or more variety (the uniqueness "vary the phrasing"
// instruction was removed in Bug 6).
//
// COVERAGE + APPROVED-FUNCTION WERE REMOVED FROM THE REPAIR (2026-09-06). Do NOT reinstate them thinking the
// segmenter was fixed. Both read a per-behavior split (segmentNoteByBehavior) that misattributes ABC BOUNDARIES,
// so they fired on CORRECT notes. Evidence (probe, worst-case client, N=6): the repair fired on all 6 runs; on
// the runs judged SOUND by the length thresholds (segments min 189–234 chars vs the SPARSE floor of 120, and
// max segment 0.14–0.22 of the note vs the DEGENERATE cut-off of 0.90 — i.e. comfortably inside, not borderline)
// EVERY flagged behavior's function was actually PRESENT but mis-bounded (its function sentence fell in the
// neighbor's segment, or the segment pointed at unrelated skill prose), and EVERY validity "violation" was
// clinically impossible and contradicted by the post-gate function_tag read — e.g. "Physical Aggression wrote=
// automatic" (aggression is never automatic; the word came from Mouthing's sentence bleeding into the segment).
// Length thresholds cannot catch this: the failure is BOUNDARY MISATTRIBUTION, not segment length, so no
// DEGENERATE/SPARSE tuning detects it. Function drift is now MONITORED post-gate by function_tag (per-behavior
// model read, segmentation-free) — a signal, not a repair. Only the WHOLE-NOTE checks below drive the gate.
export function buildComplianceRegenInstruction(state: ComplianceState): string | null {
  const parts: string[] = [];

  const badInterventions = interventionViolationNames(state.intervention);
  if (badInterventions.length > 0) {
    const roleNote = state.intervention.skillAsReduction.length
      ? ` NOTE: ${state.intervention.skillAsReduction.join(', ')} ${state.intervention.skillAsReduction.length === 1 ? 'is a skill program' : 'are skill programs'}, not an approved reduction intervention — document ${state.intervention.skillAsReduction.length === 1 ? 'it' : 'them'} ONLY as a skill being taught, never as a behavior-reduction intervention.`
      : '';
    const approvedClause = state.approvedInterventions.length
      ? `ONLY these approved interventions: ${state.approvedInterventions.join(', ')}`
      : `ONLY interventions named in the session data's approved list`;
    parts.push(`APPROVED INTERVENTIONS: the note documented ${badInterventions.join(', ')}, which ${badInterventions.length === 1 ? 'is' : 'are'} NOT permitted as documented for this client.${roleNote} An RBT may only document reduction interventions the BCBA has approved. In the text you produce, document ${approvedClause}. Never mention response interruption and redirection (RIRD) or any intervention outside the approved list.`);
  }

  if (state.methodViolations.length > 0) {
    const methodClause = state.approvedMethodSet.length
      ? `ONLY teaching methods the plan approves: ${state.approvedMethodSet.join(', ')}`
      : `NO named teaching procedure — describe how the skill was practiced without naming a method`;
    parts.push(`TEACHING METHODS: the note named teaching method(s) the assessment did NOT approve for this client — ${state.methodViolations.join(', ')}. When you describe how a replacement skill was practiced, name ${methodClause}. Never name a teaching procedure outside the approved list.`);
  }

  if (!parts.length) return null;
  return `\n\nCOMPLIANCE — the text you are producing has the following issue(s); fix ALL of them:\n- ${parts.join('\n- ')}`;
}

// Run the combined gate: detect on the initial note; if ANY check fails, emit ONE regen and rewrite ONCE
// with the combined instruction, then re-detect on the rewritten note. `regenCount` is 0 (clean) or 1
// (defective) — never more, which is exactly the consolidation guarantee. The caller owns the outcome of
// the FINAL state: THROW on a surviving intervention violation, FLAG the other survivors.
export async function runCombinedComplianceGate(params: {
  initialNote: string;
  detect: (note: string) => ComplianceState;
  regenerate: (instruction: string) => Promise<string>;
  onRegen?: () => void;
}): Promise<{ note: string; state: ComplianceState; regenCount: 0 | 1 }> {
  let note = params.initialNote;
  let state = params.detect(note);

  const instruction = buildComplianceRegenInstruction(state);
  if (instruction === null) {
    return { note, state, regenCount: 0 };
  }

  params.onRegen?.();
  note = await params.regenerate(instruction);
  state = params.detect(note);
  return { note, state, regenCount: 1 };
}
