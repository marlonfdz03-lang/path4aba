import { NextResponse } from 'next/server'
import { getExtensionAuth } from '@/lib/extensionAuth'
import { prisma } from '@/lib/prisma'
import { extractAssessment } from '@/lib/extractAssessment'
import { parsePdf, mapToLegacyFormat, saveKnowledgeBase } from '@/lib/assessmentPipeline'

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

    let clinicalProfile: Record<string, any> = { name: clientName }
    let internalCode = `BCBA-${Date.now()}`

    if (pdfFile) {
      const buffer = Buffer.from(await pdfFile.arrayBuffer())
      const text = await parsePdf(buffer)
      if (text.trim()) {
        const extracted = await extractAssessment(text.slice(0, 90000))
        saveKnowledgeBase(extracted).catch(err =>
          console.error('[bcba/clients/create] kb save error:', err)
        )
        const mapped = mapToLegacyFormat(extracted)
        clinicalProfile = { ...(mapped as any), name: clientName }
        internalCode = extracted.clientCode || internalCode
      }
    }

    const client = await prisma.clients.create({
      data: {
        rbt_id: null,
        internal_code: internalCode,
        clinical_profile: clinicalProfile,
        primary_setting: primarySetting,
        created_by: user.id,
      },
    })

    await prisma.bcba_clients.create({
      data: {
        bcba_id: user.id,
        client_id: client.id,
        connected_at: new Date(),
      },
    })

    return NextResponse.json({ clientId: client.id, clientName, message: 'Client created' })
  } catch (err: any) {
    console.error('[bcba/clients/create]', err)
    return NextResponse.json({ error: 'Failed to create client', details: err.message }, { status: 500 })
  }
}
