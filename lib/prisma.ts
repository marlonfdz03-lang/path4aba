import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/lib/generated/prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

function createPrisma() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const adapter = new PrismaPg(pool)
  return new PrismaClient({ adapter } as any)
}

export const prisma = globalForPrisma.prisma ?? createPrisma()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
