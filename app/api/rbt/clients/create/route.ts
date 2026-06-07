import { NextRequest, NextResponse } from 'next/server'
import { getExtensionAuth } from '@/lib/extensionAuth'
import { prisma } from '@/lib/prisma'
import { buildClinicalProfile } from '@/lib/buildClinicalProfile'
import { extractAssessment } from '@/lib/extractAssessment'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'rbt') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    // Check client limit based on subscription
    const existingClients = await prisma.clients.count({ where: { rbt_id: user.id } })
    const sub = await prisma.subscriptions.findFirst({
      where: { user_id: user.id },
      select: { plan: true }
    })

    // Plan keys match lib/stripe.ts PLAN_LIMITS: rbt_1 = 1 client, rbt_2 = 2 clients
    const planLimits: Record<string, number> = {
      'rbt_1': 1,
      'rbt_2': 2,
    }
    const limit = planLimits[sub?.plan || ''] ?? 1
    if (existingClients >= limit) {
      return NextResponse.json({
        error: `Your plan allows ${limit} client${limit === 1 ? '' : 's'}. Upgrade to add more.`
      }, { status: 409 })
    }

    // Extract assessment from PDF
    const buffer = Buffer.from(await file.arrayBuffer())
    const pdfParse = require('pdf-parse')
    const pdfData = await pdfParse(buffer)
    const extracted = await extractAssessment(pdfData.text)
    const clinicalProfile = buildClinicalProfile(extracted)

    // Generate internal code from clientCode or random
    const internalCode = extracted.clientCode || `RBT-${Date.now()}`

    // Create client
    const client = await prisma.clients.create({
      data: {
        rbt_id: user.id,
        internal_code: internalCode,
        clinical_profile: clinicalProfile as any,
        diagnosis: Array.isArray(extracted.diagnosis) ? extracted.diagnosis.join(', ') : (extracted.diagnosis || null),
        primary_setting: extracted.setting || 'home',
      }
    })

    return NextResponse.json({
      success: true,
      clientId: client.id,
      internalCode: client.internal_code,
      profile: clinicalProfile
    })
  } catch (err: any) {
    console.error('[rbt/clients/create]', err)
    return NextResponse.json({ error: 'Failed to create client', details: err.message }, { status: 500 })
  }
}
