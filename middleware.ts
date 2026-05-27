import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Routes that don't require auth
const PUBLIC_ROUTES = ['/login', '/reset-password', '/pricing', '/privacy', '/terms']

// Routes that require auth but skip the subscription check
const SUBSCRIPTION_SKIP = ['/billing', '/pricing', '/onboarding']

// Routes that require the bcba_students add-on (checked in layout, not here)
// Middleware only does the main subscription check; layout.tsx handles the add-on gate

// Plan slugs: 'trial' | 'rbt' | 'bcba_starter' | 'bcba_pro'
// Client limits per plan are defined in lib/stripe.ts (PLAN_LIMITS).
// Enforcement happens client-side when adding clients because client
// profiles are stored in localStorage, which is inaccessible here.

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const origin = request.headers.get('origin') ?? ''
  const isExtension = origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://')

  // CORS preflight for browser extension requests
  if (isExtension && request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      },
    })
  }

  // Pass API routes through; add CORS header for extension if needed
  if (pathname.startsWith('/api')) {
    const res = NextResponse.next({ request: { headers: request.headers } })
    if (isExtension) {
      res.headers.set('Access-Control-Allow-Origin', origin)
      res.headers.set('Access-Control-Allow-Credentials', 'true')
    }
    return res
  }

  let response = NextResponse.next({
    request: { headers: request.headers },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const isPublic = PUBLIC_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'))

  // 1. Unauthenticated → send to login
  if (!user && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // 2. Authenticated + on login → send to dashboard
  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // 3. Authenticated + not a skip route → check subscription
  const isSubscriptionSkip = SUBSCRIPTION_SKIP.some((r) => pathname === r || pathname.startsWith(r + '/'))

  // Grace period: allow through immediately after Stripe redirects back so the
  // webhook has time to update the DB before the next middleware check.
  // We use a short-lived cookie so the grace period survives client-side navigation.
  const isPostPayment =
    request.nextUrl.searchParams.get('subscription') === 'success' ||
    request.nextUrl.searchParams.get('trial') === 'started'

  if (isPostPayment) {
    response.cookies.set('trial_grace', '1', { maxAge: 300, path: '/', httpOnly: true, sameSite: 'lax' })
  }

  const hasGraceCookie = request.cookies.get('trial_grace')?.value === '1'

  if (user && !isPublic && !isSubscriptionSkip && !isPostPayment && !hasGraceCookie) {
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('status, plan, trial_ends_at, bcba_students_status, bcba_students_trial_ends_at')
      .eq('user_id', user.id)
      .maybeSingle()

    const now = new Date()

    const hasActiveSub =
      sub &&
      (sub.status === 'active' ||
        (sub.status === 'trialing' &&
          sub.trial_ends_at &&
          new Date(sub.trial_ends_at) > now))

    // Users on /bcba-students with only the add-on (no main plan) should pass through
    const isBCBAStudentsRoute = pathname.startsWith('/bcba-students')
    const hasBCBAStudentsAccess =
      sub &&
      (sub.bcba_students_status === 'active' ||
        (sub.bcba_students_status === 'trialing' &&
          sub.bcba_students_trial_ends_at &&
          new Date(sub.bcba_students_trial_ends_at) > now))

    if (!hasActiveSub && !(isBCBAStudentsRoute && hasBCBAStudentsAccess)) {
      if (!sub) {
        // Never signed up for a plan → choose plan first (no payment)
        return NextResponse.redirect(new URL('/onboarding', request.url))
      }
      // Trial expired or subscription canceled → show payment/upgrade screen
      return NextResponse.redirect(new URL('/pricing', request.url))
    }
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
