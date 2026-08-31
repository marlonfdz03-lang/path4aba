// Restore a soft-deleted (archived) client.
//
//   npx tsx scripts/restore-client.ts <clientId>
//
// Un-archives the client by clearing deleted_at/deleted_by. Nothing else is needed: unlike fieldwork
// sessions, archiving a client cascades no recomputation — the row and ALL children (session notes incl.
// superseded, PDFs, data tables) were retained untouched by the soft-delete, so clearing the flag makes the
// whole client and its history visible again immediately.
//
// Uses an UNEXTENDED Prisma client to read/rewrite the row: the app's @/lib/prisma hides deleted_at != null
// rows via the soft-delete extension, so it cannot see the very row we need to restore.

import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../lib/generated/prisma/client'

const raw = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any)

async function main() {
  const id = process.argv[2]
  if (!id) {
    console.error('Usage: npx tsx scripts/restore-client.ts <clientId>')
    process.exit(1)
  }

  const c = await raw.clients.findUnique({
    where: { id },
    select: { id: true, internal_code: true, deleted_at: true, deleted_by: true },
  })
  if (!c) {
    console.error(`Client not found: ${id}`)
    process.exit(1)
  }
  if (!c.deleted_at) {
    console.log(`Client ${id} is not archived — nothing to restore.`)
    process.exit(0)
  }

  // Never print PHI — the internal_code / id only.
  console.log(`Restoring client ${id} (code ${c.internal_code ?? 'n/a'}, archived by ${c.deleted_by ?? 'unknown'} at ${c.deleted_at.toISOString?.() ?? c.deleted_at})…`)
  await raw.clients.update({ where: { id }, data: { deleted_at: null, deleted_by: null } })
  console.log(`Done. Client ${id} is active again; all retained notes, PDFs, and data are visible.`)

  await raw.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await raw.$disconnect().catch(() => {})
  process.exit(1)
})
