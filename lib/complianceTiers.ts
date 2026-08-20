// THE COMPLIANCE CONTROLLER (Commit 5). The RBT's compliance selection (typical / below_typical / poor) is
// turned, IN CODE, into a deterministic outcome TIER per ABC and per skill — handed to GPT as a fixed
// assignment (like preselection). Today complianceLevel produced prose guidance only; now it parameterises
// generation.
//
// MARLON'S CRITICAL RULE, guaranteed by the assignment (not requested of GPT): below typical / poor must NOT
// make every intervention and every skill fail. The majority may reflect greater difficulty, but SOME
// responses stay favorable. Because the distribution is computed here, it is a PROPERTY of the system.

export type OutcomeTier = 'FAVORABLE' | 'PARTIAL' | 'DIFFICULT';

// Each tier maps to a support-level (promptKey) and observable-response (responseKey) vocabulary subset. The
// preselector rotates LRU WITHIN the subset, so prompt/support level and response read consistently with the
// tier. These are the locked sets for those axes once a tier is assigned.
export const TIER_PROMPTS: Record<OutcomeTier, string[]> = {
  FAVORABLE: ['independent', 'gestural', 'verbal'],
  PARTIAL: ['verbal', 'model'],
  DIFFICULT: ['model', 'partial-physical', 'full-physical'],
};
export const TIER_RESPONSES: Record<OutcomeTier, string[]> = {
  FAVORABLE: ['success', 'partial-success'],
  PARTIAL: ['partial-success', 'variable'],
  DIFFICULT: ['variable', 'required-support'],
};

// Assign an outcome tier to each of `n` ABCs (or skills), deterministically, honouring the level's rules.
// The guarantees hold for n >= 2 (realistic multi-item notes); n === 1 uses a documented single value that
// never over- or under-claims (a lone item in a hard session reads PARTIAL — not fully failed, not favorable).
export function assignTiers(level: string | undefined, n: number): OutcomeTier[] {
  if (n <= 0) return [];

  if (n === 1) {
    if (level === 'poor' || level === 'below_typical') return ['PARTIAL'];
    return ['FAVORABLE'];
  }

  const tiers: OutcomeTier[] = new Array(n);

  if (level === 'poor') {
    // index 0 FAVORABLE (never all-failed); the rest DIFFICULT with PARTIAL sprinkled for variety.
    for (let i = 0; i < n; i++) tiers[i] = 'DIFFICULT';
    tiers[0] = 'FAVORABLE';
    for (let i = 2; i < n; i += 2) tiers[i] = 'PARTIAL';
    return tiers;
  }

  if (level === 'below_typical') {
    // majority PARTIAL, one FAVORABLE, at most one DIFFICULT (only for larger notes so PARTIAL stays majority).
    for (let i = 0; i < n; i++) tiers[i] = 'PARTIAL';
    tiers[0] = 'FAVORABLE';
    if (n >= 5) tiers[n - 1] = 'DIFFICULT';
    return tiers;
  }

  // typical (or undefined): majority FAVORABLE, at least one PARTIAL, never all-perfect.
  for (let i = 0; i < n; i++) tiers[i] = 'FAVORABLE';
  tiers[n - 1] = 'PARTIAL';
  if (n >= 4) tiers[1] = 'PARTIAL';
  return tiers;
}

// Count helper for tests/consumers.
export function tierCounts(tiers: OutcomeTier[]): Record<OutcomeTier, number> {
  const c: Record<OutcomeTier, number> = { FAVORABLE: 0, PARTIAL: 0, DIFFICULT: 0 };
  for (const t of tiers) c[t] += 1;
  return c;
}
