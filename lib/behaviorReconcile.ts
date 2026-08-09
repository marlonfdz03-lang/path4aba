// Reconcile a geometry-read behavior with the LLM-read behavior list — two reads of the SAME behavior — so
// the LLM's clean NAME + operational definition (topography) attach to the geometry behavior, which carries
// the authoritative FUNCTION read. Pure, unit-testable. Keys on token structure and on DISCRIMINATING
// definition tokens — no client/behavior name, no tuned threshold.
//
// FIREWALL: every match requires a UNIQUE candidate, so the wrong topography can never attach; a geometry
// behavior that matches nothing by name AND nothing by definition is left unresolved for the guard (hard-422).
// Never invents a name or a definition — it only connects two reads of the same behavior.

import { tokenSubsetMatch } from "./skillReconcile.ts";

export interface LlmBehaviorLike { name?: string; topographies?: string[]; topography?: string }

const norm = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const contains = (a: string, b: string) => { const x = norm(a), y = norm(b); return !!x && !!y && (x.includes(y) || y.includes(x)); };
// Common English function words (length ≥ 4, so they'd survive the length filter): excluded so a filler word
// that happens to sit in only one topography isn't mistaken for a DISCRIMINATING clinical term. General
// stopword list — no client/behavior term. Clinical filler ("instance", "client", "behavior") needs no
// listing: it appears in many topographies, so it is never discriminating.
const STOPWORDS = new Set([
  "with", "that", "than", "this", "then", "they", "them", "their", "there", "when", "what", "which", "while",
  "from", "into", "onto", "over", "under", "your", "been", "being", "have", "does", "done", "such", "also",
  "only", "other", "some", "more", "most", "very", "much", "many", "each", "both", "upon", "about", "after",
  "before", "during", "until", "unless", "whether", "would", "could", "should", "will", "shall", "must",
  "might", "ends", "without", "within", "these", "those", "here", "were", "will",
]);
const contentTokens = (s: string) => norm(s).split(" ").filter((t) => t.length >= 4 && !STOPWORDS.has(t));
const topoText = (b: LlmBehaviorLike) => [...(b.topographies || []), b.topography || ""].join(" ");

/**
 * FIX 2 — match a geometry behavior NAME to a UNIQUE LLM behavior. Substring containment first, then
 * token-subset (order-independent: "sib self injury" ↔ "self injury behaviors sib"). Returns the sole
 * candidate or null — 0 or ≥2 candidates → null (never guesses which topography to attach).
 */
export function matchByName(geomName: string, llm: LlmBehaviorLike[]): LlmBehaviorLike | null {
  const g = String(geomName || "");
  if (!norm(g) || norm(g) === "unresolved") return null;
  const cands = (llm || []).filter(
    (lb) => contains(String(lb?.name || ""), g) || tokenSubsetMatch(String(lb?.name || ""), g),
  );
  return cands.length === 1 ? cands[0] : null;
}

/**
 * FIX 3a — match an UNNAMED/unmatched geometry block to a UNIQUE LLM behavior by its neighborhood DEFINITION
 * text. A DISCRIMINATING token appears in exactly ONE LLM behavior's topography; common filler ("instance",
 * "client", "behavior") appears in many → not discriminating → ignored. We count, per behavior, how many of
 * the definition's discriminating tokens point to it, and take the DOMINANT behavior — the one whose
 * distinctive vocabulary appears most in this block's text.
 *
 * Over-match safety (firewall): the dominant behavior must (a) carry at least TWO distinctive tokens — a
 * minimal evidence floor so a single incidental word can't match — and (b) STRICTLY beat the runner-up, so a
 * tie for "most distinctive" refuses rather than guesses. This tolerates the real interleaved layouts where a
 * block's definition text is mixed with a shared scoring rubric (which contributes only scattered single
 * tokens), while a genuinely ambiguous or evidence-poor block still attaches nothing → guard hard-422s.
 */
export function matchByDefinition(defText: string, llm: LlmBehaviorLike[]): LlmBehaviorLike | null {
  const behaviors = llm || [];
  if (!defText || behaviors.length === 0) return null;
  const owners = new Map<string, Set<number>>();
  behaviors.forEach((b, i) => {
    for (const t of new Set(contentTokens(topoText(b)))) {
      if (!owners.has(t)) owners.set(t, new Set());
      owners.get(t)!.add(i);
    }
  });
  const counts = new Map<number, number>();
  for (const t of new Set(contentTokens(defText))) {
    const own = owners.get(t);
    if (own && own.size === 1) counts.set([...own][0], (counts.get([...own][0]) || 0) + 1); // discriminating → its sole owner
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;
  const [topIdx, topN] = ranked[0];
  const runnerUp = ranked[1]?.[1] ?? 0;
  return topN >= 2 && topN > runnerUp ? behaviors[topIdx] : null;
}
