import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Routes that don't require auth
const PUBLIC_ROUTES = ['/login', '/reset-password', '/pricing']

// Routes that require auth but skip the subscription check
// (so users can always access billing to manage/subscribe)
const SUBSCRIPTION_SKIP = ['/billing', '/pricing']

export async function middleware(request: NextRequest) {
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

  const { pathname } = request.nextUrl
  const isPublic = PUBLIC_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'))

  // 1. Unauthenticated → send to login
  if (!user && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // 2. Authenticated + on login → send to clients
  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/clients', request.url))
  }

  // 3. Authenticated + not a skip route → check subscription
  if (user && !isPublic && !SUBSCRIPTION_SKIP.some((r) => pathname === r || pathname.startsWith(r + '/'))) {
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('status, trial_ends_at')
      .eq('user_id', user.id)
      .maybeSingle()

    const now = new Date()
    const hasActiveSub =
      sub &&
      (sub.status === 'active' ||
        (sub.status === 'trialing' &&
          sub.trial_ends_at &&
          new Date(sub.trial_ends_at) > now))

    if (!hasActiveSub) {
      return NextResponse.redirect(new URL('/pricing', request.url))
    }
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api).*)'],
}
