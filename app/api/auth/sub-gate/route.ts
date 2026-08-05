import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// INTERNAL endpoint, called server-to-server by proxy.ts to check subscription access. Returns
// { hasAccess: boolean } only — never PHI or subscription details.
//
// ⚠️ DO NOT add a proxy→sub-gate shared secret here. That exact mechanism (proxy sends
// process.env.SUB_GATE_SECRET in an `x-sub-gate-secret` header; this route compares it) was implemented
// and REMOVED in commit f6e2d91 (2026-06-06): "remove SUB_GATE_SECRET check — Edge runtime can't access
// it, was blocking all users." proxy.ts runs in the Edge runtime; the build inlines only NEXT_PUBLIC_*
// vars (see .github/workflows/azure-deploy.yml), so the edge proxy read the custom runtime env var as
// empty, sent an empty secret, and every request was denied — a full-user outage. Re-implementing it
// against this deploy would reproduce that outage. (SUB_GATE_SECRET is now dead in both .env.local and
// the Azure App settings — a stray real-looking value that is safe to delete; it is load-bearing nowhere.)
//
// CALLER AUTHENTICATION IS THEREFORE DEFERRED (audit priority-list item #10). Its severity is LOW — the
// response is a bare boolean and userId is a non-guessable cuid/uuid — so an external probe learns only a
// subscription-access flag for an id it must already know. The correct fix is to validate a forwarded
// session token INSIDE this node route via NEXTAUTH_SECRET (runtime-readable in the node runtime), NOT a
// secret the edge proxy has to send. That is a separate, non-blocking follow-up.
//
// This commit hardens only what is safe node-side: fail-closed on error, no owner-email bypass, no PII logs.
export async function GET(req: NextRequest) {
  const userId = new URL(req.url).searchParams.get('userId')
  if (!userId) {
    return NextResponse.json({ hasAccess: false })
  }

  try {
    const sub = await prisma.subscriptions.findFirst({
      where: { user_id: userId },
      select: { status: true, trial_ends_at: true, current_period_ends_at: true },
    })

    if (!sub) {
      return NextResponse.json({ hasAccess: false })
    }

    const now = new Date()
    const hasAccess =
      sub.status === 'active' ||
      (sub.status === 'trialing' && sub.trial_ends_at != null && new Date(sub.trial_ends_at) > now) ||
      (sub.status === 'canceled' && sub.current_period_ends_at != null && new Date(sub.current_period_ends_at) > now)

    return NextResponse.json({ hasAccess: !!hasAccess })
  } catch {
    // Fail CLOSED: a DB error DENIES rather than grants (previously this returned hasAccess:true — fail
    // open). The proxy retries once after 1500ms, so a transient blip self-heals; a sustained outage
    // bounces non-admin users to /pricing until it recovers. Admins are unaffected (proxy bypasses the
    // sub-gate for role==='admin' before it is ever called). Message only — never the row or any PII.
    console.error('[sub-gate] subscription lookup failed — denying (fail closed)')
    return NextResponse.json({ hasAccess: false })
  }
}
