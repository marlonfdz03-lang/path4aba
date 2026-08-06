// Restore a soft-deleted fieldwork session.
//
//   npx tsx scripts/restore-fieldwork-session.ts <sessionId> [--force-signed]
//
// WHY restore = clear deleted_at AND re-run recalculateMonth (do NOT skip the recalc):
//   Soft-deleting a session ran recalculateMonth, which recomputed that month's totals in
//   fieldwork_monthly_summaries EXCLUDING the session. Clearing deleted_at alone un-hides the row but
//   leaves the summary holding the reduced totals — the month stays WRONG until recalculateMonth runs
//   again with the session restored. SQL `UPDATE ... SET deleted_at = NULL` on its own is not enough.
//
// SIGNED-MONTH GUARD (do NOT remove — this is the thing that gets forgotten under pressure):
//   The delete route blocks deleting from an MVF-signed month, so a session can only be soft-deleted while
//   the month is UNSIGNED. But the month may have been SIGNED afterward (with this session excluded, and
//   is_eligible computed from the reduced hours). Restoring then would change a SIGNED BACB record's hours.
//   This script REFUSES to restore into a signed month unless you pass --force-signed with conscious
//   supervisor approval to correct a signed month.
//
// Uses an UNEXTENDED Prisma client to read/rewrite the row: the app's @/lib/prisma hides deleted_at != null
// rows via the soft-delete extension, so it cannot see the very row we need to restore. recalculateMonth
// (imported below) uses the app client, which is correct AFTER the row is un-deleted.

import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../lib/generated/prisma/client'
import { recalculateMonth } from '../lib/bcba-students/recalculate-month'

const raw = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any)

async function main() {
  const id = process.argv[2]
  const forceSigned = process.argv.includes('--force-signed')
  if (!id) {
    console.error('Usage: npx tsx scripts/restore-fieldwork-session.ts <sessionId> [--force-signed]')
    process.exit(1)
  }

  const s = await raw.fieldwork_sessions.findUnique({
    where: { id },
    select: { id: true, user_id: true, session_date: true, month_year: true, deleted_at: true, deleted_by: true },
  })
  if (!s) {
    console.error(`Session not found: ${id}`)
    process.exit(1)
  }
  if (!s.deleted_at) {
    console.log(`Session ${id} is not deleted — nothing to restore.`)
    process.exit(0)
  }

  const monthYear = s.month_year || String(s.session_date).slice(0, 7)

  const summary = await raw.fieldwork_monthly_summaries.findFirst({
    where: { user_id: s.user_id, month_year: monthYear },
    select: { mvf_signed: true },
  })
  if (summary?.mvf_signed && !forceSigned) {
    console.error(`REFUSED: month ${monthYear} is MVF-SIGNED. Restoring this session would change a signed BACB record's hours.`)
    console.error('Re-run with --force-signed ONLY with supervisor approval to correct a signed month.')
    process.exit(2)
  }

  console.log(`Restoring session ${id} (user ${s.user_id}, month ${monthYear}, deleted_by ${s.deleted_by ?? 'unknown'})${summary?.mvf_signed ? ' [FORCED into a signed month]' : ''}…`)
  await raw.fieldwork_sessions.update({ where: { id }, data: { deleted_at: null, deleted_by: null } })

  // MUST re-run: the summary still holds the reduced totals from when this session was deleted.
  await recalculateMonth(s.user_id, monthYear)
  console.log(`Done. Restored session ${id} and recalculated month ${monthYear}.`)

  await raw.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await raw.$disconnect().catch(() => {})
  process.exit(1)
})
