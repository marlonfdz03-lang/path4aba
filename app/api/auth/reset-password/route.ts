import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
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

  const normalized = email.toLowerCase().trim()

  // Always respond success — never reveal whether the email exists
  const user = await prisma.users.findFirst({ where: { email: normalized } })
  if (!user) {
    return NextResponse.json({ success: true })
  }

  // Generate a secure random token
  const token = crypto.randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + 3600 * 1000) // 1 hour

  // Store token (delete any existing ones for this email first)
  await prisma.verification_tokens.deleteMany({ where: { identifier: normalized } })
  await prisma.verification_tokens.create({
    data: { identifier: normalized, token, expires },
  })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://path4aba.app'
  const resetLink = `${appUrl}/reset-password?token=${token}&email=${encodeURIComponent(normalized)}`

  sendPasswordResetEmail(normalized, resetLink).catch(
    err => console.error('[reset-password] email error:', err)
  )

  return NextResponse.json({ success: true })
}
