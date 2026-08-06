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
