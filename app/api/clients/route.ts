import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/lib/generated/prisma/client'
import { PLAN_LIMITS } from '@/lib/stripe'
import { buildActivityLists } from '@/lib/curatedActivities'
import { looksLikePersonRole } from '@/lib/clinicalLibrary'
import { canAccessClient } from '@/lib/clientFiles'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter } as any)

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = (session.user as any).id as string

  const clients = await prisma.clients.findMany({
    where: { OR: [{ rbt_id: userId }, { created_by: userId }] },
    select: { id: true, internal_code: true, clinical_profile: true, created_at: true },
    orderBy: { created_at: 'desc' },
  })

  return NextResponse.json(clients, {
    headers: { 'Cache-Control': 's-maxage=30, stale-while-revalidate=60' },
  })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = (session.user as any).id as string
  const userEmail = session.user.email

  const body = await req.json()
  const { id, clientName, clinicalProfile } = body
  if (!id || !clientName) return NextResponse.json({ error: 'Missing id or clientName' }, { status: 400 })

  // Check if this is a new client (upsert create path) — skip limit check for updates
  const existingClient = await prisma.clients.findUnique({ where: { id }, select: { id: true } })

  if (!existingClient && userEmail !== 'marlonfdz03@gmail.com') {
    const sub = await prisma.subscriptions.findFirst({
      where: { user_id: userId },
      select: { plan: true, status: true, trial_ends_at: true, current_period_ends_at: true },
    })

    const now = new Date()
    const isActive = sub && (
      sub.status === 'active' ||
      (sub.status === 'trialing' && sub.trial_ends_at && new Date(sub.trial_ends_at) > now) ||
      (sub.status === 'canceled' && sub.current_period_ends_at && new Date(sub.current_period_ends_at) > now)
    )

    const plan = (sub?.plan as string) || 'trial'
    const limit = PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS] ?? 1

    if (isFinite(limit)) {
      const clientCount = await prisma.clients.count({
        where: { OR: [{ rbt_id: userId }, { created_by: userId }] },
      })
      if (clientCount >= limit) {
        return NextResponse.json(
          { error: 'You have reached your plan limit. Please upgrade to add more clients.', limitReached: true },
          { status: 409 }
        )
      }
    }
  }

  // Curated activity baseline is UNCONDITIONAL on every save (create AND update) — this endpoint replaces
  // clinical_profile wholesale from the request body, so applying buildActivityLists last guarantees the
  // curated home/school lists are always present (a body without activities can never wipe them) while
  // preserving any split activities the body did provide. Flat/untagged activities are not read here.
  // PERSON FIREWALL on the create/update path — the gap that let "Mother"/"Parents"/"Adult"/"Teacher" into
  // stored profiles (the refresh path already strips them, this one did not). Rules 1-2 only (looksLikePersonRole)
  // so legitimate Title-Case brand reinforcers ("Hot Wheels", "Dragon Ball Z") are never dropped; a descriptive
  // category ("Social interaction with parents") survives. Only filters an array-shaped reinforcers list.
  const withActivities = (cp: any) => ({
    name: clientName,
    ...cp,
    ...(Array.isArray(cp?.reinforcers)
      ? { reinforcers: cp.reinforcers.filter((r: any) => !looksLikePersonRole(String(r ?? ''))) }
      : {}),
    ...buildActivityLists({ home: cp?.homeActivities, school: cp?.schoolActivities }),
  })

  await prisma.clients.upsert({
    where: { id },
    create: {
      id,
      internal_code: id,
      created_by: userId,
      rbt_id: userId,
      clinical_profile: withActivities(clinicalProfile),
    },
    update: {
      clinical_profile: withActivities(clinicalProfile),
    },
  })

  return NextResponse.json({ success: true })
}

export async function DELETE(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  // OWNERSHIP GATE — mirrors the guarded DELETE on /api/clients/[id]. 403 (never 404) for a legitimate-but-
  // unassigned user. canAccessClient reads the client (now soft-delete-filtered), so an already-archived client
  // is not re-archivable through here.
  if (!(await canAccessClient(session, id)))
    return NextResponse.json({ error: 'Forbidden — you are not assigned to this client.' }, { status: 403 })

  // SOFT DELETE (archive), not a hard delete: a hard DELETE cascade-destroyed the client's session notes
  // (billing records, incl. superseded), assessment PDFs, and every data table. Set deleted_at/deleted_by; the
  // row and all children are retained and hidden from every read by the lib/prisma extension. Restore via
  // scripts/restore-client.ts.
  const userId = (session.user as any).id as string
  await prisma.clients.update({ where: { id }, data: { deleted_at: new Date(), deleted_by: userId } })
  return NextResponse.json({ success: true })
}
