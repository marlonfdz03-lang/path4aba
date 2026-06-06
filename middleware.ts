import NextAuth from 'next-auth'
import { authConfig } from './auth.config'
import { NextRequest, NextResponse } from 'next/server'

// Use the edge-safe config (no Prisma/Node.js imports) for JWT verification.
const { auth } = NextAuth(authConfig)

// Routes that are publicly accessible (no auth required).
const PUBLIC_PATHS = ['/login', '/pricing', '/privacy', '/terms', '/reset-password']

// Routes where an authenticated user with NO active subscription can still land.
// Everything else redirects to /onboarding if subscription is missing/expired.
const SUB_EXEMPT_PATHS = [
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

export default auth(async function middleware(req: NextRequest & { auth: any }) {
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

  // Redirect logged-in user away from /login
  if (isLoggedIn && pathname === '/login') {
    return NextResponse.redirect(new URL('/clients', req.url))
  }

  // Require auth for all non-public pages
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
      // Admins bypass subscription check
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
            return NextResponse.redirect(new URL('/onboarding', req.url))
          }
        }
        // If sub-gate is unreachable, fail open (don't lock users out)
      } catch (err) {
        console.error('[middleware] sub-gate fetch failed:', err)
      }
    }
  }

  return NextResponse.next()
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|icon\\.png|apple-icon\\.png|logo\\.png).*)'],
}
