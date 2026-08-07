// scripts/backfillCuratedActivities.mjs
//
// One-time backfill: append the curated activity list to EVERY existing client's homeActivities /
// schoolActivities, so the whole current population matches the new creation-seeding behavior (new
// clients get the curated baseline at creation; this covers everyone created before that shipped).
//
// SAFE BY DESIGN:
//   • DRY-RUN by default — prints exactly what WOULD change and writes nothing. Pass --write to persist.
//   • Idempotent — uses the SAME buildActivityLists helper as the write paths (append then case-insensitive
//     dedupe). Running it twice is a no-op: the second run finds the curated items already present.
//   • Preserves real data — ONLY the two activity arrays are touched; a client's real assessment activities
//     stay and stay FIRST; behaviors, reinforcers, interventions, diagnosis, everything else is untouched.
//   • Reversible — before any write, dumps every client's full clinical_profile to a git-ignored backup
//     file (clinical_profile_backup_<ts>.json) so you can diff or restore.
//
// RUN:
//   Dry-run (default, writes nothing):
//     node --env-file=.env.local scripts/backfillCuratedActivities.mjs
//   Real write (after reviewing the dry-run):
//     node --env-file=.env.local scripts/backfillCuratedActivities.mjs --write

import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { buildActivityLists, CURATED_HOME_ACTIVITIES, CURATED_SCHOOL_ACTIVITIES } from '../lib/curatedActivities.ts';

const WRITE = process.argv.includes('--write');
const ts = new Date().toISOString().replace(/[:.]/g, '-');

function arr(v) { return Array.isArray(v) ? v : []; }

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const { rows } = await pool.query(
    'select id, internal_code, clinical_profile from clients where clinical_profile is not null',
  );

  console.log(`\n${WRITE ? '✍️  WRITE MODE' : '🔎 DRY-RUN (no writes — pass --write to persist)'}`);
  console.log(`curated baseline: ${CURATED_HOME_ACTIVITIES.length} home / ${CURATED_SCHOOL_ACTIVITIES.length} school`);
  console.log(`clients with a profile: ${rows.length}\n`);

  // Full backup BEFORE any write (git-ignored filename).
  if (WRITE) {
    const backupPath = `clinical_profile_backup_${ts}.json`;
    writeFileSync(backupPath, JSON.stringify(rows.map((r) => ({ id: r.id, internal_code: r.internal_code, clinical_profile: r.clinical_profile })), null, 2));
    console.log(`🗄  backup written: ${backupPath} (${rows.length} profiles)\n`);
  }

  let changed = 0, unchanged = 0, wrote = 0;
  for (const r of rows) {
    const cp = r.clinical_profile || {};
    const beforeHome = arr(cp.homeActivities), beforeSchool = arr(cp.schoolActivities);
    // SAME helper as every write path: existing activities lead, curated appended, deduped.
    const { homeActivities, schoolActivities } = buildActivityLists({ home: beforeHome, school: beforeSchool });

    const same =
      homeActivities.length === beforeHome.length &&
      schoolActivities.length === beforeSchool.length &&
      homeActivities.every((v, i) => v === beforeHome[i]) &&
      schoolActivities.every((v, i) => v === beforeSchool[i]);

    if (same) { unchanged++; continue; }
    changed++;
    console.log(`• ${r.internal_code || String(r.id).slice(0, 8)}: home ${beforeHome.length}→${homeActivities.length}, school ${beforeSchool.length}→${schoolActivities.length}`);

    if (WRITE) {
      // Merge ONLY the two activity arrays back — nothing else in the profile is read or written.
      const merged = { ...cp, homeActivities, schoolActivities };
      await pool.query('update clients set clinical_profile = $1 where id = $2', [merged, r.id]);
      wrote++;
    }
  }

  console.log(`\nsummary: ${changed} would change, ${unchanged} already complete (idempotent no-op)${WRITE ? `, ${wrote} written` : ''}`);
  if (!WRITE && changed > 0) console.log(`→ review the list above, then re-run with --write to persist.`);
  await pool.end();
}

main().catch((e) => { console.error('backfill failed:', e.message); process.exit(1); });
