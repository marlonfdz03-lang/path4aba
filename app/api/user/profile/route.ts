import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { Resend } from 'resend'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name, email } = await req.json()
  if (!name && !email) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const userId = (session.user as any).id
  const currentUser = await prisma.users.findUnique({ where: { id: userId }, select: { email: true } })
  if (!currentUser) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const emailChanging = email && email !== currentUser.email

  if (emailChanging) {
    const token = crypto.randomUUID()

    await prisma.users.update({
      where: { id: userId },
      data: {
        pending_email: email,
        email_verify_token: token,
        ...(name ? { name } : {}),
      },
    })

    const resend = new Resend(process.env.RESEND_API_KEY)
    await resend.emails.send({
      from: 'Path4ABA <noreply@path4aba.app>',
      to: email,
      subject: 'Verify your new email — Path4ABA',
      text: `Click to confirm your new email address:\n\nhttps://path4aba.app/api/user/verify-email?token=${token}\n\nIf you did not request this change, you can ignore this email.`,
    })

    return NextResponse.json({ pending: true, message: 'Verification email sent to new address' })
  }

  const updated = await prisma.users.update({
    where: { id: userId },
    data: { ...(name ? { name } : {}) },
    select: { id: true, name: true, email: true, role: true },
  })

  return NextResponse.json({ ok: true, user: updated })
}
