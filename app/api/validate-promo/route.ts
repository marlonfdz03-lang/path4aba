import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'

export async function POST(request: Request) {
  const { code } = await request.json()
  if (!code) return NextResponse.json({ valid: false, error: 'No code provided' })

  const { data, error } = await supabaseServer
    .from('promo_codes')
    .select('discount_amount, max_uses, current_uses')
    .eq('code', code.toUpperCase().trim())
    .maybeSingle()

  if (error || !data) {
    return NextResponse.json({ valid: false, error: 'Invalid promo code' })
  }

  if (data.current_uses >= data.max_uses) {
    return NextResponse.json({ valid: false, error: 'This promo code has reached its limit' })
  }

  return NextResponse.json({ valid: true, discount: data.discount_amount })
}
