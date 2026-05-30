import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { generateMonthlySummaryPdf } from '@/lib/bcba-students/generateMonthlySummaryPdf'
import type { FieldworkType, CertificationTrack } from '@/lib/bcba-students/calculations'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ monthYear: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id as string

  const { monthYear } = await params

  const [profile, summary, sessions] = await Promise.all([
    prisma.fieldwork_profiles.findUnique({
      where: { user_id: userId },
      select: { fieldwork_type: true, certification_track: true, trainee_bacb_id: true, supervisor_name: true, supervisor_bacb_id: true },
    }),
    prisma.fieldwork_monthly_summaries.findFirst({
      where: { user_id: userId, month_year: monthYear },
    }),
    prisma.fieldwork_sessions.findMany({
      where: { user_id: userId, month_year: monthYear },
      orderBy: { session_date: 'asc' },
      select: { session_date: true, start_time: true, end_time: true, total_hours: true, activity_type: true, contact_type: true, supervisor_name: true, session_note: true },
    }),
  ])

  if (!summary) {
    return NextResponse.json({ error: 'No summary found for this month' }, { status: 404 })
  }

  const traineeName: string = session.user.name || session.user.email?.split('@')[0] || 'Trainee'
  const fieldworkType: FieldworkType = (profile?.fieldwork_type as FieldworkType) || 'supervised'
  const certificationTrack: CertificationTrack = profile?.certification_track === 'BCaBA' ? 'BCaBA' : 'BCBA'
  const monthLabel = new Date(monthYear + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const pdfBytes = await generateMonthlySummaryPdf({
    traineeName,
    traineeBacbId: profile?.trainee_bacb_id ?? null,
    supervisorName: profile?.supervisor_name ?? null,
    supervisorBacbId: profile?.supervisor_bacb_id ?? null,
    monthLabel,
    monthYear,
    fieldworkType,
    certificationTrack,
    summary,
    sessions: sessions as any,
  })

  const safeName = traineeName.replace(/\s+/g, '-')
  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Monthly-Summary-${monthYear}-${safeName}.pdf"`,
    },
  })
}
