import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getStripe, PRICES, BCBA_STUDENTS_PRICES } from '@/lib/stripe'
import { buildPriceToPlan, withTimeout } from '@/lib/planMapping'
import { emitAdminAlert } from '@/lib/adminAlerts'
import { reconcilePrimary, reconcileBcba, shouldAbort, parseDryRun } from '@/lib/reconcileSubscriptions'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PRICE_TO_PLAN = buildPriceToPlan(PRICES as any, BCBA_STUDENTS_PRICES as any)
const RETRIEVE_TIMEOUT_MS = 10000

// The safety net beneath the webhook: pull each of our subscriptions from Stripe and correct any drifted
// column (a missed/retried-out/mis-read webhook). Decision logic + circuit breaker live in the pure,
// unit-tested lib/reconcileSubscriptions.ts; this route is auth + iterate + retrieve + apply + alert.
//
// PER-ROW retrieve today (fine to a few hundred rows). WHOEVER HITS ~300 ROWS: switch to the hybrid —
// stripe.subscriptions.list({ status: 'all', limit: 100 }) auto-paginated (~10 calls / 1000 subs) into a Map
// by sub id, then a targeted retrieve only for our rows ABSENT from the map (to tell canceled from orphan).
// Per-row is O(rows) API calls; the hybrid is O(rows / 100).

type Job = { id: string; user_id: string; sub_id: string; kind: 'primary' | 'bcba'; row: any }

export async function GET(request: Request) {
  // Vercel cron injects Authorization: Bearer <CRON_SECRET>
  const authHeader = request.headers.get('Authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // dryRun preview computes + returns the corrections WITHOUT writing and WITHOUT drift/orphan alerts. Parsing
  // is fail-safe (see parseDryRun): only the TOTAL ABSENCE of the param writes; any present-but-unrecognized
  // value ABORTS rather than silently falling through to a write (the ?dryRun=1 incident).
  const url = new URL(request.url)
  const mode = parseDryRun(url.searchParams.has('dryRun'), url.searchParams.get('dryRun'))
  if (mode === 'abort') {
    return NextResponse.json(
      { aborted: true, reason: 'unrecognized_dryRun_value — use ?dryRun=1|true|yes (or omit to write)' },
      { status: 400 },
    )
  }
  const dryRun = mode === 'dryrun'

  let rows: any[]
  try {
    rows = await prisma.subscriptions.findMany({
      where: {
        OR: [
          { stripe_subscription_id: { not: null } },
          { bcba_students_subscription_id: { not: null } },
        ],
      },
      select: {
        id: true, user_id: true, plan: true, status: true,
        current_period_ends_at: true, trial_ends_at: true, stripe_subscription_id: true,
        bcba_students_status: true, bcba_students_trial_ends_at: true, bcba_students_subscription_id: true,
      },
    })
  } catch (err) {
    console.error('[reconcile] DB read failed:', err)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  // One job per (row, subscription). GUARDRAIL: a null stripe_subscription_id produces no primary job, so that
  // row's primary side is never touched; likewise a null bcba_students_subscription_id. GUARDRAIL: the only DB
  // op below is prisma.subscriptions.update on a row we are already iterating — never a create or delete.
  const jobs: Job[] = []
  for (const row of rows) {
    if (row.stripe_subscription_id) jobs.push({ id: row.id, user_id: row.user_id, sub_id: row.stripe_subscription_id, kind: 'primary', row })
    if (row.bcba_students_subscription_id) jobs.push({ id: row.id, user_id: row.user_id, sub_id: row.bcba_students_subscription_id, kind: 'bcba', row })
  }

  const stripe = getStripe()

  // PASS 1 — retrieve everything BEFORE any write. NEVER write on a partial read: a retrieve that throws is
  // dropped (unreachable) or recorded as an orphan (404); neither writes anything. The circuit breaker runs on
  // the totals below, so a misconfigured run aborts having changed nothing.
  const retrieved: { job: Job; sub: any }[] = []
  const orphans: Job[] = []
  let unreachable = 0
  for (const job of jobs) {
    try {
      const sub = await withTimeout(stripe.subscriptions.retrieve(job.sub_id) as any, RETRIEVE_TIMEOUT_MS)
      retrieved.push({ job, sub })
    } catch (err: any) {
      if (err?.code === 'resource_missing') orphans.push(job)
      else { unreachable++; console.error('[reconcile] retrieve unreachable for a subscription (kept, not written)') }
    }
  }

  // CIRCUIT BREAKER — abort before any write if too large a fraction 404'd (wrong key/mode/account, not mass
  // churn). Prevents orphan-alert floods and, above all, any future auto-cancel path from wiping everyone.
  if (shouldAbort(jobs.length, orphans.length)) {
    await emitAdminAlert({
      source: 'system', type: 'billing.reconcile_aborted', severity: 'critical',
      payload: { checked: jobs.length, missing: orphans.length, reason: 'orphan_rate_exceeded' },
    })
    return NextResponse.json({ aborted: true, checked: jobs.length, missing: orphans.length })
  }

  // PASS 2 — apply (or, in dryRun, only collect). A 404 below the abort threshold is a genuine orphan: alerted,
  // NEVER auto-canceled — a human decides.
  let corrected = 0
  const report: any[] = []
  for (const job of orphans) {
    if (!dryRun) {
      await emitAdminAlert({
        source: 'system', type: 'billing.reconcile_orphan', severity: 'warning', actorUserId: job.user_id,
        payload: { user_id: job.user_id, subscription_id: job.sub_id },
      })
    }
    report.push({ subscription_id: job.sub_id, orphan: true })
  }
  for (const { job, sub } of retrieved) {
    const { data, drifts } = job.kind === 'primary'
      ? reconcilePrimary(job.row, sub, PRICE_TO_PLAN)
      : reconcileBcba(job.row, sub)
    if (!drifts.length) continue

    if (!dryRun) {
      try {
        await prisma.subscriptions.update({ where: { id: job.id }, data })
      } catch (err) {
        // Never a partial write; skip this row and let the next run retry it.
        console.error('[reconcile] write failed for one subscription (skipped)')
        continue
      }
      for (const d of drifts) {
        await emitAdminAlert({
          source: 'system', type: 'billing.reconcile_drift', severity: 'warning', actorUserId: job.user_id,
          payload: { user_id: job.user_id, subscription_id: job.sub_id, column: d.column, old_value: d.oldValue, new_value: d.newValue },
        })
      }
    }
    corrected += drifts.length
    report.push({ subscription_id: job.sub_id, drifts })
  }

  // Heartbeat — ALWAYS, even on a clean run, so "ran and corrected nothing" is a positive record distinct from
  // "never ran".
  await emitAdminAlert({
    source: 'system', type: 'billing.reconcile_ran', severity: 'info',
    payload: { checked: jobs.length, corrected, missing: orphans.length, unreachable, dry_run: dryRun },
  })

  return NextResponse.json({ checked: jobs.length, corrected, missing: orphans.length, unreachable, dryRun, report })
}
