import NextAuth from 'next-auth'
import { authConfig } from './auth.config'
import { NextRequest, NextResponse } from 'next/server'

// Edge-safe auth instance (no DB, no bcrypt) — only verifies the JWT cookie.
const { auth } = NextAuth(authConfig)

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

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const origin = req.headers.get('origin')

  // ── API routes: CORS only, no auth redirect ──────────────────────────────
  // API routes guard themselves via getExtensionAuth() / auth().
  if (pathname.startsWith('/api/')) {
    // Respond to preflight immediately — never pass OPTIONS to route handlers.
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

  // ── Page routes: redirect to /login if no session ────────────────────────
  const session = await auth()
  if (!session?.user && pathname !== '/login') {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  return NextResponse.next()
}

export const config = {
  // Exclude static assets. Include everything else (api + pages).
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
