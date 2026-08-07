// Pure guard logic for the Update-Assessment full-refresh, extracted from app/api/extract-assessment so
// it can be UNIT-TESTED — this is what turns the route's "correct by reading" into "proven" (see
// assessmentRefresh.test.mjs). No prisma, no pdf2json, no network: both functions are pure data->data.
//
// The two guards these back:
//   GUARD 1 (validateAssessmentProfile): a partial/empty/failed extraction must NEVER wipe a real
//            clinical profile — the route 422s and writes nothing when this returns any problems.
//   GUARD 2 (buildRefreshedProfile): the refresh preserves non-assessment keys, replaces assessment
//            keys wholesale, and snapshots the pre-refresh profile as `previousProfile` for one-level
//            undo (restored by app/api/clients/[id]/profile/restore).

// Minimal structural shapes — we validate PRESENCE, deliberately not correctness (see the residual note
// in the route + the hardening report: a plausible-but-wrong extraction can still pass these checks; the
// restore route is the mitigation).
type BuiltBehavior = { name?: string; status?: string; functions?: string[]; topographies?: string[] };
type BuiltProfile = {
  maladaptiveBehaviors?: BuiltBehavior[];
  masteredBehaviors?: string[];
  interventions?: unknown[];
  reinforcers?: unknown[];
  [k: string]: unknown;
};

// GUARD 1 — required-field validation. Returns a list of human-readable problems; an empty list means
// the extraction is clinically complete enough to apply. A NON-empty list means the route must respond
// 422 and leave the stored profile byte-for-byte unchanged. Presence-only by design.
export function validateAssessmentProfile(
  assessmentProfile: BuiltProfile,
  extracted: { replacementSkills?: unknown[] },
): string[] {
  const problems: string[] = [];
  const behaviors = assessmentProfile.maladaptiveBehaviors ?? [];
  const mastered = assessmentProfile.masteredBehaviors ?? [];
  // EXEMPT mastered/discontinued behaviors from the topography/function requirement: they are not active
  // reduction targets and are captured name-only (empty topography/function), so requiring those fields
  // would 422 the moment the extractor starts capturing the mastered/discontinued section (Commit B).
  const isActiveTarget = (b: BuiltBehavior) => !["mastered", "discontinued"].includes(String(b.status || "").toLowerCase().trim());
  if (behaviors.length === 0 && mastered.length === 0) {
    problems.push("no target behaviors found");
  } else {
    // Name the specific ACTIVE-TARGET behavior(s) missing a function or topography so the user knows what to check.
    const noFunction = behaviors.filter((b) => isActiveTarget(b) && !b.functions?.length).map((b) => b.name || "(unnamed)");
    const noTopography = behaviors.filter((b) => isActiveTarget(b) && !b.topographies?.length).map((b) => b.name || "(unnamed)");
    if (noFunction.length) problems.push(`no function for behavior(s): ${noFunction.join(", ")}`);
    if (noTopography.length) {
      problems.push(`no topography / operational definition for behavior(s): ${noTopography.join(", ")}`);
    }
  }
  if ((assessmentProfile.interventions ?? []).length === 0) problems.push("no interventions found");
  if ((assessmentProfile.reinforcers ?? []).length === 0) problems.push("no reinforcers found");
  // Raw replacementSkills (any status): an all-mastered reassessment is clinically valid, so require
  // only that at least one replacement program EXISTS.
  if (!extracted.replacementSkills?.length) problems.push("no replacement skills / programs found");
  return problems;
}

// GUARD 2 — the refresh merge. PURE (never mutates its inputs). Preserves non-assessment keys
// (observedCatalog / functionsByBehavior, blockedNarrativeTerms, continuityContext, and any future key
// such as functionalAssessment), replaces the assessment-sourced keys wholesale, and snapshots the
// pre-refresh profile as `previousProfile` for one-level undo. The snapshot is a WHOLE-profile copy taken
// AFTER stripping any prior snapshot (so backups never nest/compound) — which is exactly why a future
// `functionalAssessment` grid is included in the undo automatically, never stranded.
export function buildRefreshedProfile(
  existingProfile: Record<string, any> | null | undefined,
  assessmentProfile: Record<string, any>,
): Record<string, any> {
  const existing = existingProfile || {};
  const { previousProfile: _stalePrev, ...existingSansPrev } = existing;
  return {
    ...existingSansPrev, // PRESERVE non-assessment keys
    ...assessmentProfile, // REPLACE assessment-sourced keys wholesale
    previousProfile: existingSansPrev, // one-level undo snapshot (whole profile, sans prior snapshot)
  };
}
