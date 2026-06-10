import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const { searchParams, origin } = new URL(req.url)
  const token = searchParams.get('token')

  if (!token) {
    return NextResponse.redirect(new URL('/login?message=invalid-token', origin))
  }

  const user = await prisma.users.findFirst({
    where: { email_verify_token: token },
    select: { id: true, pending_email: true },
  })

  if (!user?.pending_email) {
    return NextResponse.redirect(new URL('/login?message=invalid-token', origin))
  }

  try {
    await prisma.users.update({
      where: { id: user.id },
      data: {
        email: user.pending_email,
        pending_email: null,
        email_verify_token: null,
      },
    })

    await prisma.sessions.deleteMany({ where: { userId: user.id } })
  } catch {
    return NextResponse.redirect(new URL('/login?message=invalid-token', origin))
  }

  return NextResponse.redirect(new URL('/login?message=email-updated', origin))
}
