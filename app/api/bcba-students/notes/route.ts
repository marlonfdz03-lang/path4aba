import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  console.log('[notes] route handler invoked')

  const { searchParams } = new URL(req.url)
  const category = searchParams.get('category')
  const activityType = searchParams.get('activityType')
  const q = searchParams.get('q')

  console.log('[notes] params received:', { category, activityType, q })

  try {
    const notes = await prisma.bcba_notes.findMany({
      where: {
        ...(category ? { category } : {}),
        ...(activityType ? { OR: [{ activity_type: activityType }, { activity_type: null }] } : {}),
        ...(q ? { note: { contains: q, mode: 'insensitive' } } : {}),
      },
      select: { id: true, note: true, category: true, activity_type: true },
      orderBy: { id: 'asc' },
      take: 100,
    })

    console.log('[notes] result — count:', notes.length)
    return NextResponse.json({ notes })
  } catch (err: any) {
    console.error('[notes] error detail:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
