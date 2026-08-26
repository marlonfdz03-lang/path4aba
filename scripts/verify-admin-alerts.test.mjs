// ─────────────────────────────────────────────────────────────────────────────
// ADMIN-ALERTS END-TO-END VERIFICATION
//
// Proves the emitter actually reaches the database: calls the REAL emitAdminAlert from
// lib/adminAlerts.ts, then reads the rows back over a SEPARATE raw `pg` connection — deliberately NOT
// through Prisma, so the write and the read do not share the layer under test. A round-trip that only
// used Prisma for both halves would still pass if the delegate wrote to the wrong table or silently
// coerced a field.
//
// ── WHAT THIS DOES AND DOES NOT PROVE ───────────────────────────────────────
// It proves the ALERT PATH: that each alert type round-trips, that one emit produces exactly one row,
// and — the new risk in commit 2 — that the rich 'note.generated' outcome payload survives JSONB
// intact, nested objects and all, including the conditional key that must be ABSENT on a clean note.
//
// It does NOT prove that generateSmartNote emits 'note.generated' exactly once per note. That is a
// property of the generation pipeline, not of the emitter, and asserting it honestly requires a LIVE
// generation: a real Azure OpenAI call against a real client's clinical profile. That is not
// automated here rather than faked with a stub that would prove nothing. To check it by hand, generate
// one note and then run the query printed at the end of a passing run.
//
// WRITES TO THE LIVE DATABASE, then removes exactly what it wrote. Every row carries this run's id in
// its payload and the cleanup sweep is scoped to that id, so a failed assertion still cleans up and
// nothing else can ever match. It touches no other row and no application code.
//
// RUN:  node --env-file=.env.local scripts/verify-admin-alerts.test.mjs
//
// The .test.mjs suffix matches the repo convention but this file is NOT part of `npm test`, whose
// glob is lib/**/*.test.mjs — it must stay opt-in, because unlike the unit suite it needs a database
// and performs a write.
// ─────────────────────────────────────────────────────────────────────────────
import { register, createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { deepStrictEqual } from 'node:assert/strict';

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
function eq(label, actual, expected) {
  if (!Object.is(actual, expected)) {
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
// Structural comparison for values that made a round-trip through JSONB.
//
// MUST NOT be JSON.stringify-based. Postgres jsonb does not store key insertion order — it normalizes
// object keys (by length, then bytewise), so {FAVORABLE,PARTIAL,DIFFICULT} comes back as
// {PARTIAL,DIFFICULT,FAVORABLE}. That is documented, correct jsonb behavior, and switching the column
// to `json` to preserve order would be worse in every other respect (no indexing, no operators, bigger
// rows). A string comparison therefore reports a false mismatch on identical data.
//
// node:assert deepStrictEqual has exactly the semantics needed, verified against this case:
// object key ORDER is ignored while the key SET is strict (a missing, extra, or null-vs-absent key
// still fails), and ARRAY ORDER remains strict — order is meaningful for things like
// prohibited: ['RIRD'], so ['RIRD','FCT'] must never equal ['FCT','RIRD'].
function deepEq(label, actual, expected) {
  try {
    deepStrictEqual(actual, expected);
  } catch {
    // Sorted-key rendering, so a reported mismatch is always about content and can never be
    // misread as the ordering artifact this function exists to ignore.
    failures.push(`${label}: expected ${stable(expected)}, got ${stable(actual)}`);
  }
}

// JSON with object keys sorted at every depth. Diagnostics only — never used for comparison.
function stable(v) {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.keys(val).sort().map((k) => [k, val[k]]))
      : val,
  );
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

// Scopes every row this run writes, and scopes the cleanup sweep that removes them.
const runId = randomUUID();

// ── The cases ────────────────────────────────────────────────────────────────
// Representative payloads matching what the application actually emits, so the round-trip exercises
// the real shapes rather than a toy object.
const CLEAN_OUTCOME = {
  complianceLevel: 'below_typical',
  behaviorTiers: { FAVORABLE: 1, PARTIAL: 2, DIFFICULT: 0 },
  skillTiers: { FAVORABLE: 1, PARTIAL: 1, DIFFICULT: 0 },
  behaviorCount: 3,
  skillCount: 2,
  regenCount: 0,
  gateClean: true,
  similarityWarning: false,
  coherenceFlagCount: 0,
  redFlagCount: 0,
  activitiesDropped: 0,
  skillsDropped: 0,
  hasGenerationContext: true,
};

const SURVIVING = {
  prohibited: ['RIRD'],
  unapproved: [],
  skillAsReduction: ['FCT'],
  approvedFunction: ['Throwing Objects'],
  teachingMethod: ['DTT'],
  coverageMissing: [],
  unsegmentable: true,
};

const CASES = [
  {
    label: 'note.generation_failed',
    alert: {
      source: 'note',
      type: 'note.generation_failed',
      severity: 'critical',
      payload: {
        message: 'verification synthetic failure',
        name: 'Error',
        stack: 'Error: verification synthetic failure\n    at verify',
        emittedContent: false,
        // Commit 2 item 1: the flag split. A note that regenerated then died before any prose must
        // record emittedContent:false WITH regenFired:true — the pair the old single flag conflated.
        regenFired: true,
      },
    },
    expect(row, p) {
      eq('severity', row.severity, 'critical');
      eq('payload.emittedContent', p.emittedContent, false);
      eq('payload.regenFired', p.regenFired, true);
      eq('payload.name', p.name, 'Error');
      if (typeof p.stack !== 'string' || !p.stack.includes('at verify')) {
        failures.push('payload.stack did not survive the round-trip');
      }
    },
  },
  {
    label: 'note.generated (clean)',
    alert: {
      source: 'note',
      type: 'note.generated',
      severity: 'info',
      payload: CLEAN_OUTCOME,
    },
    expect(row, p) {
      eq('severity', row.severity, 'info');
      eq('type', row.type, 'note.generated');
      eq('payload.gateClean', p.gateClean, true);
      eq('payload.regenCount', p.regenCount, 0);
      // Nested objects must survive JSONB as objects, not as strings.
      deepEq('payload.behaviorTiers', p.behaviorTiers, CLEAN_OUTCOME.behaviorTiers);
      deepEq('payload.skillTiers', p.skillTiers, CLEAN_OUTCOME.skillTiers);
      eq('payload.complianceLevel', p.complianceLevel, 'below_typical');
      eq('payload.hasGenerationContext', p.hasGenerationContext, true);
      eq('payload.activitiesDropped', p.activitiesDropped, 0);
      eq('payload.skillsDropped', p.skillsDropped, 0);
      // The conditional key: on a clean note the key must be ABSENT, not present-and-empty. "Has the
      // key" is itself the signal, so a null or {} here would be a real defect.
      //
      // DELIBERATELY A KEY-PRESENCE TEST, NOT deepEq. Comparing structurally against `undefined`
      // would pass for a key that is present and set to null — which is exactly the case this must
      // catch. hasOwnProperty rather than `in` so nothing inherited from Object.prototype can be
      // mistaken for a payload key.
      if (Object.prototype.hasOwnProperty.call(p, 'survivingViolations')) {
        failures.push(
          `survivingViolations must be OMITTED entirely when gateClean is true, got ${stable(p.survivingViolations)}`,
        );
      }
    },
  },
  {
    label: 'note.generated (not clean)',
    alert: {
      source: 'note',
      type: 'note.generated',
      severity: 'info',
      payload: { ...CLEAN_OUTCOME, regenCount: 1, gateClean: false, survivingViolations: SURVIVING },
    },
    expect(row, p) {
      // Severity stays 'info' even when the gate found violations — a note that shipped is a normal
      // outcome. If this ever reads 'warning' the feed will drown the criticals that mean a lost note.
      eq('severity', row.severity, 'info');
      eq('payload.gateClean', p.gateClean, false);
      eq('payload.regenCount', p.regenCount, 1);
      deepEq('payload.survivingViolations', p.survivingViolations, SURVIVING);
      eq('payload.survivingViolations.unsegmentable', p.survivingViolations?.unsegmentable, true);
    },
  },
  {
    label: 'note.preselect_failed',
    alert: {
      source: 'note',
      type: 'note.preselect_failed',
      severity: 'warning',
      payload: {
        message: 'verification synthetic preselect failure',
        name: 'TypeError',
        stack: 'TypeError: verification synthetic preselect failure\n    at verify',
        approvedInterventionsEmpty: true,
        approvedMethodSetEmpty: false,
      },
    },
    expect(row, p) {
      eq('severity', row.severity, 'warning');
      eq('type', row.type, 'note.preselect_failed');
      eq('payload.approvedInterventionsEmpty', p.approvedInterventionsEmpty, true);
      eq('payload.approvedMethodSetEmpty', p.approvedMethodSetEmpty, false);
    },
  },
];

let emitted = 0;
let exitCode = 1;

try {
  // ── Precondition: the table exists ─────────────────────────────────────────
  // Checked up front so an unapplied migration reports as itself. Without this the emitter's
  // pending-migration path would swallow every write and the run would fail with "row not found".
  const { rows: present } = await pool.query(
    `select to_regclass('public.admin_alerts') is not null as present`,
  );
  if (!present[0]?.present) {
    fail(
      'the admin_alerts table does not exist. Apply the migration first:\n' +
        '  psql "$DATABASE_URL" -f prisma/migrations/20260826000000_admin_alerts/migration.sql',
    );
  }

  const { emitAdminAlert } = await import('@/lib/adminAlerts.ts');

  for (const c of CASES) {
    const ts = `${runId}:${c.label}`;
    const before = Date.now();
    // ── Emit through the real code path ──────────────────────────────────────
    await emitAdminAlert({
      ...c.alert,
      payload: { ...c.alert.payload, verification: true, runId, ts },
    });
    emitted++;
    const after = Date.now();

    // ── Read back over the independent raw connection ────────────────────────
    const { rows } = await pool.query(
      `select id, created_at, source, type, severity, actor_user_id, client_id, payload, read_at
         from admin_alerts
        where payload->>'runId' = $1 and payload->>'ts' = $2`,
      [runId, ts],
    );

    if (rows.length !== 1) {
      // ONE emit must produce EXACTLY one row: 0 means the write was swallowed, >1 a duplicate write.
      failures.push(
        `${c.label}: expected exactly 1 row, found ${rows.length}` +
          (rows.length === 0 ? ' (write swallowed — check the server log for a [admin-alerts] line)' : ''),
      );
      continue;
    }

    const row = rows[0];
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;

    // Shared invariants every alert must satisfy, whatever its type.
    eq(`${c.label}: source`, row.source, c.alert.source);
    eq(`${c.label}: type`, row.type, c.alert.type);
    // Neither was passed — proves the emitter's `|| null` coercion rather than a stray default.
    eq(`${c.label}: actor_user_id`, row.actor_user_id, null);
    eq(`${c.label}: client_id`, row.client_id, null);
    // NULL = unread; the panel's own state, never set at write time.
    eq(`${c.label}: read_at`, row.read_at, null);
    if (!/^[0-9a-f-]{36}$/i.test(String(row.id))) failures.push(`${c.label}: id is not a uuid: ${row.id}`);
    // created_at should come from the column default, i.e. land inside the call window (1s of slack
    // for clock skew between this process and the database server).
    const createdMs = new Date(row.created_at).getTime();
    if (!(createdMs >= before - 1000 && createdMs <= after + 1000)) {
      failures.push(`${c.label}: created_at ${row.created_at} is outside the emit window`);
    }

    // Per-case assertions. Labelled inside via the shared `failures` array.
    const mark = failures.length;
    c.expect(row, payload);
    for (let i = mark; i < failures.length; i++) failures[i] = `${c.label}: ${failures[i]}`;
  }

  if (failures.length) {
    console.log('\nFAIL — the alert path did not behave as specified:');
    for (const f of failures) console.log(`  · ${f}`);
    exitCode = 1;
  } else {
    console.log(`\nPASS — ${CASES.length} alert types round-tripped, one row each, payloads intact.`);
    for (const c of CASES) console.log(`  · ${c.label}`);
    console.log(
      '\nNOT COVERED — that a real generation emits note.generated exactly once. That needs a live\n' +
        'generation (real Azure call + real client), so verify it by hand: generate one note, then\n' +
        "  select created_at, severity, payload->>'gateClean' as clean, payload->>'regenCount' as regens\n" +
        "    from admin_alerts\n" +
        "   where type = 'note.generated' and created_at > now() - interval '10 minutes'\n" +
        '   order by created_at desc;\n' +
        'Exactly one row per note you generated is the pass condition.',
    );
    exitCode = 0;
  }
} catch (e) {
  console.log(`\nFAIL — ${e?.message || e}`);
  if (e?.stack) console.log(e.stack.split('\n').slice(1, 4).join('\n'));
  exitCode = 1;
} finally {
  // ── Remove exactly the rows this run created ───────────────────────────────
  // In `finally` so a failed assertion never leaves verification rows behind. Scoped to this run's
  // id, so it cannot touch anything else — including rows from a concurrent run of this script.
  if (emitted > 0) {
    try {
      const { rowCount } = await pool.query(
        `delete from admin_alerts where payload->>'verification' = 'true' and payload->>'runId' = $1`,
        [runId],
      );
      if (rowCount === emitted) {
        console.log(`\n  cleaned up: deleted ${rowCount} verification row(s) for run ${runId}`);
      } else {
        console.log(
          `\n  WARNING: emitted ${emitted} row(s) but cleanup deleted ${rowCount}. ` +
            `Remove leftovers by hand:\n` +
            `    delete from admin_alerts where payload->>'runId' = '${runId}';`,
        );
        exitCode = 1;
      }
    } catch (e) {
      console.log(
        `\n  WARNING: cleanup failed (${e?.message || e}). Remove by hand:\n` +
          `    delete from admin_alerts where payload->>'runId' = '${runId}';`,
      );
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
