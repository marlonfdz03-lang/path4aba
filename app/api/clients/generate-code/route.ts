import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

function randomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const part1 = Array.from({ length: 2 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  const part2 = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  return `${part1}-${part2}`
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string

  let body: { clientId?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { clientId } = body
  if (!clientId) {
    return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })
  }

  const code = randomCode()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  console.log('[generate-code] inserting code for clientId:', clientId, 'rbt_id:', userId, 'code:', code)

  try {
    await prisma.client_access_codes.create({
      data: {
        client_id: clientId,
        rbt_id: userId,
        code,
        expires_at: expiresAt,
      },
    })
  } catch (e) {
    console.error('[generate-code] insert error:', e)
    return NextResponse.json({ error: 'Failed to generate code' }, { status: 500 })
  }

  console.log('[generate-code] success, code:', code)
  return NextResponse.json({ code })
}
