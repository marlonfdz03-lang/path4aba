// Combined compliance gate (consolidation). The four note-compliance checks — approved-intervention,
// approved-function (validity), function-coverage (Bug 3), and teaching-method — used to run as four
// sequential gates, each regenerating on its own violation, so a note defective in N ways cost N full LLM
// calls (the 3-4x regeneration RBTs saw). This module consolidates the ORCHESTRATION: run all four checks,
// build ONE combined instruction naming every defect, regenerate ONCE, re-run all four. It is extracted
// pure (no prisma/openai deps) so the "exactly one combined regeneration" contract is unit-testable — the
// caller passes plain detection functions and a regenerate callback; the counter proves the consolidation.
//
// This module owns WHEN a regeneration happens (once, combined) — never WHAT each check requires (the
// detectors and the caller own that) and never the persistence policy (the caller still THROWS on a
// surviving intervention violation and FLAGS the other survivors).

import { functionDisplayLabel } from './functionPatterns.ts';

export interface InterventionViolations {
  prohibited: string[];
  unapproved: string[];
  skillAsReduction: string[];
}

export interface FunctionValidityViolation {
  name: string;
  wrote: string;
  approved: string[];
}

export interface CoverageResult {
  segmentable: boolean;
  missing: { name: string }[];
}

// Everything the combined instruction needs, produced by running the four detectors on one note.
export interface ComplianceState {
  intervention: InterventionViolations;
  functionViolations: FunctionValidityViolation[];
  coverage: CoverageResult;
  methodViolations: string[];
  approvedInterventions: string[];
  approvedMethodSet: string[];
}

// Distinct intervention names across the three prohibition buckets (prohibited / unapproved / skill-as-
// reduction). An intervention survivor named here after the combined regen is a HARD stop for the caller.
export function interventionViolationNames(v: InterventionViolations): string[] {
  return [...new Set([...v.prohibited, ...v.unapproved, ...v.skillAsReduction])];
}

// Build ONE combined regeneration instruction from ONLY the checks that failed, or null when the note is
// clean. Order: function coverage + approved function first (both about the function — name it, and from the
// approved set — so they reinforce rather than conflict), then interventions, then teaching methods. Each
// clause preserves its original gate's instruction language. Nothing here pulls toward less specificity or
// more variety (the uniqueness "vary the phrasing" instruction was removed in Bug 6), so there is no
// Bug-3-style conflict between "name the function" and "vary the wording".
export function buildComplianceRegenInstruction(state: ComplianceState): string | null {
  const parts: string[] = [];

  if (state.coverage.segmentable && state.coverage.missing.length > 0) {
    const missingNames = state.coverage.missing.map((m) => m.name).filter(Boolean).join(', ');
    parts.push(`FUNCTION COVERAGE: these ABCs do not state a documented function in their prose — ${missingNames}. EVERY ABC must NAME its documented function (escape/attention/tangible/automatic-reinforcement) in the prose, before the intervention — RULE A, no exceptions. Do not drop the function name for the sake of variety.`);
  }

  if (state.functionViolations.length > 0) {
    const detail = state.functionViolations
      .map((v) => `${v.name} (written as ${v.wrote}; approved: ${v.approved.map(functionDisplayLabel).join(', ')})`)
      .join('; ');
    parts.push(`APPROVED FUNCTION: the note assigned a behavior a function the assessment did NOT approve for it — ${detail}. For EACH behavior, assign ONLY a function from its approved set, and write an antecedent consistent with that approved function. Never write a function outside a behavior's approved set.`);
  }

  const badInterventions = interventionViolationNames(state.intervention);
  if (badInterventions.length > 0) {
    const roleNote = state.intervention.skillAsReduction.length
      ? ` NOTE: ${state.intervention.skillAsReduction.join(', ')} ${state.intervention.skillAsReduction.length === 1 ? 'is a skill program' : 'are skill programs'}, not an approved reduction intervention — document ${state.intervention.skillAsReduction.length === 1 ? 'it' : 'them'} ONLY as a skill being taught, never as a behavior-reduction intervention.`
      : '';
    const approvedClause = state.approvedInterventions.length
      ? `ONLY these approved interventions: ${state.approvedInterventions.join(', ')}`
      : `ONLY interventions named in the session data's approved list`;
    parts.push(`APPROVED INTERVENTIONS: the note documented ${badInterventions.join(', ')}, which ${badInterventions.length === 1 ? 'is' : 'are'} NOT permitted as documented for this client.${roleNote} An RBT may only document reduction interventions the BCBA has approved. Rewrite the entire note using ${approvedClause}. Never mention response interruption and redirection (RIRD) or any intervention outside the approved list.`);
  }

  if (state.methodViolations.length > 0) {
    const methodClause = state.approvedMethodSet.length
      ? `ONLY teaching methods the plan approves: ${state.approvedMethodSet.join(', ')}`
      : `NO named teaching procedure — describe how the skill was practiced without naming a method`;
    parts.push(`TEACHING METHODS: the note named teaching method(s) the assessment did NOT approve for this client — ${state.methodViolations.join(', ')}. When you describe how a replacement skill was practiced, name ${methodClause}. Never name a teaching procedure outside the approved list.`);
  }

  if (!parts.length) return null;
  return `\n\nCOMPLIANCE — REGENERATE: the previous note has the following issue(s); fix ALL of them in one rewrite:\n- ${parts.join('\n- ')}`;
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
