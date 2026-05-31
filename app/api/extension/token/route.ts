import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { generateRawToken, hashRawToken } from '@/lib/extensionAuth'

export const dynamic = 'force-dynamic'

// GET — check if user has an active token (no token value returned)
export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string

  const record = await prisma.extension_tokens.findFirst({
    where: { user_id: userId },
    select: { id: true, created_at: true, last_used_at: true },
  })

  return NextResponse.json({ hasToken: !!record, createdAt: record?.created_at ?? null, lastUsedAt: record?.last_used_at ?? null })
}

// POST — generate (or replace) the token for this user, return raw value exactly once
export async function POST() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string

  // Delete any existing token for this user
  await prisma.extension_tokens.deleteMany({ where: { user_id: userId } })

  const raw = generateRawToken()
  const hash = hashRawToken(raw)

  await prisma.extension_tokens.create({
    data: {
      id: `ext_${Date.now()}_${userId.slice(0, 8)}`,
      user_id: userId,
      token_hash: hash,
    },
  })

  return NextResponse.json({ token: raw })
}

// DELETE — revoke the token
export async function DELETE() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string

  await prisma.extension_tokens.deleteMany({ where: { user_id: userId } })
  return NextResponse.json({ ok: true })
}
