import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/lib/generated/prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

function createPrisma() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const adapter = new PrismaPg(pool)
  return new PrismaClient({ adapter } as any)
}

// Always cache on globalThis — not just in dev.
// In Vercel's Node.js runtime, module evaluation is cached per function instance,
// but multiple concurrent instances each get their own globalThis. Caching here
// ensures we reuse the same connection pool within a single instance lifecycle
// instead of recreating it on every request after a module cache miss.
export const prisma = globalForPrisma.prisma ?? createPrisma()
globalForPrisma.prisma = prisma
