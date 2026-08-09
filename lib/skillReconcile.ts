// Cross-field skill reconciliation. A skill the assessment's MASTERED section declares mastered is NOT an
// active replacement target — so a mastered name must not also appear in the active replacementBehaviors.
//
// PURE + no imports → client-safe (used by the client page for display dedup) AND unit-testable with Node's
// built-in runner. Keys ONLY on the mastered NAMES (from the geometry MASTERED section) — no skill-name
// hardcode, no client-specific rule, no tuned threshold. See lib/assembleRefreshProfile.ts (Layer 1) and
// app/clients/[id]/page.tsx (Layer 2).

const norm = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const tokenSet = (s: string) => new Set(norm(s).split(" ").filter(Boolean));

/**
 * True when one name's token set is a subset of the other's — i.e. they are the same skill and one is just a
 * longer-worded variant. "Share a toy" ⊆ "Share a preferred toy" → true (near-dup caught). "Share a toy" vs
 * "Share a book" → false (the distinguishing token differs). Structural — no threshold, no magic number.
 */
export function tokenSubsetMatch(a: string, b: string): boolean {
  const A = tokenSet(a), B = tokenSet(b);
  if (!A.size || !B.size) return false;
  const [small, big] = A.size <= B.size ? [A, B] : [B, A];
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

/**
 * Remove from `active` every entry whose name token-subset-matches a mastered name, returning only the
 * genuinely-active programs. Non-destructive: the mastered skills are not dropped — they live in the mastered
 * field. If there is no mastered set (no authoritative MASTERED section), `active` is returned unchanged.
 */
export function subtractMasteredFromActive<T extends { name?: string } | string>(
  active: T[] | undefined | null,
  masteredNames: string[] | undefined | null,
): T[] {
  const list = Array.isArray(active) ? active : [];
  const mastered = (Array.isArray(masteredNames) ? masteredNames : []).filter(Boolean);
  if (!mastered.length) return list;
  const nameOf = (x: T): string => (typeof x === "string" ? x : String(x?.name || ""));
  return list.filter((item) => {
    const n = nameOf(item);
    return !mastered.some((m) => tokenSubsetMatch(n, m));
  });
}
