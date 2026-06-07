import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { noteCategories } from '@/lib/bcba-students/activity-categories'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const category = searchParams.get('category')
  const activityType = searchParams.get('activityType')
  const activityCategory = searchParams.get('activityCategory') // new: BACB enum value
  const q = searchParams.get('q')

  // If activityCategory is provided, expand it into the matching note categories.
  // The expanded list takes priority over a manually-passed ?category= param.
  const expandedCategories = activityCategory ? noteCategories(activityCategory) : null

  try {
    const notes = await prisma.bcba_notes.findMany({
      where: {
        ...(expandedCategories && expandedCategories.length > 0
          ? { category: { in: expandedCategories } }
          : category
          ? { category }
          : {}),
        ...(activityType ? { OR: [{ activity_type: activityType }, { activity_type: null }] } : {}),
        ...(q ? { note: { contains: q, mode: 'insensitive' } } : {}),
      },
      select: { id: true, note: true, category: true, activity_type: true },
      orderBy: { id: 'asc' },
      take: 100,
    })

    return NextResponse.json({ notes })
  } catch (err: any) {
    console.error('[notes] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
