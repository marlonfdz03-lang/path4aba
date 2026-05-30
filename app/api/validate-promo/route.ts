import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(request: Request) {
  const { code } = await request.json()
  if (!code) return NextResponse.json({ valid: false, error: 'No code provided' })

  const data = await prisma.promo_codes.findFirst({
    where: { code: code.toUpperCase().trim() },
    select: { discount_amount: true, max_uses: true, current_uses: true },
  })

  if (!data) {
    return NextResponse.json({ valid: false, error: 'Invalid promo code' })
  }

  if (data.max_uses != null && data.current_uses >= data.max_uses) {
    return NextResponse.json({ valid: false, error: 'This promo code has reached its limit' })
  }

  return NextResponse.json({ valid: true, discount: data.discount_amount })
}
