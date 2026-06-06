import NextAuth from 'next-auth'
import { authConfig } from './auth.config'
import { NextRequest, NextResponse } from 'next/server'

// Edge-safe config — no Prisma/Node.js imports, JWT verification only.
const { auth } = NextAuth(authConfig)

const PUBLIC_PATHS = ['/login', '/pricing', '/privacy', '/terms', '/reset-password']

// Authenticated users with no active subscription may still access these paths.
const SUB_EXEMPT_PATHS = [
  '/',
  '/login',
  '/pricing',
  '/privacy',
  '/terms',
  '/reset-password',
  '/onboarding',
  '/admin',
]

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed =
    origin &&
    (origin.startsWith('chrome-extension://') ||
      origin === 'https://path4aba.app' ||
      origin === 'http://localhost:3000')
      ? origin
      : 'https://path4aba.app'
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  }
}

export const proxy = auth(async function proxy(req: NextRequest & { auth: any }) {
  const { pathname } = req.nextUrl
  const origin = req.headers.get('origin')

  // ── API routes: CORS only, no redirect logic ─────────────────────────────
  if (pathname.startsWith('/api/')) {
    if (req.method === 'OPTIONS') {
      return new NextResponse(null, { status: 204, headers: corsHeaders(origin) })
    }
    const res = NextResponse.next()
    Object.entries(corsHeaders(origin)).forEach(([k, v]) => res.headers.set(k, v))
    return res
  }

  // ── Page routes ───────────────────────────────────────────────────────────
  const isLoggedIn = !!req.auth
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p))

  if (isLoggedIn && pathname === '/login') {
    return NextResponse.redirect(new URL('/clients', req.url))
  }

  // Authenticated users at root: redirect to /clients.
  // The /clients subscription gate handles the no-sub case and sends them to /pricing.
  if (isLoggedIn && pathname === '/') {
    return NextResponse.redirect(new URL('/clients', req.url))
  }

  if (!isLoggedIn && !isPublic) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  if (isLoggedIn) {
    const role: string = (req.auth as any)?.user?.role || ''
    const userId: string = (req.auth as any)?.user?.id || ''

    // ── Admin role guard ──────────────────────────────────────────────────
    if (pathname.startsWith('/admin')) {
      if (role !== 'admin') {
        return NextResponse.redirect(new URL('/clients', req.url))
      }
      return NextResponse.next()
    }

    // ── Subscription gate ─────────────────────────────────────────────────
    const isSubExempt = SUB_EXEMPT_PATHS.some(
      (p) => pathname === p || pathname.startsWith(p + '/')
    )

    if (!isSubExempt && userId) {
      try {
        const host = req.headers.get('host') || ''
        const protocol = host.startsWith('localhost') ? 'http' : 'https'
        const subGateUrl = `${protocol}://${host}/api/auth/sub-gate?userId=${encodeURIComponent(userId)}`
        const subRes = await fetch(subGateUrl, {
          headers: { 'x-sub-gate-secret': process.env.SUB_GATE_SECRET || '' },
        })
        if (subRes.ok) {
          const { hasAccess } = await subRes.json()
          if (!hasAccess) {
            return NextResponse.redirect(new URL('/pricing', req.url))
          }
        }
      } catch (err) {
        console.error('[proxy] sub-gate fetch failed:', err)
      }
    }
  }

  return NextResponse.next()
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|icon\\.png|apple-icon\\.png|logo\\.png).*)'],
}
