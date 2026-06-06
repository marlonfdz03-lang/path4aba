import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../lib/generated/prisma/client'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter } as any)

async function main() {
  const userId = 'cmq2p6bgd0000fqprf7x593fi'

  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true },
  })
  if (!user) { console.error('User not found'); process.exit(1) }
  console.log('Found user:', user.id, user.email, user.role)

  const oneMonthOut = new Date()
  oneMonthOut.setMonth(oneMonthOut.getMonth() + 1)

  const sub = await prisma.subscriptions.upsert({
    where: { user_id: userId },
    create: {
      user_id: userId,
      plan: 'bcba_starter',
      status: 'active',
      current_period_ends_at: oneMonthOut,
    },
    update: {
      plan: 'bcba_starter',
      status: 'active',
      current_period_ends_at: oneMonthOut,
    },
  })
  console.log('Subscription upserted:', sub)
  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
