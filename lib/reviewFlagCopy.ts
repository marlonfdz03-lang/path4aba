// Human-facing copy for clinical_profile.reviewFlags — the "Needs review" banner on the client page.
//
// PURE + no imports so it is safe in the client bundle AND unit-testable with Node's built-in runner.
// Maps a guard flag ({ field, reason, source }) to plain-language text an RBT reads. The raw `reason`
// is engineer jargon ("geometry", "LLM fallback", "confidence LOW") and is DELIBERATELY IGNORED — the
// copy is keyed on `field` (+ `source` to split the two `behaviors` cases) only. The four shapes the
// guard emits are defined in lib/assembleRefreshProfile.ts (assembleCommit1 + assembleRefreshProfile):
//   guard-preserved · behaviors        (LOW/UNREAD refresh: existing behaviors kept)
//   llm-fallback    · diagnosis         (no structured confirmed-diagnosis table)
//   llm-fallback    · skillAcquisition  (no structured MASTERED section)
//   llm-fallback    · behaviors         (create path, no existing to preserve)
//   behavior-review · behavior:<name>   (a single behavior whose name/function wasn't structural)

export type ReviewFlagSource = "llm-fallback" | "guard-preserved" | "behavior-review" | "target-undefined" | "behavior-incomplete" | "intervention-section-unread" | "human-edit-dropped" | "human-edit-superseded";
export interface ReviewFlagLike { field: string; reason?: string; source: ReviewFlagSource }

const BEHAVIOR_PREFIX = "behavior:";
const TARGET_PREFIX = "target:";

/** Plain-language, non-technical, actionable line for one flag. Never renders the raw `reason`. */
export function flagCopy(flag: ReviewFlagLike): string {
  const field = String(flag?.field || "");

  // Per-behavior flag: field is "behavior:<name>" — strip the prefix and show just the name. Two sources
  // share this prefix, split here: 'behavior-incomplete' means the behavior WAS applied to the profile but
  // is missing its operational definition and/or documented function, so it can't be used in a note yet;
  // 'behavior-review' means the read itself is uncertain.
  if (field.startsWith(BEHAVIOR_PREFIX)) {
    const name = field.slice(BEHAVIOR_PREFIX.length).trim();
    if (flag?.source === "behavior-incomplete") {
      return `${name} was added to the profile but is missing its operational definition and/or documented function — it can't be used in a note until your BCBA completes it.`;
    }
    if (flag?.source === "human-edit-dropped") {
      return `A manual correction you made to ${name} couldn't be carried into the refreshed assessment — the behavior was renamed or removed. Re-enter it if it still applies.`;
    }
    if (flag?.source === "human-edit-superseded") {
      return `Your manual entry for ${name} was replaced by the value now documented in the updated assessment. Review it to confirm the documented version is correct.`;
    }
    return `One behavior may not have been read correctly — please verify: ${name}.`;
  }

  // Named-but-undefined target: field is "target:<name>" — listed in the plan's target list but with no
  // operational definition/baseline in the assessment, so it was not added.
  if (field.startsWith(TARGET_PREFIX)) {
    const name = field.slice(TARGET_PREFIX.length).trim();
    return `${name} is listed as a target behavior but has no operational definition or baseline data — please verify with your BCBA.`;
  }

  if (field === "functions")
    return "Behavior functions were inferred because no functional-assessment (FAST/MAS) section was found in the upload. Please verify each behavior's function with your BCBA.";

  if (field === "replacementBehaviors")
    return flag?.source === "llm-fallback"
      ? "The replacement-program list may be incomplete — the assessment appears to list more programs than could be read automatically. Please verify the replacement programs against the source."
      : "The replacement-program list was kept from the previous assessment because this upload's programs couldn't be read completely. Please review the replacement programs against the source.";

  if (field === "interventions" && flag?.source === "intervention-section-unread")
    return "This client's assessment has a large interventions section that couldn't be read directly — the intervention list was compiled from the whole document (the fallback method). Please verify it against the assessment.";

  if (field === "interventions")
    return flag?.source === "llm-fallback"
      ? "The interventions list may be incomplete — the assessment appears to list more interventions than could be read automatically. Please verify the interventions against the source."
      : "The interventions list was kept from the previous assessment because this upload's interventions couldn't be read completely. Please review the interventions against the source.";

  if (field === "reinforcers")
    return "The reinforcer list may be incomplete — it dropped noticeably from the previous assessment and no structured preference table could be read. Please verify the reinforcers against the source.";

  if (field === "diagnosis")
    return "The diagnosis was read from the report text, not a structured table. Please verify the diagnosis is correct.";

  if (field === "skillAcquisition")
    return "Mastered skills were read from the report text, not a structured list. Please verify the skills are correct.";

  if (field === "behaviors")
    return flag?.source === "guard-preserved"
      ? "Behaviors were kept from the PREVIOUS assessment because this upload's layout couldn't be read automatically. This list may be out of date — re-upload a structured assessment or enter the behaviors manually."
      : "The behavior list was extracted using AI fallback because the assessment layout couldn't be verified automatically. Review the behavior list before using it for clinical documentation.";

  // Defensive fallback for any future field we haven't mapped — still actionable, still no jargon.
  return "One item in this profile needs review — please verify it against the source assessment.";
}

/** Dedupe identical lines (stable order) so the banner never repeats a sentence. */
export function reviewBannerLines(flags: ReviewFlagLike[] | undefined | null): string[] {
  if (!Array.isArray(flags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of flags) {
    const line = flagCopy(f);
    if (!seen.has(line)) { seen.add(line); out.push(line); }
  }
  return out;
}
