// Dedup byte-identical session_notes. These are CLINICAL RECORDS — this script REPORTS what it would
// delete and deletes NOTHING unless run with --apply. It groups by (client_id, md5(note_text)) — the
// exact key of the content unique index we add next — keeps the EARLIEST row per group (the original),
// and would delete the rest. Different-content notes on the same date are never touched.
//
//   Dry run (default, safe):  npx tsx scripts/dedup-session-notes.ts
//   Apply (deletes rows):     npx tsx scripts/dedup-session-notes.ts --apply
//
// Run the dry run first, review the list, and only then run --apply. After --apply, apply
// scripts/add-session-notes-content-unique-index.sql to make duplicates impossible going forward.

import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../lib/generated/prisma/client'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter } as any)

const APPLY = process.argv.includes('--apply')

type Group = {
  client_id: string | null
  total: number
  keep_id: string
  delete_ids: string[]
  session_dates: (string | null)[]
  created_ats: (string | null)[]
}

async function main() {
  // Earliest real created_at is the keeper (NULLS LAST); the rest of each identical group are dupes.
  const groups = await prisma.$queryRawUnsafe<Group[]>(`
    SELECT
      client_id::text AS client_id,
      count(*)::int AS total,
      (array_agg(id::text ORDER BY created_at ASC NULLS LAST))[1] AS keep_id,
      (array_agg(id::text ORDER BY created_at ASC NULLS LAST))[2:] AS delete_ids,
      array_agg(coalesce(session_date, '(null)') ORDER BY created_at ASC NULLS LAST) AS session_dates,
      array_agg(coalesce(created_at::text, '(null)') ORDER BY created_at ASC NULLS LAST) AS created_ats
    FROM session_notes
    WHERE note_text IS NOT NULL
    GROUP BY client_id, md5(note_text)
    HAVING count(*) > 1
    ORDER BY client_id
  `)

  const allDeleteIds = groups.flatMap((g) => g.delete_ids)

  console.log(`\n${APPLY ? 'APPLY' : 'DRY RUN'} — duplicate session_notes report`)
  console.log('='.repeat(72))

  if (groups.length === 0) {
    console.log('No byte-identical duplicates found. Nothing to do.')
    await prisma.$disconnect(); await pool.end(); process.exit(0)
  }

  // Per-client rollup.
  const perClient = new Map<string, { groups: number; toDelete: number }>()
  for (const g of groups) {
    const key = g.client_id ?? '(null client)'
    const c = perClient.get(key) ?? { groups: 0, toDelete: 0 }
    c.groups += 1; c.toDelete += g.delete_ids.length
    perClient.set(key, c)
  }
  console.log('\nPer client:')
  for (const [client, c] of perClient) {
    console.log(`  ${client}: ${c.groups} duplicated note(s), ${c.toDelete} row(s) to delete`)
  }

  // Detailed list of exactly which rows would be deleted (and which is kept).
  console.log('\nDetail (keep = earliest; delete = the rest of each identical group):')
  for (const g of groups) {
    console.log(`\n  client ${g.client_id} — ${g.total} identical rows`)
    console.log(`    KEEP   ${g.keep_id}  session_date=${g.session_dates[0]}  created_at=${g.created_ats[0]}`)
    g.delete_ids.forEach((id, i) => {
      console.log(`    DELETE ${id}  session_date=${g.session_dates[i + 1]}  created_at=${g.created_ats[i + 1]}`)
    })
  }

  console.log('\n' + '='.repeat(72))
  console.log(`Total: ${groups.length} duplicated notes across ${perClient.size} client(s); ${allDeleteIds.length} row(s) would be deleted.`)

  if (!APPLY) {
    console.log('\nDRY RUN — no rows were deleted. Re-run with --apply to delete the rows listed above.')
    await prisma.$disconnect(); await pool.end(); process.exit(0)
  }

  // --apply: delete in one transaction, keeping the earliest row of every group.
  const result = await prisma.session_notes.deleteMany({ where: { id: { in: allDeleteIds } } })
  console.log(`\nAPPLIED — deleted ${result.count} duplicate row(s). Kept ${groups.length} originals.`)
  console.log('Next: apply scripts/add-session-notes-content-unique-index.sql to prevent recurrence.')
  await prisma.$disconnect(); await pool.end(); process.exit(0)
}

main().catch(async (e) => {
  console.error('dedup-session-notes failed:', e)
  await prisma.$disconnect().catch(() => {}); await pool.end().catch(() => {})
  process.exit(1)
})
