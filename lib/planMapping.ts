// PURE billing helpers — ZERO imports, so the branching + fail-closed logic is unit-testable in bare node
// (subscriptionState.ts and the webhook import @/lib/prisma and the Stripe SDK and can't be loaded there).

export function mapStripeStatus(status: string): 'active' | 'trialing' | 'canceled' | 'expired' {
  if (status === 'active') return 'active'
  if (status === 'trialing') return 'trialing'
  if (status === 'canceled' || status === 'incomplete_expired') return 'canceled'
  return 'expired'
}

// priceId -> plan-key lookup built from the app's price tables. The students prices collapse to
// 'bcba_students' (their plan concept, distinct from the primary RBT/BCBA plans).
export function buildPriceToPlan(
  prices: Record<string, { month?: string; year?: string }>,
  studentsPrices: Record<string, { month?: string; year?: string }>,
): Map<string, string> {
  const m = new Map<string, string>()
  for (const [plan, ivals] of Object.entries(prices || {})) {
    if (ivals?.month) m.set(ivals.month, plan)
    if (ivals?.year) m.set(ivals.year, plan)
  }
  for (const ivals of Object.values(studentsPrices || {})) {
    if (ivals?.month) m.set(ivals.month, 'bcba_students')
    if (ivals?.year) m.set(ivals.year, 'bcba_students')
  }
  return m
}

export function planFromPriceId(priceId: string | null | undefined, priceToPlan: Map<string, string>): string | null {
  if (!priceId) return null
  return priceToPlan.get(priceId) ?? null
}

// Direction from tier; when tiers are EQUAL (an interval switch, e.g. monthly->yearly) fall back to amount.
// Equal tier AND equal amount => 'unchanged'.
export function planDirection(oldTier: number, newTier: number, oldAmount = 0, newAmount = 0): 'upgrade' | 'downgrade' | 'unchanged' {
  if (oldTier !== newTier) return newTier > oldTier ? 'upgrade' : 'downgrade'
  if (newAmount > oldAmount) return 'upgrade'
  if (newAmount < oldAmount) return 'downgrade'
  return 'unchanged'
}

export type SubState =
  | { state: 'none' }
  | { state: 'lapsed' }
  | { state: 'live'; liveSub: any; itemId: string }
  | { state: 'unavailable'; error?: string }

// Classify a customer's subscription list relative to the price set of the product being bought.
// live  = a subscription in the set with a live status (active/trialing/past_due).
// lapsed = a subscription in the set exists but none is live (they already had one -> no new trial).
// none   = no subscription in the set at all.
export function classifySubscriptions(subs: any[], hasMore: boolean, relevantPriceIds: Set<string>): SubState {
  const LIVE = new Set(['active', 'trialing', 'past_due'])
  let sawAny = false
  for (const sub of subs || []) {
    const item = (sub?.items?.data || []).find((i: any) => relevantPriceIds.has(i?.price?.id))
    if (!item) continue
    sawAny = true
    if (LIVE.has(sub.status)) return { state: 'live', liveSub: sub, itemId: item.id }
  }
  if (sawAny) return { state: 'lapsed' }
  // Not found in this page: has_more means we can't rule out history -> never grant a trial -> treat as lapsed.
  return hasMore ? { state: 'lapsed' } : { state: 'none' }
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    p.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}

// Pure, injectable resolver core. FAIL CLOSED: any throw OR timeout -> { state: 'unavailable' }, NEVER
// 'none' (which would let the caller mint a subscription+trial — the bug this whole change exists to kill).
export async function resolveStateFromLister(
  lister: () => Promise<{ data: any[]; has_more: boolean }>,
  relevantPriceIds: Set<string>,
  timeoutMs: number,
): Promise<SubState> {
  let page: { data: any[]; has_more: boolean }
  try {
    page = await withTimeout(lister(), timeoutMs)
  } catch (e: any) {
    return { state: 'unavailable', error: e?.message || String(e) }
  }
  return classifySubscriptions(page?.data || [], !!page?.has_more, relevantPriceIds)
}
