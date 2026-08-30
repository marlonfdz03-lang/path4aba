import { NextRequest, NextResponse } from 'next/server'
import { getExtensionAuth } from '@/lib/extensionAuth'
import { prisma } from '@/lib/prisma'
import { extractAssessment } from '@/lib/extractAssessment'
import { parsePdf, mapToLegacyFormat, saveKnowledgeBase } from '@/lib/assessmentPipeline'
import { storeClientFile } from '@/lib/clientFiles'
import { emitAdminAlert } from '@/lib/adminAlerts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['rbt', 'bcba', 'bcaba', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const clientName = (formData.get('name') as string | null)?.trim() || ''

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (!clientName) return NextResponse.json({ error: 'Client name is required.' }, { status: 400 })

    // Check client limit based on subscription (skipped for admin)
    if (user.email !== 'marlonfdz03@gmail.com') {
      const existingClients = await prisma.clients.count({ where: { rbt_id: user.id } })
      const sub = await prisma.subscriptions.findFirst({
        where: { user_id: user.id },
        select: { plan: true },
      })
      const planLimits: Record<string, number> = { rbt_1: 1, rbt_2: 2 }
      const limit = planLimits[sub?.plan || ''] ?? 1
      if (existingClients >= limit) {
        return NextResponse.json({
          error: `Your plan allows ${limit} client${limit === 1 ? '' : 's'}. Upgrade to add more.`,
        }, { status: 409 })
      }
    }

    // Parse PDF — same pdf2json pipeline as extract-assessment
    const buffer = Buffer.from(await file.arrayBuffer())
    const text = await parsePdf(buffer)

    if (!text.trim()) {
      return NextResponse.json({ error: 'PDF extraction returned empty text.' }, { status: 400 })
    }

    // Extract + normalize — identical to extract-assessment/route.ts
    const extracted = await extractAssessment(text.slice(0, 90000))
    saveKnowledgeBase(extracted).catch(err => console.error('[rbt/clients/create] kb save error:', err))
    const clinicalProfile = mapToLegacyFormat(extracted)

    // Generate internal code
    const internalCode = extracted.clientCode || `RBT-${Date.now()}`

    // Create client
    const client = await prisma.clients.create({
      data: {
        rbt_id: user.id,
        internal_code: internalCode,
        clinical_profile: { ...(clinicalProfile as any), name: clientName },
        diagnosis: Array.isArray(extracted.diagnosis)
          ? extracted.diagnosis.join(', ')
          : (extracted.diagnosis || null),
        primary_setting: extracted.setting || 'home',
      },
    })

    // Store the SOURCE PDF for reprocessing — FAIL-SOFT, AFTER the client has committed. The client is more
    // valuable than the file: a storage failure must never cost the client (it only degrades reprocessing
    // until the RBT re-uploads). Because the client already exists, the file can never be orphaned.
    try {
      await storeClientFile(client.id, user.id, file, buffer)
    } catch (fileErr: any) {
      console.error('[rbt/clients/create] source PDF store failed (client kept):', fileErr?.message)
      await emitAdminAlert({
        source: 'system', type: 'assessment.pdf_store_failed', severity: 'warning',
        payload: { client_id: client.id, error: fileErr?.message ?? String(fileErr), route: 'rbt/clients/create' },
      })
    }

    return NextResponse.json({
      success: true,
      clientId: client.id,
      internalCode: client.internal_code,
      profile: clinicalProfile,
    })
  } catch (err: any) {
    console.error('[rbt/clients/create]', err)
    return NextResponse.json({ error: 'Failed to create client', details: err.message }, { status: 500 })
  }
}
