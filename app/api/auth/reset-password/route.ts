import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'
import { sendPasswordResetEmail } from '@/lib/email'

export async function POST(request: Request) {
  let body: { email?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { email } = body
  if (!email) {
    return NextResponse.json({ error: 'Missing email' }, { status: 400 })
  }

  // Generate the recovery link via Supabase admin (uses service role, bypasses rate limits)
  const { data, error } = await supabaseServer.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: 'https://path4aba.app/reset-password' },
  })

  if (error || !data?.properties?.action_link) {
    // Don't reveal whether the email exists — always respond success
    console.error('[reset-password] generateLink error:', error?.message)
    return NextResponse.json({ success: true })
  }

  sendPasswordResetEmail(email, data.properties.action_link).catch(
    err => console.error('[reset-password] email error:', err)
  )

  return NextResponse.json({ success: true })
}
