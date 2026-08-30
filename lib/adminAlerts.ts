// ─────────────────────────────────────────────────────────────────────────────
// ADMIN ALERTS — the operational event feed behind the admin "auditors" panel.
//
// One emitter, one table, one contract: emitAdminAlert never throws and never blocks its caller.
// It is called from paths that are already handling a failure (or already finished a success), so
// it must be incapable of turning a bad outcome into a worse one.
//
// HOW THIS DIFFERS FROM recordGateFindings (lib/gateFindings.ts), deliberately:
//
//   - gate_findings answers "which clinical gate fired on a note that SHIPPED". It is defect-only
//     and, by contract, DELIBERATELY SILENT — a swallowed write leaves only a console line because
//     the finding itself is advisory. admin_alerts answers "what happened in the system", and its
//     first producer is a path where the user's note did NOT ship. A swallowed alert there means an
//     outage went unrecorded, so every swallowed write MUST leave a server log line naming the event
//     type. That is the one place the two contracts intentionally diverge.
//
//   - An unapplied migration is the one failure we do NOT shout about: it is a known, transient
//     deploy state, not an incident. It degrades to a single warn per process (see isPendingMigration
//     below) so an un-migrated environment cannot flood the logs — the same fail-soft shape the
//     gate-findings and clinical-library admin routes use.
//
// PHI: payload carries diagnostics only — error text, stacks, ids, short labels. NEVER note text.
// ─────────────────────────────────────────────────────────────────────────────

// prisma is imported lazily inside emitAdminAlert, not at module load, matching recordGateFindings:
// it keeps this module importable from bare node (where the `@/` alias does not resolve) so the
// types and helpers below can be unit-tested, and a request path that never emits never pulls in
// the client.

// Where the event came from. Matches the `source` column's documented domain.
export type AlertSource = 'note' | 'extension' | 'system'

export type AlertSeverity = 'critical' | 'warning' | 'info'

// The event vocabulary. Dotted keys, `<area>.<event>`, defined HERE rather than as free strings at
// call sites so the set stays enumerable — the admin panel groups on it, and a typo at a call site
// would silently create a category nothing ever reads. Later commits extend this union.
export type AlertType =
  // A note that never reached the RBT. Severity 'critical'.
  | 'note.generation_failed'
  // Every note that DID reach the RBT — exactly one row per note, carrying the whole outcome
  // (tiers, gate result, regeneration, flag counts) in its payload. This is what makes pass rates
  // and regeneration volume computable: gate_findings is defect-only and records nothing for a
  // clean note, so without this event a successful generation leaves no trace at all.
  // Severity 'info' ALWAYS — including when the gate found violations. A note that shipped is a
  // normal outcome; the payload carries the detail, severity carries the urgency.
  | 'note.generated'
  // Preselection fell back to letting the model choose. The note still ships and the gates still
  // enforce, but its generation_context is NULL — so this is the record of WHY a row has no
  // rotation history. Severity 'warning'.
  | 'note.preselect_failed'
  // The rotation LRU window came back thinner than requested because recent notes carried NO rotation
  // signal (the extension save path stores note_text only — null generation_context, empty
  // behaviors/interventions/skills — so those rows are skipped). The note still ships; rotation just
  // has less history to rotate over. Payload: { scanned, withSignal, window }. Severity 'info'
  // (diagnostic — a note that shipped fine, not an incident).
  | 'note.rotation_window_degraded'
  // The rotation-history READ (readGenerationHistory) threw, so preselect ran with an EMPTY history — it
  // still assigned every axis from the approved sets (the FIREWALL held), only LRU variety was lost. This is
  // deliberately DISTINCT from note.preselect_failed: a rotation blip must never be read as a firewall drop.
  // Payload: { message, name }. Severity 'info' (quality degradation, not a safety event).
  | 'note.rotation_history_failed'
  // The save-time blocked-term backstop CAUGHT something: a note POSTED to a save route still contained a
  // blocked term the client should have already filtered (the Chrome extension can leave RAW text in
  // outputNote when the __META__ tail splits across network reads). We re-filtered it server-side before
  // storing, so our record is clean. Payload: { surface: 'extension'|'web', substituted: string[],
  // flagged: string[] } — TERM NAMES ONLY, never note text, never PHI. Severity 'warning' (a client-side
  // filter gap, not an outage). This is how we confirm the extension leak is still live and, after the
  // extension release, that it stopped firing.
  | 'note.save_filter_caught'
  // An assessment PDF tripped the corrupted-extraction signature (leading-capital-split rate >= threshold) so
  // parsePdf re-extracted with pdfjs instead of pd2json. Fires ONLY on the fallback path — a clean pd2json
  // upload is silent — so the rate of these rows IS how often the fallback fires. Payload: { extractor
  // ('pdfjs' | 'pdf2json' if pdfjs then failed), signature, threshold, chars, pdfjsError? }. Severity 'info'
  // on a successful pdfjs re-extract, 'warning' when pdfjs threw and we fell back to the pd2json text.
  | 'assessment.extractor_fallback'
  // The dedicated interventions pass READ the document's own enumerated section (heading matched and its span
  // fit the stable single-call window), so the intervention list came from the document rather than the
  // example menu. Payload: { heading, windowChars, dedicatedCount, mergedCount }. Severity 'info' — a good
  // outcome; the rate of these rows is how often the dedicated read succeeds.
  | 'assessment.intervention_section_read'
  // The dedicated interventions pass FOUND the enumerated section (a distinctive heading matched) but its
  // span EXCEEDED the stable window, so it was NOT read here — the profile fell back to the whole-packet +
  // menu extraction (Felix-class). Recorded distinctly from _read so "found but could not read safely" is
  // visible, never silent. Payload: { heading, spanChars, gate }. Severity 'warning'.
  | 'assessment.intervention_section_oversized'
  // An extension bearer token was rejected because it had been IDLE longer than the sliding window
  // (lib/extensionTokenExpiry). The row is NOT deleted — it stops authenticating and the extension shows its
  // "Session expired" re-login. The rate of these tells us whether real active users are hitting the window
  // (too aggressive) vs only abandoned/leaked tokens. Payload: { daysIdle } — NEVER the token value or hash;
  // the user is in actor_user_id. Severity 'warning'.
  | 'extension.token_expired'
  // A subscription write REPLACED an existing non-null stripe_subscription_id (or bcba_students_subscription_id)
  // with a DIFFERENT non-null id — the old Stripe subscription is now orphaned (still live in Stripe, no longer
  // referenced by us) and may keep billing. This is the exact signal behind the double-subscription bug (a
  // trial-declined user who re-checks-out gets a new sub; the webhook overwrites the id, orphaning the old one).
  // Payload: { old_subscription_id, new_subscription_id, event_type } — NEVER card/PII; user in actor_user_id.
  // Severity 'warning'.
  | 'billing.subscription_id_replaced'
  // A plan change SUCCEEDED in Stripe but the synchronous local subscriptions-row write FAILED — Stripe and
  // our DB have diverged (the user may briefly see the OLD plan/limit until the webhook plan-backstop heals
  // it). Must be visible, not silent. Payload: { subscription_id, intended_plan, error }. Severity 'critical'.
  | 'billing.local_sync_failed'
  // A Stripe WEBHOOK event we should act on carried a required field we could not resolve from ANY known
  // path (e.g. current_period_end / invoice.subscription after a Stripe API-version relocation). The
  // handler returns 500 so Stripe retries and the endpoint's error rate reflects it — this is the alarm
  // whose absence let the period freeze silently for months. Payload: { event_id, event_type, field,
  // subscription_id, customer_id, billing_reason }. Severity 'critical'.
  | 'billing.webhook_field_missing'
  // A DB write inside the Stripe webhook handler THREW. The handler returns 500 so Stripe redelivers the
  // (idempotent) event. Payload: { event_id, event_type, subscription_id, customer_id, error }. Severity
  // 'critical'.
  | 'billing.webhook_write_failed'
  // The reconcile job corrected a drifted column (a missed/mis-read webhook that the safety net caught). One
  // per corrected column. Payload: { user_id, subscription_id, column, old_value, new_value }. Severity
  // 'warning' (a correction means a webhook was missed — worth noticing, not an outage).
  | 'billing.reconcile_drift'
  // The reconcile job found one of our rows pointing at a Stripe subscription that 404s (resource_missing),
  // BELOW the abort threshold — a genuine orphan. It is NOT auto-canceled; a human decides. Payload:
  // { user_id, subscription_id }. Severity 'warning'.
  | 'billing.reconcile_orphan'
  // Heartbeat: the reconcile job ran to completion. Emitted every run — including a clean one — so "ran and
  // corrected nothing" is a positive record, distinct from "never ran". Payload: { checked, corrected,
  // missing, unreachable, dry_run }. Severity 'info'.
  | 'billing.reconcile_ran'
  // Circuit breaker: too large a fraction of rows 404'd, so the run ABORTED before any write — the signature
  // of a misconfigured key/mode/account, not mass churn (a test-mode key makes every live sub look missing).
  // Payload: { checked, missing, reason }. Severity 'critical'.
  | 'billing.reconcile_aborted'

export interface AdminAlertInput {
  source: AlertSource
  type: AlertType
  severity: AlertSeverity
  actorUserId?: string | null
  clientId?: string | null
  payload?: Record<string, unknown>
}

// Warn once per process, not once per event: an environment where the migration has not been run
// yet would otherwise emit a line for every alert on every request.
let warnedPendingMigration = false

// Is this failure just "the table isn't there yet"? Checked three ways because the shape depends on
// how far up the stack the error was wrapped: Prisma's own code (P2021 = table does not exist), the
// raw Postgres SQLSTATE the pg adapter surfaces (42P01 = undefined_table), and finally the message
// text as a backstop. Scoped to admin_alerts by name so an unrelated missing table still reports as
// a real error rather than being mistaken for a pending migration.
function isPendingMigration(e: unknown): boolean {
  const err = e as { code?: unknown; message?: unknown } | null
  const code = typeof err?.code === 'string' ? err.code : ''
  if (code === 'P2021' || code === '42P01') return true
  const msg = typeof err?.message === 'string' ? err.message.toLowerCase() : ''
  return msg.includes('admin_alerts') && msg.includes('not exist')
}

// Record one operational event. FAIL-SOFT BY CONTRACT: nothing in this function may propagate to the
// caller. Callers may `await` it (and should, on serverless, so the write is not cut short when the
// function freezes) without any risk of it changing their control flow.
export async function emitAdminAlert(input: AdminAlertInput): Promise<void> {
  try {
    const { prisma } = await import('@/lib/prisma')
    await prisma.admin_alerts.create({
      data: {
        source: input.source,
        type: input.type,
        severity: input.severity,
        actor_user_id: input.actorUserId || null,
        client_id: input.clientId || null,
        // The column is NOT NULL DEFAULT '{}'; pass an explicit object so an omitted payload is a
        // readable empty object rather than depending on the default round-tripping through Prisma.
        payload: (input.payload ?? {}) as never,
      },
    })
  } catch (e) {
    if (isPendingMigration(e)) {
      if (!warnedPendingMigration) {
        warnedPendingMigration = true
        console.warn(
          '[admin-alerts] admin_alerts table not present — alerts are being dropped until migration ' +
            '20260826000000_admin_alerts is applied. (Further occurrences suppressed.)',
        )
      }
      return
    }
    // A real write failure. Unlike recordGateFindings this is NOT silent: the events landing here
    // are the ones nothing else records, so losing one must be visible in the server log.
    console.error(
      `[admin-alerts] failed to record "${input.type}" (severity=${input.severity}):`,
      (e as Error)?.message ?? e,
    )
  }
}
