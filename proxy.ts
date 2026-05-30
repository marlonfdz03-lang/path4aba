import { auth } from '@/auth'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Routes that don't require auth
const PUBLIC_ROUTES = ['/login', '/reset-password', '/pricing', '/privacy', '/terms']

// Routes that require auth but skip the subscription check
const SUBSCRIPTION_SKIP = ['/billing', '/pricing', '/onboarding']

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const origin = request.headers.get('origin') ?? ''
  const isExtension = origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://')

  // ── CORS preflight ──────────────────────────────────────────────────────────
  if (pathname.startsWith('/api') && request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': isExtension ? origin : '*',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin',
      },
    })
  }

  // ── API pass-through ────────────────────────────────────────────────────────
  if (pathname.startsWith('/api')) {
    const res = NextResponse.next({ request: { headers: request.headers } })
    if (isExtension) {
      res.headers.set('Access-Control-Allow-Origin', origin)
      res.headers.set('Access-Control-Allow-Credentials', 'true')
      res.headers.set('Vary', 'Origin')
    }
    return res
  }

  // ── Auth check (NextAuth replaces Supabase here) ────────────────────────────
  const session = await auth()
  const user = session?.user

  const isPublic = PUBLIC_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'))

  // 1. Unauthenticated → send to login
  if (!user && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // 2. Authenticated + on login → send to dashboard
  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // ── Subscription gate (still queries Supabase — migration later) ───────────
  const isSubscriptionSkip = SUBSCRIPTION_SKIP.some((r) => pathname === r || pathname.startsWith(r + '/'))

  const isPostPayment =
    request.nextUrl.searchParams.get('subscription') === 'success' ||
    request.nextUrl.searchParams.get('trial') === 'started'

  let response = NextResponse.next({ request: { headers: request.headers } })

  if (isPostPayment) {
    response.cookies.set('trial_grace', '1', { maxAge: 300, path: '/', httpOnly: true, sameSite: 'lax' })
  }

  const hasGraceCookie = request.cookies.get('trial_grace')?.value === '1'

  if (user && !isPublic && !isSubscriptionSkip && !isPostPayment && !hasGraceCookie) {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: sub } = await supabase
      .from('subscriptions')
      .select('status, plan, trial_ends_at, bcba_students_status, bcba_students_trial_ends_at')
      .eq('user_id', (user as any).id)
      .maybeSingle()

    const now = new Date()

    const hasActiveSub =
      sub &&
      (sub.status === 'active' ||
        (sub.status === 'trialing' &&
          sub.trial_ends_at &&
          new Date(sub.trial_ends_at) > now))

    const isBCBAStudentsRoute = pathname.startsWith('/bcba-students')
    const hasBCBAStudentsAccess =
      sub &&
      (sub.bcba_students_status === 'active' ||
        (sub.bcba_students_status === 'trialing' &&
          sub.bcba_students_trial_ends_at &&
          new Date(sub.bcba_students_trial_ends_at) > now))

    if (!hasActiveSub && !(isBCBAStudentsRoute && hasBCBAStudentsAccess)) {
      if (!sub) {
        return NextResponse.redirect(new URL('/onboarding', request.url))
      }
      return NextResponse.redirect(new URL('/pricing', request.url))
    }
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
