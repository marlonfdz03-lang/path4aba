/**
 * Stripe event-field readers — the ONE place billing code extracts fields whose
 * location moved across Stripe API versions.
 *
 * WHY THIS FILE EXISTS
 * In Stripe's 2025-03-31 "Basil" release (our webhook endpoint is on the later
 * 2026-04-22 "dahlia"), two fields our handler relied on were relocated:
 *   - `Subscription.current_period_end`  ->  moved onto EACH subscription item at
 *       `subscription.items.data[i].current_period_end`
 *   - `Invoice.subscription`             ->  removed, now at
 *       `invoice.parent.subscription_details.subscription`
 * Webhook payloads arrive in the ENDPOINT's API version (dahlia), NOT the SDK's
 * pinned version, so the old top-level reads silently yield `undefined`. That is
 * exactly how `current_period_ends_at` froze in production for months: the read
 * produced `undefined`, `new Date(undefined * 1000)` produced an Invalid Date,
 * the write threw, and a swallowing `.catch` still returned 200.
 *
 * THE RULE (applies to ALL billing code, not just this file):
 *   Never write `new Date(x * 1000)`. Route every epoch through `epochToDate()`.
 *   A `null` return from any reader here means the field could not be resolved
 *   from ANY known path — that is a RESOLUTION FAILURE to be surfaced (admin
 *   alert + non-200 so Stripe retries), never a value to write and never a
 *   silent skip.
 *
 * Each reader tries the NEW (dahlia/basil) path first, then falls back to the
 * OLD (pre-Basil) path, so it stays correct whether the payload is a live dahlia
 * event or an older replay.
 */

type AnyObj = Record<string, any> | null | undefined

/**
 * Subscription current-period-end, in epoch SECONDS, or null if unresolvable.
 * Reads the per-item field first (dahlia/basil), falling back to the removed
 * top-level field (pre-Basil). Assumes a single-item subscription (data[0]),
 * which matches our model — every plan we sell is one item per subscription.
 */
export function subCurrentPeriodEnd(sub: AnyObj): number | null {
  const perItem = sub?.items?.data?.[0]?.current_period_end // dahlia / basil
  if (typeof perItem === 'number' && Number.isFinite(perItem)) return perItem
  const topLevel = sub?.current_period_end // pre-Basil
  if (typeof topLevel === 'number' && Number.isFinite(topLevel)) return topLevel
  return null
}

/**
 * The subscription id an invoice belongs to, or null if unresolvable. Reads the
 * nested `parent.subscription_details.subscription` (dahlia/basil) first, then
 * the removed top-level `invoice.subscription` (pre-Basil). Each may be a bare
 * id string or an expanded object — both are handled.
 */
export function invoiceSubscriptionId(inv: AnyObj): string | null {
  const resolved =
    inv?.parent?.subscription_details?.subscription ?? // dahlia / basil
    inv?.subscription // pre-Basil
  if (typeof resolved === 'string') return resolved
  if (resolved && typeof resolved === 'object' && typeof resolved.id === 'string') {
    return resolved.id
  }
  return null
}

/**
 * Epoch SECONDS -> Date, or null. The ONLY sanctioned epoch->Date path in
 * billing code. Returns null for anything that would otherwise yield an Invalid
 * Date (undefined, null, NaN, Infinity, non-numbers) so a missing field can
 * never be written as `new Date(NaN)`.
 */
export function epochToDate(sec: unknown): Date | null {
  return typeof sec === 'number' && Number.isFinite(sec) ? new Date(sec * 1000) : null
}
