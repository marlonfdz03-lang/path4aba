import { NextResponse } from 'next/server'
import { getExtensionAuth } from '@/lib/extensionAuth'
import { principalCanAccessClient, principalCanAccessRow } from '@/lib/clientFiles'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/lib/generated/prisma/client'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter } as any)

export async function GET(req: Request) {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  if (!(await principalCanAccessClient({ id: user.id, role: user.role }, clientId)))
    return NextResponse.json({ error: 'You do not have access to this client.' }, { status: 403 })

  try {
    const stos = await prisma.stos.findMany({
      where: { client_id: clientId },
      orderBy: { created_at: 'asc' },
    })
    return NextResponse.json({ stos })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const records: any[] = Array.isArray(body) ? body : [body]

  // OWNERSHIP over the WHOLE batch, before any write. Every record must carry a clientId (a missing one
  // would create a nobody-owned row), and the caller must own EVERY distinct client in the batch. Deny the
  // entire request if any check fails — never partially write.
  const principal = { id: user.id, role: user.role }
  if (records.some((r) => !r?.clientId))
    return NextResponse.json({ error: 'Every record must include a clientId.' }, { status: 400 })
  const batchClientIds = [...new Set(records.map((r) => r.clientId))]
  const ownership = await Promise.all(batchClientIds.map((cid) => principalCanAccessClient(principal, cid)))
  if (ownership.some((ok) => !ok))
    return NextResponse.json({ error: 'You do not have access to one or more clients in this batch.' }, { status: 403 })

  try {
    const created = await Promise.all(
      records.map(r =>
        prisma.stos.create({
          data: {
            client_id: r.clientId,
            target_name: r.targetName,
            target_type: r.targetType,
            baseline_value: r.baselineValue,
            goal_value: r.goalValue,
            start_date: r.startDate ?? null,
            target_date: r.targetDate ?? null,
            total_weeks: r.totalWeeks ?? 16,
            status: r.status ?? 'active',
          },
        })
      )
    )
    return NextResponse.json({ ok: true, count: created.length })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  if (!(await principalCanAccessRow({ id: user.id, role: user.role }, (rid) =>
    prisma.stos.findUnique({ where: { id: rid }, select: { client_id: true } }), id)))
    return NextResponse.json({ error: 'You do not have access to this row.' }, { status: 403 })

  const body = await req.json()
  try {
    const sto = await prisma.stos.update({
      where: { id },
      data: {
        target_name:    body.targetName    !== undefined ? body.targetName    : undefined,
        target_type:    body.targetType    !== undefined ? body.targetType    : undefined,
        baseline_value: body.baselineValue !== undefined ? body.baselineValue : undefined,
        goal_value:     body.goalValue     !== undefined ? body.goalValue     : undefined,
        start_date:     body.startDate     !== undefined ? body.startDate     : undefined,
        target_date:    body.targetDate    !== undefined ? body.targetDate    : undefined,
        total_weeks:    body.totalWeeks    !== undefined ? body.totalWeeks    : undefined,
        status:         body.status        !== undefined ? body.status        : undefined,
      },
    })
    return NextResponse.json({ sto })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  if (!(await principalCanAccessRow({ id: user.id, role: user.role }, (rid) =>
    prisma.stos.findUnique({ where: { id: rid }, select: { client_id: true } }), id)))
    return NextResponse.json({ error: 'You do not have access to this row.' }, { status: 403 })

  try {
    await prisma.stos.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
