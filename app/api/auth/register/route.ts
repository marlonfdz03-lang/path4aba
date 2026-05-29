import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/lib/generated/prisma/client'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter } as any)

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const { email, password, name, role } = await req.json()

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
    }

    const existing = await prisma.users.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 })
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    const user = await prisma.users.create({
      data: {
        email,
        password: hashedPassword,
        name: name ?? null,
        role: role ?? 'rbt',
      },
    })

    return NextResponse.json({ success: true, userId: user.id })
  } catch (err: any) {
    console.error('[register] error:', err)
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 })
  }
}
