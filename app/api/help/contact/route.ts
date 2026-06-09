import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { Resend } from 'resend'

export const dynamic = 'force-dynamic'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { message?: string; email?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const message = body.message?.trim()
  if (!message) return NextResponse.json({ error: 'Message is required' }, { status: 400 })

  const email = body.email || session.user.email || 'unknown'

  try {
    await resend.emails.send({
      from: 'Path4ABA <noreply@path4aba.app>',
      to: 'support@path4aba.com',
      subject: 'Help Request — Path4ABA',
      text: `From: ${email}\n\nMessage:\n${message}`,
    })

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[help/contact] Resend error:', err?.message)
    return NextResponse.json({ error: 'Failed to send email. Please try again.' }, { status: 500 })
  }
}
