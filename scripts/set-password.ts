import { PrismaClient } from '../lib/generated/prisma/client'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter } as any)

async function main() {
  const email = process.argv[2]
  const password = process.argv[3]

  if (!email || !password) {
    console.log('Usage: npx tsx scripts/set-password.ts email@example.com newpassword')
    process.exit(1)
  }

  const hash = await bcrypt.hash(password, 10)

  await prisma.users.update({
    where: { email },
    data: { password: hash },
  })

  console.log(`Password set for ${email}`)
  await pool.end()
}

main()
