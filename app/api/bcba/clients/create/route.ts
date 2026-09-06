import { NextResponse } from 'next/server'
import { getExtensionAuth } from '@/lib/extensionAuth'
import { prisma } from '@/lib/prisma'
import { extractAssessment } from '@/lib/extractAssessment'
import { parsePdf, mapToLegacyFormat, saveKnowledgeBase } from '@/lib/assessmentPipeline'
import { buildActivityLists } from '@/lib/curatedActivities'
import { isPdf, MAX_FILE_BYTES, storeClientFile } from '@/lib/clientFiles'
import { emitAdminAlert } from '@/lib/adminAlerts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: Request) {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['bcba', 'bcaba', 'admin'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (user.email !== 'marlonfdz03@gmail.com') {
    const clientCount = await prisma.bcba_clients.count({ where: { bcba_id: user.id } })
    const sub = await prisma.subscriptions.findFirst({
      where: { user_id: user.id },
      select: { plan: true },
    })
    const plan = sub?.plan || ''
    if (!plan.includes('pro') && clientCount >= 15) {
      return NextResponse.json(
        { error: 'Your plan allows up to 15 clients. Upgrade to bcba_pro to add more.' },
        { status: 409 }
      )
    }
  }

  try {
    const formData = await req.formData()
    const pdfFile = formData.get('pdfFile') as File | null
    const clientName = (formData.get('clientName') as string | null)?.trim() || ''
    const primarySetting = (formData.get('primarySetting') as string | null)?.trim() || 'home'

    if (!clientName) return NextResponse.json({ error: 'Client name is required.' }, { status: 400 })

    // Curated activity baseline is UNCONDITIONAL — a client created here WITHOUT an assessment (pdfFile is
    // optional) must still get the curated home/school lists from day one (Marlon's rule: every child,
    // always). When a PDF is present the mapToLegacyFormat path below overwrites this with curated + the
    // assessment's split activities.
    let clinicalProfile: Record<string, any> = { name: clientName, ...buildActivityLists() }
    let internalCode = `BCBA-${Date.now()}`

    let fileBuffer: Buffer | null = null
    if (pdfFile) {
      fileBuffer = Buffer.from(await pdfFile.arrayBuffer())
      if (!isPdf(fileBuffer)) return NextResponse.json({ error: 'Only PDF files are supported.' }, { status: 415 })
      if (fileBuffer.length > MAX_FILE_BYTES) return NextResponse.json({ error: 'File is too large (max 15 MB).' }, { status: 413 })
      const text = await parsePdf(fileBuffer)
      if (text.trim()) {
        const extracted = await extractAssessment(text.slice(0, 90000))
        saveKnowledgeBase(extracted).catch(err =>
          console.error('[bcba/clients/create] kb save error:', err)
        )
        const mapped = mapToLegacyFormat(extracted, [clientName])
        clinicalProfile = { ...(mapped as any), name: clientName }
        internalCode = extracted.clientCode || internalCode
      }
    }

    // Create the client and connect the BCBA atomically. The SOURCE PDF is stored AFTER this commits, NOT
    // inside the transaction: the client commits first, so the file can never be orphaned, and a file-storage
    // failure can never cost the client (previously storeClientFile ran in the transaction, so a bytea write
    // failure rolled back the whole creation — the exact failure mode we now avoid). See the fail-soft store
    // below.
    const client = await prisma.$transaction(async (tx) => {
      const c = await tx.clients.create({
        data: {
          rbt_id: null,
          internal_code: internalCode,
          clinical_profile: clinicalProfile,
          primary_setting: primarySetting,
          created_by: user.id,
        },
      })
      await tx.bcba_clients.create({
        data: {
          bcba_id: user.id,
          client_id: c.id,
          connected_at: new Date(),
        },
      })
      return c
    })

    // FAIL-SOFT source-PDF store, after the client committed. The client is more valuable than the file: a
    // storage failure only degrades reprocessing (until re-upload), it never fails the request.
    if (pdfFile && fileBuffer) {
      try {
        await storeClientFile(client.id, user.id, pdfFile, fileBuffer)
      } catch (fileErr: any) {
        console.error('[bcba/clients/create] source PDF store failed (client kept):', fileErr?.message)
        await emitAdminAlert({
          source: 'system', type: 'assessment.pdf_store_failed', severity: 'warning',
          payload: { client_id: client.id, error: fileErr?.message ?? String(fileErr), route: 'bcba/clients/create' },
        })
      }
    }

    return NextResponse.json({ clientId: client.id, clientName, message: 'Client created' })
  } catch (err: any) {
    console.error('[bcba/clients/create]', err)
    return NextResponse.json({ error: 'Failed to create client', details: err.message }, { status: 500 })
  }
}
