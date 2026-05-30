import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let body: { certificationTrack?: string; fieldworkType?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { certificationTrack, fieldworkType } = body
  if (!certificationTrack || !fieldworkType) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as any).id as string

  try {
    await prisma.fieldwork_profiles.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        certification_track: certificationTrack,
        fieldwork_type: fieldworkType,
        onboarding_complete: true,
      },
      update: {
        certification_track: certificationTrack,
        fieldwork_type: fieldworkType,
        onboarding_complete: true,
      },
    })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[bcba-students/onboarding] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
