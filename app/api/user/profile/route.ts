import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name, email } = await req.json()
  if (!name && !email) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const updated = await prisma.users.update({
    where: { id: (session.user as any).id },
    data: {
      ...(name ? { name } : {}),
      ...(email ? { email } : {}),
    },
    select: { id: true, name: true, email: true, role: true },
  })

  return NextResponse.json({ ok: true, user: updated })
}
