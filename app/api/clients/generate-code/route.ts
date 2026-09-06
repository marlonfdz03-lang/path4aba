import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { canAccessClient } from '@/lib/clientFiles'

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

  // OWNERSHIP GATE: only a user who OWNS this client (assigned RBT via rbt_id, connected/creating BCBA via
  // bcba_clients, or admin) may mint an invite code for it. Without this, any authenticated user could mint a
  // code for ANOTHER tenant's client id and redeem it via connect-with-code into a permanent bcba_clients
  // connection — full cross-tenant access. canAccessClient fails closed (no session / not owner / throw → 403).
  // The legitimate invite flows still pass: an RBT owns via rbt_id; a BCBA who created the client owns via the
  // bcba_clients row written at creation (bcba/clients/create).
  if (!(await canAccessClient(session, clientId))) {
    return NextResponse.json({ error: 'Forbidden — you are not assigned to this client.' }, { status: 403 })
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
