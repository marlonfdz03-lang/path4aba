/**
 * Pure, bare-node-testable core of the subscription reconcile job.
 *
 * The job (app/api/cron/reconcile-subscriptions) is the safety net beneath the webhook: it pulls each of our
 * subscription rows from Stripe and corrects any column that drifted (a webhook that was missed, retried out,
 * or — the reason this whole effort exists — silently mis-read a relocated field). This module holds the two
 * decisions that must be provably correct: what a row's corrections are, and when to ABORT the whole run.
 *
 * Every field is read through the version-robust helpers (subCurrentPeriodEnd / epochToDate / mapStripeStatus
 * / planFromPriceId), never a raw payload access — the reconcile must not reintroduce the field-location bug.
 * A correction is emitted ONLY when the resolved value is non-null AND differs from the DB, so an equal or
 * unresolved field produces no write.
 */

import { subCurrentPeriodEnd, epochToDate } from './stripeEventFields.ts'
import { mapStripeStatus, planFromPriceId } from './planMapping.ts'

export type Drift = { column: string; oldValue: string | null; newValue: string | null }
// data: the typed values handed to prisma.update (Date for date columns, string for status/plan).
// drifts: the same corrections rendered as strings for the reconcile_drift alert + the dry-run report.
export type RowPlan = { data: Record<string, any>; drifts: Drift[] }

type DbRow = {
  plan?: string | null
  status?: string | null
  current_period_ends_at?: Date | null
  trial_ends_at?: Date | null
  bcba_students_status?: string | null
  bcba_students_trial_ends_at?: Date | null
}

// RETRY-STATE POLICY (reconcile-local — mapStripeStatus is deliberately NOT changed; the webhook keeps its own
// semantics). Stripe's past_due / unpaid are a RETRY window, not a cancellation: Stripe keeps charging for days
// and the dunning email already fired. mapStripeStatus folds them into 'expired', which the access gate denies
// with NO grace — so a reconcile that merely corrects a stale date would become the thing that REMOVES a
// customer's access mid-retry. That must never happen. Our schema has no 'past_due' state, so we deliberately
// map the retry states to 'canceled' instead: paired with the customer's REAL period end (corrected in the same
// pass), the gate's canceled-grace branch grants access through the date they actually paid for. This is looser
// than Stripe's own label, on purpose. When Stripe finally gives up, subscription.deleted closes it correctly —
// the path already fixed. (Applies to the PRIMARY subscription only; bcba_students has no period column and thus
// no grace branch to preserve — see reconcileBcba.)
const RETRY_STATES = new Set(['past_due', 'unpaid'])

const isoDay = (d: Date | null | undefined): string | null =>
  d ? d.toISOString().slice(0, 10) : null

// Compare date columns at DAY granularity (UTC calendar day), not to the millisecond. Stripe timestamps and
// our stored ones routinely differ by seconds within the same day (e.g. trial_end); a to-the-ms comparison
// reported "drift" every run where nothing meaningful changed, writing a phantom correction and firing an
// alert that trains us to ignore it. A drift is a change of calendar day (or a null being filled).
const dateDiffers = (resolved: Date, current: Date | null | undefined): boolean =>
  current == null || isoDay(resolved) !== isoDay(current)

/**
 * Corrections for a row's PRIMARY subscription: status, current_period_ends_at, plan, trial_ends_at. plan is
 * corrected only when the price resolves to a known primary plan (an unknown/students price leaves it alone);
 * trial_ends_at only while trialing — both mirroring the webhook so the two writers never disagree.
 */
export function reconcilePrimary(row: DbRow, sub: any, priceToPlan: Map<string, string>): RowPlan {
  const data: Record<string, any> = {}
  const drifts: Drift[] = []
  const push = (column: string, writeValue: any, oldStr: string | null, newStr: string | null) => {
    data[column] = writeValue
    drifts.push({ column, oldValue: oldStr, newValue: newStr })
  }

  // Retry states -> 'canceled' (grace via the real period end); everything else via mapStripeStatus. See the
  // RETRY_STATES comment above for why the reconcile must never write an access-removing 'expired' here.
  const newStatus = RETRY_STATES.has(sub.status) ? 'canceled' : mapStripeStatus(sub.status)
  if (newStatus !== (row.status ?? null)) push('status', newStatus, row.status ?? null, newStatus)

  const period = epochToDate(subCurrentPeriodEnd(sub))
  if (period && dateDiffers(period, row.current_period_ends_at)) {
    push('current_period_ends_at', period, isoDay(row.current_period_ends_at), isoDay(period))
  }

  const newPlan = planFromPriceId(sub?.items?.data?.[0]?.price?.id, priceToPlan)
  if (newPlan && newPlan !== 'bcba_students' && newPlan !== (row.plan ?? null)) {
    push('plan', newPlan, row.plan ?? null, newPlan)
  }

  if (sub.status === 'trialing') {
    const trial = epochToDate(sub.trial_end)
    if (trial && dateDiffers(trial, row.trial_ends_at)) {
      push('trial_ends_at', trial, isoDay(row.trial_ends_at), isoDay(trial))
    }
  }

  return { data, drifts }
}

/**
 * Corrections for a row's bcba_students subscription (its own Stripe object): status + trial only — that side
 * of the schema has no period or plan column.
 */
export function reconcileBcba(row: DbRow, sub: any): RowPlan {
  const data: Record<string, any> = {}
  const drifts: Drift[] = []
  const push = (column: string, writeValue: any, oldStr: string | null, newStr: string | null) => {
    data[column] = writeValue
    drifts.push({ column, oldValue: oldStr, newValue: newStr })
  }

  // Uses mapStripeStatus directly — NOT the retry-state policy. bcba_students has no period column, so the gate
  // has no canceled-grace branch (access = active | trialing only); remapping past_due here would only mislabel
  // without preserving any access. So a bcba retry state becomes 'expired' (denied), same as any non-active.
  const newStatus = mapStripeStatus(sub.status)
  if (newStatus !== (row.bcba_students_status ?? null)) {
    push('bcba_students_status', newStatus, row.bcba_students_status ?? null, newStatus)
  }

  if (sub.status === 'trialing') {
    const trial = epochToDate(sub.trial_end)
    if (trial && dateDiffers(trial, row.bcba_students_trial_ends_at)) {
      push('bcba_students_trial_ends_at', trial, isoDay(row.bcba_students_trial_ends_at), isoDay(trial))
    }
  }

  return { data, drifts }
}

// ── Circuit breaker ───────────────────────────────────────────────────────────
// If a large fraction of our rows point at a Stripe subscription that 404s, the run is MISCONFIGURED (wrong
// key, wrong mode, wrong account) — NOT "every customer churned". We proved this the hard way: a test-mode key
// makes every live subscription look resource_missing. Aborting prevents both orphan-alert floods and, above
// all, any future auto-cancel path from wiping the whole customer base on a mode slip. Below the threshold, an
// individual 404 is a real orphan and is handled per-row. MIN_ROWS keeps a tiny sample from tripping it.
export const ABORT_MIN_ROWS = 4
export const ABORT_MISSING_FRACTION = 0.25

export function shouldAbort(checked: number, missing: number): boolean {
  return checked >= ABORT_MIN_ROWS && missing / checked > ABORT_MISSING_FRACTION
}

// ── dryRun parsing ──────────────────────────────────────────────────────────
// A dry-run flag that SILENTLY falls through to writing is the most dangerous possible default — it is exactly
// how ?dryRun=1 wrote to production. So the contract is deliberate and fail-safe:
//   - param ABSENT              -> 'write'  (the cron's normal mode; it passes no query string)
//   - '1' | 'true' | 'yes' | '' -> 'dryrun' ('' is bare presence, e.g. ?dryRun; case/space-insensitive)
//   - param PRESENT, anything else -> 'abort'  (an unrecognized dryRun value must NEVER mean "write")
// The only path that writes is the total absence of the param. Any present-but-unparseable value stops the run.
export type DryRunMode = 'write' | 'dryrun' | 'abort'

export function parseDryRun(hasParam: boolean, rawValue: string | null): DryRunMode {
  if (!hasParam) return 'write'
  const v = (rawValue ?? '').trim().toLowerCase()
  if (v === '1' || v === 'true' || v === 'yes' || v === '') return 'dryrun'
  return 'abort'
}
