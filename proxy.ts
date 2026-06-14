import NextAuth from 'next-auth'
import { authConfig } from './auth.config'
import { NextRequest, NextResponse } from 'next/server'

// Edge-safe config — no Prisma/Node.js imports, JWT verification only.
const { auth } = NextAuth(authConfig)

const PUBLIC_PATHS = ['/login', '/pricing', '/privacy', '/terms', '/reset-password']
// Exact-match public paths that can't use startsWith (e.g. '/' would match everything).
const PUBLIC_EXACT = ['/', '/sitemap.xml', '/robots.txt', '/google4328f22bc1963f35.html']

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
  '/settings', // users must reach billing/settings even without a subscription
  '/bcba-students', // layout.tsx handles its own paywall — sub-gate doesn't cover bcba_students_status
  '/sitemap.xml',
  '/robots.txt',
  '/google4328f22bc1963f35.html',
]

// 30-second TTL cache for sub-gate results — avoids a DB round-trip on every page load.
const subCache = new Map<string, { result: boolean; exp: number }>()

const CORS_ALLOWED_ORIGINS = new Set([
  'chrome-extension://imignknofjahdlgopbfkpopcdnffchgk', // production
  'chrome-extension://mkdnlgafciigijkhfefohienddpppgch', // dev (unpacked)
  'https://path4aba.app',
  'http://localhost:3000',
])

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed =
    origin && CORS_ALLOWED_ORIGINS.has(origin) ? origin : 'https://path4aba.app'
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
  const isPublic =
    PUBLIC_EXACT.includes(pathname) ||
    PUBLIC_PATHS.some((p) => pathname.startsWith(p))

  if (isLoggedIn) {
    const earlyRole: string = (req.auth as any)?.user?.role || ''
    const isStudent = earlyRole === 'bcba_student' || earlyRole === 'bcaba_student'

    // Students get their own home — never send them to /clients
    if (isStudent) {
      if (pathname === '/login' || pathname === '/' || pathname === '/clients' || pathname.startsWith('/clients/')) {
        return NextResponse.redirect(new URL('/bcba-students', req.url))
      }
    } else {
      if (pathname === '/login') return NextResponse.redirect(new URL('/dashboard', req.url))
      if (pathname === '/') return NextResponse.redirect(new URL('/dashboard', req.url))
    }
  }

  if (!isLoggedIn && !isPublic) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  if (isLoggedIn) {
    const role: string = (req.auth as any)?.user?.role || ''
    // NextAuth sometimes stores the user ID in token.sub instead of token.id.
    // The session callback maps token.id → session.user.id, but token.sub is the
    // standard JWT subject claim and is always set. Read both and prefer id.
    const rawUser = (req.auth as any)?.user
    const userId: string = rawUser?.id || rawUser?.sub || ''
    console.log('[proxy] pathname:', pathname, 'auth.user.id:', rawUser?.id, 'auth.user.sub:', rawUser?.sub, '→ resolved userId:', userId)

    // ── Admin role guard ──────────────────────────────────────────────────
    if (pathname.startsWith('/admin')) {
      if (role !== 'admin') {
        return NextResponse.redirect(new URL('/dashboard', req.url))
      }
      return NextResponse.next()
    }

    // Admins bypass subscription gate on all routes
    if (role === 'admin') return NextResponse.next()

    // ── Fix 1: post-checkout grace window ────────────────────────────────
    // Stripe redirects before the webhook fires. If the URL carries a
    // checkout success signal, let the user through — the webhook will write
    // the subscription row within seconds and the next request will pass.
    const sp = req.nextUrl.searchParams
    const isPostCheckout =
      sp.get('subscription') === 'success' ||
      sp.get('trial') === 'started'

    if (isPostCheckout) return NextResponse.next()

    // ── Subscription gate ─────────────────────────────────────────────────
    const isSubExempt = SUB_EXEMPT_PATHS.some(
      (p) => pathname === p || pathname.startsWith(p + '/')
    )

    if (!isSubExempt && userId) {
      try {
        const now = Date.now()
        const cached = subCache.get(userId)
        let hasAccess: boolean

        if (cached && cached.exp > now) {
          hasAccess = cached.result
        } else {
          const host = req.headers.get('host') || ''
          const protocol = host.startsWith('localhost') ? 'http' : 'https'
          const subGateUrl = `${protocol}://${host}/api/auth/sub-gate?userId=${encodeURIComponent(userId)}`

          // Retry once after 1500ms — handles Stripe webhook not yet committed.
          const checkAccess = async (): Promise<boolean> => {
            const r = await fetch(subGateUrl)
            if (!r.ok) return true // fail open
            return !!(await r.json()).hasAccess
          }

          hasAccess = await checkAccess()
          console.log('[proxy] userId:', userId, 'pathname:', pathname, 'hasAccess result (attempt 1):', hasAccess)
          if (!hasAccess) {
            await new Promise(resolve => setTimeout(resolve, 1500))
            hasAccess = await checkAccess()
            console.log('[proxy] userId:', userId, 'pathname:', pathname, 'hasAccess result (attempt 2):', hasAccess)
          }

          subCache.set(userId, { result: hasAccess, exp: now + 30_000 })
        }

        if (!hasAccess) {
          console.log('[proxy] REDIRECTING to /pricing — userId:', userId, 'pathname:', pathname)
          return NextResponse.redirect(new URL('/pricing', req.url))
        }
      } catch (err) {
        console.error('[proxy] sub-gate fetch failed:', err)
      }
    }
  }

  return NextResponse.next()
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|icon\\.png|apple-icon\\.png|logo\\.png|login-hero\\.png|sitemap\\.xml|robots\\.txt|google.*\\.html).*)'],
}
