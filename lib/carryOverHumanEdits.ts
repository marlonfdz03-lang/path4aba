// Preserve a client's HUMAN EDITS across an assessment refresh.
//
// The refresh replaces maladaptiveBehaviors WHOLESALE (buildRefreshedProfile), so a behavior's human-edited
// fields — corrected functions today, a manually-entered topography once we add that editor — are otherwise
// wiped on the next upload. This runs AFTER buildRefreshedProfile: it matches each pre-refresh behavior that
// carries a human edit to its counterpart in the NEW set BY NAME (via the shared resolveOption — normalized-
// exact wins, lone strict match wins, ambiguous REFUSES) and re-applies the edit with its source/editedBy/
// editedAt intact — UNLESS the new assessment now provides a genuinely DOCUMENTED value for that field, in
// which case the document wins (the manual value is superseded).
//
// Two things are never silent: a human edit whose behavior was removed/renamed-beyond-match or matched
// ambiguously is flagged 'human-edit-dropped' (not applied anywhere, never misattached); a supersede is
// flagged 'human-edit-superseded' (the replaced definition is surfaced, even when the replacement is right).
import { resolveOption } from "./nameMatch.ts";
import type { ReviewFlag } from "./assembleRefreshProfile.ts";

// A human-edited field descriptor. `documented(newBeh)` is true when the NEW read carries a genuinely sourced
// value for this field (so the document wins). Functions: a real functional assessment (FAST/MAS) was read.
// Topography: the new read actually defined it (non-empty). An INFERRED function or an EMPTY topography is NOT
// documented — a human correction of an inference must not be undone by re-running the same inference.
type FieldDescriptor = {
  value: string;
  source: string;
  editedBy: string;
  editedAt: string;
  documented: (newBeh: any) => boolean;
};

const HUMAN_EDITED_FIELDS: FieldDescriptor[] = [
  {
    value: "functions", source: "functionsSource", editedBy: "functionsEditedBy", editedAt: "functionsEditedAt",
    documented: (nb) => nb?.functionsEvidence === "documented-functional-assessment",
  },
  {
    value: "topographies", source: "topographySource", editedBy: "topographyEditedBy", editedAt: "topographyEditedAt",
    documented: (nb) => Array.isArray(nb?.topographies) && nb.topographies.filter(Boolean).length > 0,
  },
];

const nameOf = (b: any): string => String((typeof b === "string" ? b : b?.name) || "");

export function carryOverHumanEdits(
  refreshedProfile: Record<string, any>,
  existingProfile: Record<string, any> | null | undefined,
): { profile: Record<string, any>; flags: ReviewFlag[] } {
  const flags: ReviewFlag[] = [];
  const prevBehaviors: any[] = Array.isArray(existingProfile?.maladaptiveBehaviors) ? existingProfile!.maladaptiveBehaviors : [];
  const newBehaviors: any[] = Array.isArray(refreshedProfile?.maladaptiveBehaviors) ? refreshedProfile.maladaptiveBehaviors : [];
  if (!prevBehaviors.length || !newBehaviors.length) return { profile: refreshedProfile, flags };

  // Shallow-copy each new behavior so the result is pure (we never mutate the caller's array in place).
  const next = newBehaviors.map((b) => (b && typeof b === "object" ? { ...b } : b));
  const newNames = next.map(nameOf);

  for (const prev of prevBehaviors) {
    if (!prev || typeof prev !== "object") continue;
    const edited = HUMAN_EDITED_FIELDS.filter((f) => prev[f.source] === "human-edited");
    if (!edited.length) continue;

    const res = resolveOption(nameOf(prev), newNames);
    if (res.status !== "matched") {
      // removed / renamed-beyond-match / ambiguous — never misattach, never silently drop.
      for (const f of edited) {
        flags.push({ field: `behavior:${nameOf(prev)}`, source: "human-edit-dropped", reason: `${f.value} (${res.status})` });
      }
      continue;
    }

    const target = next[newNames.indexOf(res.value)];
    if (!target || typeof target !== "object") continue;

    for (const f of edited) {
      if (f.documented(target)) {
        // The new assessment now documents this field — the document wins, the manual value is superseded.
        flags.push({ field: `behavior:${nameOf(prev)}`, source: "human-edit-superseded", reason: f.value });
        continue;
      }
      // Carry the human edit over, provenance intact.
      target[f.value] = prev[f.value];
      target[f.source] = prev[f.source];
      target[f.editedBy] = prev[f.editedBy];
      target[f.editedAt] = prev[f.editedAt];
    }
  }

  return { profile: { ...refreshedProfile, maladaptiveBehaviors: next }, flags };
}
