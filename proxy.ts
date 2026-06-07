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
  '/bcba-students', // layout.tsx handles its own paywall — sub-gate doesn't cover bcba_students_status
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

  if (isLoggedIn) {
    const earlyRole: string = (req.auth as any)?.user?.role || ''
    const isStudent = earlyRole === 'bcba_student' || earlyRole === 'bcaba_student'

    // Students get their own home — never send them to /clients
    if (isStudent) {
      if (pathname === '/login' || pathname === '/' || pathname === '/clients' || pathname.startsWith('/clients/')) {
        return NextResponse.redirect(new URL('/bcba-students', req.url))
      }
    } else {
      if (pathname === '/login') return NextResponse.redirect(new URL('/clients', req.url))
      if (pathname === '/') return NextResponse.redirect(new URL('/clients', req.url))
    }
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
        const host = req.headers.get('host') || ''
        const protocol = host.startsWith('localhost') ? 'http' : 'https'
        const subGateUrl = `${protocol}://${host}/api/auth/sub-gate?userId=${encodeURIComponent(userId)}`

        // Fix 2: retry once after 1500ms if hasAccess is false —
        // handles the case where the webhook hasn't committed yet.
        const checkAccess = async (): Promise<boolean> => {
          const r = await fetch(subGateUrl)
          if (!r.ok) return true // fail open
          return !!(await r.json()).hasAccess
        }

        let hasAccess = await checkAccess()
        if (!hasAccess) {
          await new Promise(resolve => setTimeout(resolve, 1500))
          hasAccess = await checkAccess()
        }

        if (!hasAccess) {
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
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|icon\\.png|apple-icon\\.png|logo\\.png).*)'],
}
