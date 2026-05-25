import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const category = searchParams.get('category')
  const activityType = searchParams.get('activityType')
  const q = searchParams.get('q')

  let query = supabaseServer
    .from('bcba_notes')
    .select('id, note, category, activity_type')
    .order('id')

  if (category) query = query.eq('category', category)
  if (activityType) query = query.or(`activity_type.eq.${activityType},activity_type.is.null`)
  if (q) query = query.ilike('note', `%${q}%`)

  const { data, error } = await query.limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ notes: data || [] })
}
