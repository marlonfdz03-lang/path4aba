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

export type ReviewFlagSource = "llm-fallback" | "guard-preserved" | "behavior-review";
export interface ReviewFlagLike { field: string; reason?: string; source: ReviewFlagSource }

const BEHAVIOR_PREFIX = "behavior:";

/** Plain-language, non-technical, actionable line for one flag. Never renders the raw `reason`. */
export function flagCopy(flag: ReviewFlagLike): string {
  const field = String(flag?.field || "");

  // Per-behavior flag: field is "behavior:<name>" — strip the prefix and show just the name.
  if (field.startsWith(BEHAVIOR_PREFIX)) {
    const name = field.slice(BEHAVIOR_PREFIX.length).trim();
    return `One behavior may not have been read correctly — please verify: ${name}.`;
  }

  if (field === "diagnosis")
    return "The diagnosis was read from the report text, not a structured table. Please verify the diagnosis is correct.";

  if (field === "skillAcquisition")
    return "Mastered skills were read from the report text, not a structured list. Please verify the skills are correct.";

  if (field === "behaviors")
    return flag?.source === "guard-preserved"
      ? "Behaviors were kept from the previous assessment because this upload couldn't be read clearly. Please review the behavior list to confirm it's current."
      : "Behaviors were read from the report text, not a structured table. Please verify the behavior list is correct.";

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
