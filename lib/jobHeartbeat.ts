// ─────────────────────────────────────────────────────────────────────────────
// JOB HEARTBEAT — the scheduler's "I succeeded" signal. One writer, called ONLY from a job's
// successful-completion path: never at the start, never in a catch. A job that starts and throws must
// leave NO heartbeat, so both the in-DB staleness query and the external dead-man's switch fire.
//
// A run that legitimately did nothing (zero users in a reminder window) is still a SUCCESS and MUST
// still call this — otherwise a quiet day looks identical to a dead job and the switch false-alarms.
// So callers place it on every success exit, including the empty-population early returns.
//
// TWO effects, both FAIL-SOFT (never throw, never block the job, never cause a retry): a heartbeat is
// bookkeeping, and bookkeeping must not turn a completed job into a failed HTTP response.
//   1. UPSERT job_heartbeats.last_success_at = now() — our own DB record, queryable from psql / admin.
//   2. PING the external monitor (Healthchecks.io) so an outage of OUR scheduler — the failure mode
//      that went unnoticed for months — is caught by something OUTSIDE our infrastructure. The monitor
//      alerts when an expected ping fails to ARRIVE; that is why the watcher cannot die our death.
//
// The ping fires UNCONDITIONALLY, not only when the upsert succeeds — deliberately. Collapsing the two
// would let a DB blip silence the scheduler-liveness alarm, which is the alarm we most need. Instead, if
// the upsert fails we raise a distinct admin_alert (system.job_heartbeat_write_failed) so the state "the
// job ran but left no record" is visible without gating the ping. See the catch block below.
//
// expected_interval is written on first INSERT and LEFT ALONE on CONFLICT (see the migration), so an
// operator can retune a job's tolerance with a single UPDATE and the next success will not clobber it.
//
// PHI: `note` is a short success summary (counts) only — never note text, never client-identifying data.
// ─────────────────────────────────────────────────────────────────────────────

// jobName -> the Azure app setting holding that job's Healthchecks ping URL. The ping runs server-side
// in the route, so the URL is an app env var, not a GitHub secret. An unset var degrades to DB-only
// heartbeat (logged once), never an error.
const PING_ENV: Record<string, string> = {
  'reconcile-subscriptions': 'HEARTBEAT_URL_RECONCILE',
  'trial-reminder': 'HEARTBEAT_URL_TRIAL_REMINDER',
  'fieldwork-reminders': 'HEARTBEAT_URL_FIELDWORK',
  'monthly-progress-reports': 'HEARTBEAT_URL_MONTHLY',
}

const PING_TIMEOUT_MS = 5000

export async function recordJobHeartbeat(
  jobName: string,
  expectedInterval: string, // Postgres interval literal, e.g. '1 day' | '1 month' — the SLA for this job
  note?: string,            // short success summary (counts), NEVER PHI
): Promise<void> {
  // 1) DB upsert — self-seeding. expected_interval is set on insert and NOT touched on conflict, so a
  //    hand-tuned tolerance survives every subsequent success.
  try {
    const { prisma } = await import('@/lib/prisma')
    await prisma.$executeRaw`
      INSERT INTO job_heartbeats (job_name, last_success_at, expected_interval, last_run_note, updated_at)
      VALUES (${jobName}, now(), ${expectedInterval}::interval, ${note ?? null}, now())
      ON CONFLICT (job_name) DO UPDATE SET
        last_success_at = EXCLUDED.last_success_at,
        last_run_note   = EXCLUDED.last_run_note,
        updated_at      = EXCLUDED.updated_at
    `
  } catch (e) {
    // The upsert failed: the job RAN but left NO durable record. This is the previously-invisible state —
    // the ping below still fires on success, so the external monitor goes GREEN while the staleness table
    // we actually query stays EMPTY, and nothing notices the gap. The console.error stays (kept below), but
    // it reaches nobody on its own: Azure stdout is not read day to day. So we ALSO route this to the
    // surfaced admin feed, the one channel a human reviews.
    console.error(`[job-heartbeat] db upsert failed for ${jobName} (job unaffected):`, (e as Error)?.message)
    // CONTAINMENT: emitAdminAlert is fail-soft by contract (its whole body is a try/catch that returns on
    // every path — it cannot throw). We STILL wrap the call and its dynamic import here, so that nothing —
    // not even a module-load error — can escape recordJobHeartbeat and reach the job. A heartbeat/alert
    // failure must never turn a completed job into a failed HTTP response.
    try {
      const { emitAdminAlert } = await import('@/lib/adminAlerts')
      await emitAdminAlert({
        source: 'system',
        type: 'system.job_heartbeat_write_failed',
        severity: 'warning',
        payload: { job: jobName, error: (e as Error)?.message ?? String(e) },
      })
    } catch (alertErr) {
      console.error(`[job-heartbeat] admin alert emit failed for ${jobName} (job unaffected):`, (alertErr as Error)?.message)
    }
  }

  // 2) External dead-man's-switch ping — the watcher that lives OUTSIDE our infra.
  const envName = PING_ENV[jobName]
  const url = envName ? process.env[envName] : undefined
  if (!url) {
    console.warn(`[job-heartbeat] no ping URL for ${jobName} (${envName ?? 'unmapped'} unset) — DB heartbeat only`)
    return
  }
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS)
    try {
      await fetch(url, { method: 'POST', signal: ctrl.signal })
    } finally {
      clearTimeout(timer)
    }
  } catch (e) {
    console.error(`[job-heartbeat] monitor ping failed for ${jobName} (job unaffected):`, (e as Error)?.message)
  }
}
