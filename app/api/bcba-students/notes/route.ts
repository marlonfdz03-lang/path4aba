import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  console.log('[notes] route handler invoked')

  const { searchParams } = new URL(req.url)
  const category = searchParams.get('category')
  const activityType = searchParams.get('activityType')
  const q = searchParams.get('q')

  console.log('[notes] params received:', { category, activityType, q })

  let query = supabaseServer
    .from('bcba_notes')
    .select('id, note, category, activity_type')
    .order('id')

  if (category) {
    console.log('[notes] applying category filter:', category)
    query = query.eq('category', category)
  }
  if (activityType) {
    const orFilter = `activity_type.eq.${activityType},activity_type.is.null`
    console.log('[notes] applying activity_type filter (or):', orFilter)
    query = query.or(orFilter)
  }
  if (q) {
    console.log('[notes] applying search filter:', q)
    query = query.ilike('note', `%${q}%`)
  }

  console.log('[notes] executing Supabase query...')
  const { data, error } = await query.limit(100)

  console.log('[notes] result — count:', data?.length ?? 'null', '| error:', error?.message ?? 'none', '| error code:', error?.code ?? 'none')

  if (error) {
    console.error('[notes] Supabase error detail:', JSON.stringify(error))
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ notes: data || [] })
}
