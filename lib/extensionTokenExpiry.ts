// Sliding IDLE-window expiry for extension bearer tokens. PURE + zero imports so it unit-tests in bare node
// (extensionAuth.ts cannot be imported there — it pulls @/lib/prisma and next/headers). extensionAuth binds
// these to the token row's timestamps.
//
// IDLE window — NOT a fixed token lifetime. A token stays valid as long as it is USED within this window:
// every authenticated call refreshes last_used_at, sliding the window forward, so an ACTIVE RBT is never
// interrupted. Only a token left UNUSED for the whole window is denied — a leaked-then-idle token, or a
// departed user's. 60 days = a client seen ~monthly (≥30-day gaps between sessions stay valid) plus
// vacation/leave headroom, so ordinary intermittent use never trips it while abandoned tokens still die.
export const EXTENSION_TOKEN_IDLE_MS = 60 * 24 * 60 * 60 * 1000

// Milliseconds since the token was last active (last_used_at, or created_at if it was never used). Returns
// NaN when the source date is missing/unparseable — callers treat that as expired (fail closed).
export function tokenIdleMs(
  lastUsedAt: Date | string | null | undefined,
  createdAt: Date | string | null | undefined,
  nowMs: number = Date.now(),
): number {
  const src = lastUsedAt ?? createdAt
  const t = src ? new Date(src).getTime() : NaN
  return nowMs - t
}

// True when the token has been idle longer than the window. FAIL CLOSED: an unparseable/missing date (NaN
// idle) returns true — deny rather than default to allow.
export function isTokenExpired(
  lastUsedAt: Date | string | null | undefined,
  createdAt: Date | string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  const idle = tokenIdleMs(lastUsedAt, createdAt, nowMs)
  if (!Number.isFinite(idle)) return true
  return idle > EXTENSION_TOKEN_IDLE_MS
}
