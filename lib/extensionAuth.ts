import { headers } from 'next/headers'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'

export interface ExtensionUser {
  id: string
  role: string
  email: string
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

export async function getExtensionAuth(): Promise<ExtensionUser | null> {
  // 1. Try Bearer token from Authorization header
  const hList = await headers()
  const authHeader = hList.get('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const raw = authHeader.slice(7).trim()
    if (raw) {
      const hash = hashToken(raw)
      try {
        const record = await prisma.extension_tokens.findUnique({
          where: { token_hash: hash },
          include: { user: { select: { id: true, role: true, email: true } } },
        })
        if (record?.user) {
          prisma.extension_tokens
            .update({ where: { id: record.id }, data: { last_used_at: new Date() } })
            .catch(() => {})
          return { id: record.user.id, role: record.user.role || 'rbt', email: record.user.email }
        }
        // Token hash not found in DB — token was revoked or never existed.
        return null
      } catch (err) {
        // DB error: log and return null immediately.
        // Don't fall through to session auth — the caller sent a Bearer token
        // so they are not using cookies, and session auth will also fail.
        console.error('[extensionAuth] token lookup failed:', err)
        return null
      }
    }
  }

  // 2. Fall back to NextAuth session cookie (web app users, no Bearer header)
  const session = await auth()
  if (!session?.user) return null
  return {
    id: (session.user as any).id as string,
    role: ((session.user as any).role as string) || 'rbt',
    email: session.user.email || '',
  }
}

export function generateRawToken(): string {
  return 'p4a_' + crypto.randomBytes(32).toString('hex')
}

export function hashRawToken(raw: string): string {
  return hashToken(raw)
}
