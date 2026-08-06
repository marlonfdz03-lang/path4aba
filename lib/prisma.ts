import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/lib/generated/prisma/client'
import { withNotDeleted } from '@/lib/softDelete'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

function createPrisma(): PrismaClient {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const adapter = new PrismaPg(pool)
  const base = new PrismaClient({ adapter } as any)

  // SOFT DELETE — fieldwork_sessions only. Every read gets `deleted_at: null` injected, so soft-deleted
  // sessions are invisible app-wide (lists, monthly views, and recalculateMonth's totals) without editing
  // 15 call sites. Scoped to fieldwork_sessions — NO other model or importer of @/lib/prisma is affected.
  // Writes (create/update/delete) are intentionally NOT filtered: the delete route sets deleted_at via
  // update, and the restore script must still see/rewrite deleted rows. fieldwork_sessions has no relations,
  // so there are no nested/`include` reads to miss. findUnique is not used on this model in app code; it is
  // covered defensively by post-filtering the result.
  const extended = base.$extends({
    name: 'softDeleteFieldworkSessions',
    query: {
      fieldwork_sessions: {
        async findMany({ args, query }) { args.where = withNotDeleted(args.where); return query(args) },
        async findFirst({ args, query }) { args.where = withNotDeleted(args.where); return query(args) },
        async findFirstOrThrow({ args, query }) { args.where = withNotDeleted(args.where); return query(args) },
        async count({ args, query }) { args.where = withNotDeleted(args.where); return query(args) },
        async aggregate({ args, query }) { args.where = withNotDeleted(args.where); return query(args) },
        async groupBy({ args, query }) { args.where = withNotDeleted(args.where); return query(args) },
        // findUnique's `where` accepts only unique fields, so we can't inject deleted_at into it — instead
        // post-filter the result. Defensive: no app code calls findUnique on fieldwork_sessions today.
        async findUnique({ args, query }) {
          const row: any = await query(args)
          return row && row.deleted_at != null ? null : row
        },
        async findUniqueOrThrow({ args, query }) {
          const row: any = await query(args)
          if (row && row.deleted_at != null) throw new Error('fieldwork_sessions record not found (soft-deleted)')
          return row
        },
      },
    },
  })

  // Cast back to PrismaClient: the extension only injects a `where` filter at RUNTIME — it changes no method
  // shape callers use. Casting keeps every model's arg/return types identical to the base client, so wrapping
  // the client does NOT tighten types elsewhere (e.g. clients.update in bcba/treatment-map) and break
  // unrelated routes. The runtime object is still the extended client; only the compile-time type is base.
  return extended as unknown as PrismaClient
}

// Always cache on globalThis — not just in dev.
// In Vercel's Node.js runtime, module evaluation is cached per function instance,
// but multiple concurrent instances each get their own globalThis. Caching here
// ensures we reuse the same connection pool within a single instance lifecycle
// instead of recreating it on every request after a module cache miss.
export const prisma = globalForPrisma.prisma ?? createPrisma()
globalForPrisma.prisma = prisma
