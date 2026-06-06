import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../lib/generated/prisma/client'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter } as any)

async function main() {
  const user = await prisma.users.findUnique({
    where: { email: 'marlonfdz03@gmail.com' },
    select: { id: true, email: true, role: true },
  })

  if (!user) { console.error('User not found'); process.exit(1) }
  console.log('Found user:', user.id, user.email, user.role)

  const existing = await prisma.subscriptions.findFirst({ where: { user_id: user.id } })
  if (existing) {
    console.log('Subscription already exists:', existing)
    process.exit(0)
  }

  const far_future = new Date('2099-12-31T23:59:59Z')
  const sub = await prisma.subscriptions.create({
    data: {
      user_id: user.id,
      plan: 'bcba_pro',
      status: 'active',
      trial_ends_at: far_future,
      current_period_ends_at: far_future,
    },
  })
  console.log('Subscription created:', sub)
  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
