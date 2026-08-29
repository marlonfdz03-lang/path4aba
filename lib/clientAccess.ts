// THE ONE cross-tenant ownership rule, as a pure function with ZERO imports so it is unit-testable in
// bare node (the `@/lib/prisma` alias does not resolve there). clientFiles.ts binds the real DB lookup to
// `ownsFn`; the web routes (auth()) and the extension routes (getExtensionAuth()) both go through here, so
// there is exactly one implementation — no divergent inline copies.
//
// Decision:
//   - no clientId       -> DENY everyone, admin included. A null/nobody-owned target (e.g. an id-based row
//                          whose client_id is NULL) is not a row anyone may touch.
//   - role 'admin'      -> ALLOW (never calls ownsFn — admin passes even if the lookup would throw).
//   - no principal id   -> DENY.
//   - otherwise         -> ownsFn(id, clientId): assigned RBT or connected BCBA.
//   - ownsFn throws     -> DENY (fail closed). An ownership lookup that errors must never default to allow.
export async function principalCanAccessClient(
  principal: { id?: string | null; role?: string | null } | null | undefined,
  clientId: string | null | undefined,
  ownsFn: (userId: string, clientId: string) => Promise<boolean>,
): Promise<boolean> {
  try {
    if (!clientId) return false
    if (principal?.role === 'admin') return true
    const userId = principal?.id
    if (!userId) return false
    return await ownsFn(userId, clientId)
  } catch {
    return false
  }
}
