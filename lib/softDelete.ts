// Soft-delete read filter for fieldwork_sessions. Kept prisma-free so it is unit-testable without loading
// the DB client (see lib/softDelete.test.mjs). The Prisma client extension that applies it lives in
// lib/prisma.ts — this file is only the pure arg transform, because THAT is the piece whose correctness
// silently protects signed-month totals (recalculateMonth's findMany relies entirely on it).

// Inject `deleted_at: null` into a read's `where`, preserving existing conditions. If the caller already
// set `deleted_at` explicitly (e.g. a maintenance/restore query targeting deleted rows), it is left alone.
export function withNotDeleted(where: Record<string, any> | undefined | null): Record<string, any> {
  if (where && Object.prototype.hasOwnProperty.call(where, 'deleted_at')) return where
  return { ...(where || {}), deleted_at: null }
}

// findUnique support for a model whose reads USE narrow selects (unlike fieldwork_sessions). A unique read's
// `where` accepts only unique fields, so `deleted_at: null` cannot be injected there — the filter has to run on
// the returned row. But if the caller's `select` omits `deleted_at`, the row won't carry the flag and the
// post-filter is blind → an archived record leaks. So: when a `select` is present and omits `deleted_at`,
// force-include it (returning `injected: true` so we can strip it back off), then filter on the result.
export function prepareUniqueSelect(args: any): { args: any; injected: boolean } {
  if (args?.select && !args.select.deleted_at) {
    return { args: { ...args, select: { ...args.select, deleted_at: true } }, injected: true }
  }
  return { args, injected: false }
}

// Apply the archived check to a unique-read result. Returns null (or throws, for *OrThrow) when the row is
// soft-deleted; strips the `deleted_at` we force-injected so the caller's projection shape is unchanged.
export function finalizeUniqueRow<T extends Record<string, any> | null>(
  row: T,
  injected: boolean,
  opts: { throwOnDeleted?: boolean } = {},
): T | null {
  if (row && (row as any).deleted_at != null) {
    if (opts.throwOnDeleted) throw new Error('record not found (soft-deleted)')
    return null
  }
  if (row && injected) {
    const { deleted_at, ...rest } = row as any
    return rest as T
  }
  return row
}
