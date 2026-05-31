import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Chrome extension origins are unique per installation (chrome-extension://<id>/).
// We echo the Origin back rather than using '*' because the requests include
// credentials (Authorization header), and CORS disallows '*' with credentials.
function isTrustedOrigin(origin: string | null): boolean {
  if (!origin) return false
  if (origin.startsWith('chrome-extension://')) return true
  if (origin === 'https://path4aba.app') return true
  return false
}

export function middleware(req: NextRequest) {
  const origin = req.headers.get('Origin')
  const trusted = isTrustedOrigin(origin)

  // Handle CORS preflight. The static headers in next.config.ts cover Methods,
  // Headers, and Credentials — this adds the dynamic per-origin Allow-Origin.
  if (req.method === 'OPTIONS') {
    const res = new NextResponse(null, { status: 204 })
    if (trusted && origin) {
      res.headers.set('Access-Control-Allow-Origin', origin)
      res.headers.set('Access-Control-Allow-Credentials', 'true')
    }
    return res
  }

  // Add Access-Control-Allow-Origin to all API responses for trusted origins.
  const res = NextResponse.next()
  if (trusted && origin) {
    res.headers.set('Access-Control-Allow-Origin', origin)
    res.headers.set('Access-Control-Allow-Credentials', 'true')
  }
  return res
}

// Only run on API routes — do not gate page routes here.
// Each API route calls getExtensionAuth() directly for auth.
export const config = {
  matcher: ['/api/:path*'],
}
