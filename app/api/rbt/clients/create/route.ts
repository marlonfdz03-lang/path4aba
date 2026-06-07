import { NextRequest, NextResponse } from 'next/server'
import { getExtensionAuth } from '@/lib/extensionAuth'
import { prisma } from '@/lib/prisma'
import { extractAssessment } from '@/lib/extractAssessment'
import { parsePdf, mapToLegacyFormat, saveKnowledgeBase } from '@/lib/assessmentPipeline'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['rbt', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const clientName = (formData.get('name') as string | null)?.trim() || ''

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (!clientName) return NextResponse.json({ error: 'Client name is required.' }, { status: 400 })

    // Check client limit based on subscription
    const existingClients = await prisma.clients.count({ where: { rbt_id: user.id } })
    const sub = await prisma.subscriptions.findFirst({
      where: { user_id: user.id },
      select: { plan: true },
    })

    // Plan keys match lib/stripe.ts PLAN_LIMITS: rbt_1 = 1 client, rbt_2 = 2 clients
    const planLimits: Record<string, number> = { rbt_1: 1, rbt_2: 2 }
    const limit = planLimits[sub?.plan || ''] ?? 1
    if (existingClients >= limit) {
      return NextResponse.json({
        error: `Your plan allows ${limit} client${limit === 1 ? '' : 's'}. Upgrade to add more.`,
      }, { status: 409 })
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
