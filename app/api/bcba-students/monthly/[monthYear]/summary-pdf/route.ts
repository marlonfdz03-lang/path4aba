import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { generateMonthlySummaryPdf } from '@/lib/bcba-students/generateMonthlySummaryPdf'
import type { FieldworkType, CertificationTrack } from '@/lib/bcba-students/calculations'

export const dynamic = 'force-dynamic'

async function getUser() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() {},
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function GET(req: Request, { params }: { params: Promise<{ monthYear: string }> }) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { monthYear } = await params

  const [profileRes, summaryRes, sessionsRes] = await Promise.all([
    supabaseServer.from('fieldwork_profiles').select('fieldwork_type, certification_track, trainee_bacb_id, supervisor_name, supervisor_bacb_id').eq('user_id', user.id).maybeSingle(),
    supabaseServer.from('fieldwork_monthly_summaries').select('*').eq('user_id', user.id).eq('month_year', monthYear).maybeSingle(),
    supabaseServer.from('fieldwork_sessions').select('session_date, start_time, end_time, total_hours, activity_type, contact_type, supervisor_name, session_note').eq('user_id', user.id).eq('month_year', monthYear).order('session_date', { ascending: true }),
  ])

  if (!summaryRes.data) {
    return NextResponse.json({ error: 'No summary found for this month' }, { status: 404 })
  }

  const traineeName: string = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Trainee'
  const fieldworkType: FieldworkType = (profileRes.data?.fieldwork_type as FieldworkType) || 'supervised'
  const certificationTrack: CertificationTrack = profileRes.data?.certification_track === 'BCaBA' ? 'BCaBA' : 'BCBA'
  const monthLabel = new Date(monthYear + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const pdfBytes = await generateMonthlySummaryPdf({
    traineeName,
    traineeBacbId: profileRes.data?.trainee_bacb_id ?? null,
    supervisorName: profileRes.data?.supervisor_name ?? null,
    supervisorBacbId: profileRes.data?.supervisor_bacb_id ?? null,
    monthLabel,
    monthYear,
    fieldworkType,
    certificationTrack,
    summary: summaryRes.data,
    sessions: sessionsRes.data || [],
  })

  const safeName = traineeName.replace(/\s+/g, '-')
  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Monthly-Summary-${monthYear}-${safeName}.pdf"`,
    },
  })
}
