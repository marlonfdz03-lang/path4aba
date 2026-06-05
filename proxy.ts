import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

const PUBLIC_PATHS = ['/login', '/pricing', '/privacy', '/terms', '/reset-password']

function corsHeaders(origin: string | null): Record<string, string> {
  // Echo the exact origin back for chrome-extension:// and known web origins.
  // Must be exact (not *) because credentials are involved.
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
    'Vary': 'Origin',
  }
}

export const proxy = auth(function proxy(req: NextRequest & { auth: any }) {
  const { pathname } = req.nextUrl
  const origin = req.headers.get('origin')

  // ── API routes: CORS only, no auth redirect ──────────────────────────────
  // API routes guard themselves via getExtensionAuth() / auth().
  if (pathname.startsWith('/api/')) {
    if (req.method === 'OPTIONS') {
      return new NextResponse(null, {
        status: 204,
        headers: corsHeaders(origin),
      })
    }
    const res = NextResponse.next()
    Object.entries(corsHeaders(origin)).forEach(([k, v]) => res.headers.set(k, v))
    return res
  }

  // ── Page routes: redirect based on auth state ────────────────────────────
  const isLoggedIn = !!req.auth
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p))

  if (isLoggedIn && pathname === '/login') {
    return NextResponse.redirect(new URL('/clients', req.url))
  }

  if (!isLoggedIn && !isPublic) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  if (isLoggedIn && pathname.startsWith('/admin')) {
    const role = (req.auth as any)?.user?.role
    if (role !== 'admin') {
      return NextResponse.redirect(new URL('/clients', req.url))
    }
  }
})

export const config = {
  // Include API routes (for CORS). Exclude only static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
