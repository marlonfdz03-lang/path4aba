import { NextResponse } from 'next/server'
import { getExtensionAuth } from '@/lib/extensionAuth'
import { prisma } from '@/lib/prisma'

function randomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const part1 = Array.from({ length: 2 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  const part2 = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  return `${part1}-${part2}`
}

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['bcba', 'bcaba', 'admin'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { clientId?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { clientId } = body
  if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })

  const conn = await prisma.bcba_clients.findFirst({
    where: { bcba_id: user.id, client_id: clientId },
  })
  if (!conn) return NextResponse.json({ error: 'Not connected to this client' }, { status: 403 })

  const code = randomCode()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  await prisma.client_access_codes.create({
    data: {
      client_id: clientId,
      rbt_id: null,
      created_by: 'bcba',
      code,
      expires_at: expiresAt,
    },
  })

  return NextResponse.json({ code, expiresAt: expiresAt.toISOString() })
}
