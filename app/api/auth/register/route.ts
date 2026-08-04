import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/lib/generated/prisma/client'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter } as any)

export const dynamic = 'force-dynamic'

// Roles a user may self-assign at public signup. 'admin' is deliberately absent — it must NEVER be
// obtainable through any public path (it is set only by the admin-guarded PATCH in app/api/admin/users).
// An invalid or privileged value is REJECTED (400), never silently downgraded, so an attempt to register
// as admin surfaces in logs instead of being hidden behind a quiet fallback to 'rbt'.
const SELF_ASSIGNABLE_ROLES = ['rbt', 'bcba', 'bcaba', 'bcba_student', 'bcaba_student']

export async function POST(req: Request) {
  try {
    const { email, password, name, role } = await req.json()

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
    }

    // Only reject when a role was actually supplied and is not self-assignable; an omitted role
    // defaults to 'rbt' below (a legitimate signup, not an attack signal).
    if (role !== undefined && role !== null && !SELF_ASSIGNABLE_ROLES.includes(role)) {
      console.warn(`[register] rejected non-self-assignable role="${role}" for email="${email}"`)
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
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
