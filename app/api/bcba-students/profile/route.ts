import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string

  const profile = await prisma.fieldwork_profiles.findUnique({ where: { user_id: userId } })
  return NextResponse.json({ profile })
}

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  // Only allow updating editable fields
  const allowed = ['trainee_bacb_id', 'supervisor_name', 'supervisor_bacb_id', 'supervisor_email', 'start_date', 'state_of_fieldwork', 'country_of_fieldwork']
  const update: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) update[key] = body[key]
  }

  try {
    await prisma.fieldwork_profiles.update({ where: { user_id: userId }, data: update as any })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
