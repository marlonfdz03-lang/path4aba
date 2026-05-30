import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'

export async function POST(request: Request) {
  let body: { token?: string; email?: string; password?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { token, email, password } = body
  if (!token || !email || !password) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }

  const normalized = email.toLowerCase().trim()

  // Validate token
  const record = await prisma.verification_tokens.findFirst({
    where: { identifier: normalized, token },
  })

  if (!record || record.expires < new Date()) {
    return NextResponse.json({ error: 'Invalid or expired reset link. Please request a new one.' }, { status: 400 })
  }

  // Hash and update password
  const hashedPassword = await bcrypt.hash(password, 12)
  await prisma.users.update({
    where: { email: normalized },
    data: { password: hashedPassword },
  })

  // Consume the token
  await prisma.verification_tokens.deleteMany({ where: { identifier: normalized } })

  return NextResponse.json({ success: true })
}
