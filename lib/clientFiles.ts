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
  await tx.client_files.create({
    data: {
      client_id: clientId,
      uploaded_by: uploadedBy,
      filename: (file.name || 'assessment.pdf').slice(0, 255),
      mime_type: file.type || 'application/pdf',
      size_bytes: buffer.length,
      data: buffer,
    },
  })
}
