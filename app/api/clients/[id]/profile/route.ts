import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/lib/generated/prisma/client'
import { canAccessClient } from '@/lib/clientFiles'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter } as any)

// Manually-entered client profile fields (NOT assessment-derived, never extracted/inferred):
//   gender               -> merged into clinical_profile.gender (a JSON key)
//   authorizedHoursPerWeek -> the authorized_hours_weekly column
// Previously the client PATCHed this route, which did not exist -> 404. The UI ignored the failure and
// optimistically updated local state, so the value looked saved but never persisted. This route persists
// them, with strict validation, merging into (not overwriting) clinical_profile.
const ALLOWED_GENDERS = ['', 'male', 'female']

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  // Ownership gate (shared rule): the client's assigned RBT, a connected BCBA, or an admin. Fails closed.
  if (!(await canAccessClient(session, id)))
    return NextResponse.json({ error: 'You do not have access to this client.' }, { status: 403 })

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const hasGender = body?.gender !== undefined
  const hasHours = body?.authorizedHoursPerWeek !== undefined
  if (!hasGender && !hasHours) {
    return NextResponse.json(
      { error: 'No recognized field to update (expected gender and/or authorizedHoursPerWeek).' },
      { status: 400 }
    )
  }

  // Strict validation — reject rather than persist anything unexpected.
  if (hasGender && !ALLOWED_GENDERS.includes(body.gender)) {
    return NextResponse.json({ error: "Invalid gender: must be '', 'male', or 'female'." }, { status: 400 })
  }
  let hours: number | undefined
  if (hasHours) {
    hours = Number(body.authorizedHoursPerWeek)
    if (!Number.isFinite(hours) || hours < 0 || hours > 168) {
      return NextResponse.json(
        { error: 'Invalid authorizedHoursPerWeek: must be a number between 0 and 168.' },
        { status: 400 }
      )
    }
  }

  try {
    const existingRow = await prisma.clients.findUnique({
      where: { id },
      select: { clinical_profile: true },
    })
    if (!existingRow) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    const data: any = {}
    if (hasGender) {
      // Merge — preserve every other clinical_profile key (previousProfile, observedCatalog, behaviors, …).
      const existingProfile = (existingRow.clinical_profile as object) ?? {}
      data.clinical_profile = { ...existingProfile, gender: body.gender }
    }
    if (hasHours) data.authorized_hours_weekly = hours

    await prisma.clients.update({ where: { id }, data })

    // Return the persisted value(s) so the client can confirm rather than assume.
    return NextResponse.json({
      ok: true,
      ...(hasGender ? { gender: body.gender } : {}),
      ...(hasHours ? { authorizedHoursPerWeek: hours } : {}),
    })
  } catch (err: any) {
    console.error('[PATCH /api/clients/:id/profile] error:', err?.message)
    return NextResponse.json({ error: 'Failed to update client profile' }, { status: 500 })
  }
}
