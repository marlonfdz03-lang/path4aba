import { prisma } from '@/lib/prisma'

// Shared helpers for storing/serving uploaded source assessment PDFs (client_files table).
// ⚠️ These persist the FULL, UN-REDACTED source document (name, DOB, possibly Medicaid ID) as bytea —
// the first place un-redacted source PHI enters the database. See the client_files model comment.

export const MAX_FILE_BYTES = 15 * 1024 * 1024 // 15 MB

// A real PDF: the authoritative check is the %PDF- magic header (browser-supplied MIME is spoofable).
export function isPdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString('latin1') === '%PDF-'
}

// ownership check — copies the timeline pattern (rbt_id OR bcba_clients). NOT the broken clients/[id]
// session-only shape. Returns true only if the user is the client's RBT or a connected BCBA.
export async function userOwnsClient(userId: string, clientId: string): Promise<boolean> {
  const [asRbt, asBcba] = await Promise.all([
    prisma.clients.findFirst({ where: { id: clientId, rbt_id: userId }, select: { id: true } }),
    prisma.bcba_clients.findFirst({ where: { bcba_id: userId, client_id: clientId }, select: { id: true } }),
  ])
  return !!(asRbt || asBcba)
}

// PHI/ownership gate for a client's record (read, edit, delete). Accessible only to a user who OWNS the
// client — its assigned RBT or a connected BCBA (userOwnsClient) — or an admin. Fails CLOSED: any other
// authenticated user is refused (the callers return 403 and touch no data). Shared so every route that
// touches a client's clinical_profile enforces the SAME gate (the security fix + the behavior-functions
// write). Same hole-class already closed on the assessment route.
export async function canAccessClient(session: any, clientId: string): Promise<boolean> {
  if ((session?.user as any)?.role === 'admin') return true
  const userId = (session?.user as any)?.id as string | undefined
  if (!userId) return false
  return userOwnsClient(userId, clientId)
}

// Persist an uploaded source document as a client_files row. Caller MUST have already verified the client
// exists and (for the write path) that the upload was authorized. Pass a transaction client (`tx`) from a
// create flow so the file and the new client commit atomically; defaults to the shared prisma client.
export async function storeClientFile(
  clientId: string,
  uploadedBy: string,
  file: File,
  buffer: Buffer,
  tx: any = prisma,
): Promise<void> {
  // Store the new PDF FIRST (superseded_at defaults NULL = current), THEN soft-delete the client's prior
  // current file(s) — mark, never delete: the bytes are RETAINED for the 7-year retention window (the
  // /files list hides superseded rows; download-by-id still reaches them). Store-first ordering means there
  // is never a window with no current file; a failed updateMany leaves a stale extra "current" the next
  // upload corrects — never data loss. Keys on client_id only; one current assessment per client.
  const created = await tx.client_files.create({
    data: {
      client_id: clientId,
      uploaded_by: uploadedBy,
      filename: (file.name || 'assessment.pdf').slice(0, 255),
      mime_type: file.type || 'application/pdf',
      size_bytes: buffer.length,
      data: buffer,
    },
    select: { id: true },
  })
  await tx.client_files.updateMany({
    where: { client_id: clientId, id: { not: created.id }, superseded_at: null },
    data: { superseded_at: new Date() },
  })
}
