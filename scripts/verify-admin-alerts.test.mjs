// ─────────────────────────────────────────────────────────────────────────────
// ADMIN-ALERTS END-TO-END VERIFICATION
//
// Proves the Commit 1 emitter actually reaches the database: calls the REAL emitAdminAlert from
// lib/adminAlerts.ts, then reads the row back over a SEPARATE raw `pg` connection — deliberately NOT
// through Prisma, so the write and the read do not share the layer under test. A round-trip that only
// used Prisma for both halves would still pass if the delegate wrote to the wrong table or silently
// coerced a field.
//
// WRITES TO THE LIVE DATABASE, then removes exactly what it wrote. The row is scoped by a
// per-run `ts` in its payload and deleted BY ID in a finally block, so a failed assertion still
// cleans up. It touches no other row and no application code.
//
// RUN:  node --env-file=.env.local scripts/verify-admin-alerts.test.mjs
//
// The .test.mjs suffix matches the repo convention but this file is NOT part of `npm test`, whose
// glob is lib/**/*.test.mjs — it must stay opt-in, because unlike the unit suite it needs a database
// and performs a write.
// ─────────────────────────────────────────────────────────────────────────────
import { register } from 'node:module';
import { createRequire } from 'node:module';

const ROOT = new URL('../', import.meta.url).href; // scripts/ -> project root

// Resolve the project's `@/*` TS path alias for bare Node. Inlined as a data: URL rather than a
// helper file so this script stays standalone — module hooks must live in their own module because
// they run on a dedicated thread, and a data: URL satisfies that without adding a second file.
//
// This does NOT reuse scripts/alias-hooks.mjs on purpose: that harness redirects '@/lib/prisma' to a
// throwing stub, which is exactly the thing this script has to exercise for real. No TypeScript
// transpile hook is needed either — Node 22.18+/24 strips types natively, and neither
// lib/adminAlerts.ts nor the generated client uses the value-import-of-a-type pattern that defeats it.
const ALIAS_HOOK = `
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = ${JSON.stringify(ROOT)};
const EXTS = ['.ts', '.tsx', '.mjs', '.js', '.cjs', '.json'];
function withExt(href) {
  const p = fileURLToPath(href);
  if (existsSync(p)) return href;
  const direct = EXTS.map((e) => [p + e, href + e]).find(([f]) => existsSync(f));
  if (direct) return direct[1];
  const index = EXTS.map((e) => [p + '/index' + e, href + '/index' + e]).find(([f]) => existsSync(f));
  return index ? index[1] : href;
}
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('@/')) return next(withExt(new URL(spec.slice(2), ROOT).href), ctx);
  // The generated Prisma client imports its siblings extensionlessly; add the extension so Node finds them.
  if ((spec.startsWith('./') || spec.startsWith('../')) && !/\\.[a-z]+$/i.test(spec) && ctx.parentURL) {
    const base = new URL(spec, ctx.parentURL).href;
    const resolved = withExt(base);
    if (resolved !== base) return next(resolved, ctx);
  }
  return next(spec, ctx);
}
`;
register('data:text/javascript,' + encodeURIComponent(ALIAS_HOOK));

const require = createRequire(import.meta.url);
const { Pool } = require('pg');

// ── Result reporting ─────────────────────────────────────────────────────────
const failures = [];
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  return ok;
}
function fail(reason) {
  console.log(`\nFAIL — ${reason}`);
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  fail('DATABASE_URL is not set. Run with: node --env-file=.env.local scripts/verify-admin-alerts.test.mjs');
}

// Same construction as lib/prisma.ts (connectionString only, no ssl override) so this connects
// exactly the way the application does — if the app can reach the database, so can this.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Unique per run; used to find the row again and to scope the cleanup so nothing else can match.
const ts = new Date().toISOString();

let insertedId = null;
let exitCode = 1;

try {
  // ── Precondition: the table exists ─────────────────────────────────────────
  // Checked up front so an unapplied migration reports as itself. Without this the emitter's
  // pending-migration path would swallow the write and the run would fail with the far less useful
  // "row not found".
  const { rows: present } = await pool.query(
    `select to_regclass('public.admin_alerts') is not null as present`,
  );
  if (!present[0]?.present) {
    fail(
      'the admin_alerts table does not exist. Apply the migration first:\n' +
        '  psql "$DATABASE_URL" -f prisma/migrations/20260826000000_admin_alerts/migration.sql',
    );
  }

  // ── 1. Emit through the real code path ─────────────────────────────────────
  // type is the emitter's only defined AlertType key; reusing it (rather than inventing a
  // 'system.verification' key) keeps the union honest — nothing is added to the vocabulary just to
  // be tested. The row is identified by its payload, not its type.
  const { emitAdminAlert } = await import('@/lib/adminAlerts.ts');

  const before = Date.now();
  await emitAdminAlert({
    source: 'system',
    type: 'note.generation_failed',
    severity: 'critical',
    payload: { verification: true, ts },
  });
  const after = Date.now();

  // ── 2. Read it back over the independent raw connection ────────────────────
  const { rows } = await pool.query(
    `select id, created_at, source, type, severity, actor_user_id, client_id, payload, read_at
       from admin_alerts
      where payload->>'ts' = $1 and payload->>'verification' = 'true'`,
    [ts],
  );

  if (rows.length === 0) {
    fail(
      `no admin_alerts row was written for ts=${ts}. The emitter swallowed the write — ` +
        'check the server log for a [admin-alerts] line naming the cause.',
    );
  }
  // More than one means the emitter wrote twice for a single call.
  if (rows.length > 1) {
    fail(`expected exactly 1 admin_alerts row for ts=${ts}, found ${rows.length} (duplicate write).`);
  }

  const row = rows[0];
  insertedId = row.id;

  // ── 3. Assert every field, including the ones the emitter derives ───────────
  // All checks run before reporting so a mismatch shows the full picture rather than the first error.
  check('source', row.source, 'system');
  check('type', row.type, 'note.generation_failed');
  check('severity', row.severity, 'critical');
  // Not passed by this call — proves the emitter's `|| null` coercion, not a stray default.
  check('actor_user_id', row.actor_user_id, null);
  check('client_id', row.client_id, null);
  // NULL = unread; the panel's own state, never set at write time.
  check('read_at', row.read_at, null);

  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  check('payload.verification', payload?.verification, true);
  check('payload.ts', payload?.ts, ts);
  const extraKeys = Object.keys(payload ?? {}).filter((k) => k !== 'verification' && k !== 'ts');
  if (extraKeys.length) failures.push(`payload has unexpected keys: ${extraKeys.join(', ')}`);

  // created_at should come from the column default, i.e. land inside the call window (1s of slack
  // for clock skew between this process and the database server).
  const createdMs = new Date(row.created_at).getTime();
  if (!(createdMs >= before - 1000 && createdMs <= after + 1000)) {
    failures.push(
      `created_at ${row.created_at} is outside the emit window ` +
        `${new Date(before).toISOString()}..${new Date(after).toISOString()}`,
    );
  }
  if (!/^[0-9a-f-]{36}$/i.test(String(row.id))) failures.push(`id is not a uuid: ${row.id}`);

  if (failures.length) {
    console.log('\nFAIL — the row was written but does not match what was sent:');
    for (const f of failures) console.log(`  · ${f}`);
    exitCode = 1;
  } else {
    console.log(`\nPASS — emitAdminAlert wrote admin_alerts ${row.id} and every field matched.`);
    console.log(`  source=${row.source} type=${row.type} severity=${row.severity}`);
    console.log(`  actor_user_id=null client_id=null read_at=null payload.ts=${ts}`);
    exitCode = 0;
  }
} catch (e) {
  console.log(`\nFAIL — ${e?.message || e}`);
  if (e?.stack) console.log(e.stack.split('\n').slice(1, 4).join('\n'));
  exitCode = 1;
} finally {
  // ── 4. Remove exactly the row this run created ─────────────────────────────
  // In `finally` so a failed assertion never leaves a verification row behind. Deletes by id, so it
  // cannot touch anything else even if the query above somehow over-matched.
  if (insertedId) {
    try {
      const { rowCount } = await pool.query('delete from admin_alerts where id = $1', [insertedId]);
      if (rowCount === 1) {
        console.log(`  cleaned up: deleted admin_alerts ${insertedId}`);
      } else {
        console.log(`  WARNING: cleanup deleted ${rowCount} rows for id ${insertedId} — remove it by hand.`);
        exitCode = 1;
      }
    } catch (e) {
      console.log(`  WARNING: cleanup failed for id ${insertedId}: ${e?.message || e} — remove it by hand.`);
      exitCode = 1;
    }
  }

  await pool.end().catch(() => {});
  // The emitter opened its own pool via lib/prisma; close it too or the process will not exit.
  try {
    const { prisma } = await import('@/lib/prisma');
    await prisma.$disconnect();
  } catch { /* nothing to disconnect */ }
}

process.exit(exitCode);
