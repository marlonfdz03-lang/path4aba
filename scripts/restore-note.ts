// Restore a soft-deleted session note.
//
//   npx tsx scripts/restore-note.ts <noteId>
//
// Un-deletes the note by clearing deleted_at/deleted_by. The row and its full content were retained by the
// soft-delete (the DELETE button MARKS, never drops), so clearing the flag makes it active and visible in every
// list/calendar/continuity reader again immediately — "active" = superseded_at IS NULL AND deleted_at IS NULL.
//
// Uses an UNEXTENDED Prisma client (like scripts/restore-client.ts) so it never depends on app-layer filtering
// to find the row. NEVER prints note_text — a note is PHI; only ids/timestamps.

import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../lib/generated/prisma/client'

const raw = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any)

async function main() {
  const id = process.argv[2]
  if (!id) {
    console.error('Usage: npx tsx scripts/restore-note.ts <noteId>')
    process.exit(1)
  }

  const n = await raw.session_notes.findUnique({
    where: { id },
    select: { id: true, client_id: true, session_date: true, superseded_at: true, deleted_at: true, deleted_by: true },
  })
  if (!n) {
    console.error(`Note not found: ${id}`)
    process.exit(1)
  }
  if (!n.deleted_at) {
    console.log(`Note ${id} is not deleted — nothing to restore.`)
    process.exit(0)
  }

  // Never print PHI — ids and timestamps only.
  console.log(`Restoring note ${id} (client ${n.client_id ?? 'n/a'}, date ${n.session_date ?? 'n/a'}, deleted by ${n.deleted_by ?? 'unknown'} at ${n.deleted_at.toISOString?.() ?? n.deleted_at})…`)
  if (n.superseded_at) {
    console.log('  NOTE: this row is also SUPERSEDED (a newer note replaced it) — restoring undeletes it, but it stays superseded and will not appear as the active note for its date until you clear superseded_at too.')
  }
  await raw.session_notes.update({ where: { id }, data: { deleted_at: null, deleted_by: null } })
  console.log(`Done. Note ${id} is un-deleted.`)

  await raw.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await raw.$disconnect().catch(() => {})
  process.exit(1)
})
