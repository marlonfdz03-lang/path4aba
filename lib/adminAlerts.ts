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
// would silently create a category nothing ever reads. Later commits extend this union; today the
// note-generation hard-failure path is the only producer.
export type AlertType =
  | 'note.generation_failed'

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
