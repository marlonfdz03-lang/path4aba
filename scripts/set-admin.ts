import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../lib/generated/prisma/client'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter } as any)

async function main() {
  const user = await prisma.users.update({
    where: { email: 'marlonfdz03@gmail.com' },
    data: { role: 'admin' }
  })
  console.log('Admin role set for:', user.email)
  process.exit(0)
}

main()
