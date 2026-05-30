import { auth } from '@/auth'
import { NextResponse } from 'next/server'

const PUBLIC_PATHS = ['/login', '/pricing', '/privacy', '/terms', '/reset-password']

export const proxy = auth(function proxy(req) {
  const { pathname } = req.nextUrl
  const isLoggedIn = !!req.auth
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p))

  if (isLoggedIn && pathname === '/login') {
    return NextResponse.redirect(new URL('/clients', req.url))
  }

  if (!isLoggedIn && !isPublic) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
})

export const config = {
  // Exclude static assets and all API routes — API routes return 401 themselves.
  // Extension and server-side callers expect JSON 401, not an HTML redirect.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
}
