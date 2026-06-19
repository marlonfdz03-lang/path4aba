import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { generateRawToken, hashRawToken } from '@/lib/extensionAuth'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let body: { email?: string; password?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { email, password } = body
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
  }

  const user = await prisma.users.findUnique({
    where: { email: email.toLowerCase().trim() },
    select: { id: true, email: true, role: true, password: true, data_tab_enabled: true },
  }).catch(() => null)

  if (!user || !user.password) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }

  const valid = await bcrypt.compare(password, user.password)
  if (!valid) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }

  // Replace any existing token for this user
  await prisma.extension_tokens.deleteMany({ where: { user_id: user.id } })

  const raw = generateRawToken()
  const hash = hashRawToken(raw)

  await prisma.extension_tokens.create({
    data: {
      id: `ext_${Date.now()}_${user.id.slice(0, 8)}`,
      user_id: user.id,
      token_hash: hash,
    },
  })

  return NextResponse.json({
    token: raw,
    userId: user.id,
    role: user.role || 'rbt',
    data_tab_enabled: user.data_tab_enabled ?? false,
  })
}
