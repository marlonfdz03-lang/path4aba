import { NextResponse } from 'next/server'
import { Resend } from 'resend'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const resend = new Resend(process.env.RESEND_API_KEY)

  let body: { email?: string; plan?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const email = body.email?.trim()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
  }

  try {
    await resend.emails.send({
      from: 'Path4ABA <noreply@path4aba.app>',
      to: 'support@path4abaapp.com',
      subject: 'Waitlist Signup — Path4ABA',
      text: `New waitlist signup:\n\nEmail: ${email}\nPlan interest: ${body.plan || 'unspecified'}`,
    })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[waitlist] Resend error:', err?.message)
    return NextResponse.json({ error: 'Failed to send. Please try again.' }, { status: 500 })
  }
}
