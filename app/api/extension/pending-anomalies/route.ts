import { NextResponse } from 'next/server'
import { getExtensionAuth } from '@/lib/extensionAuth'
import { prisma } from '@/lib/prisma'

export async function GET(req: Request) {
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  try {
    const [replCount, maladCount] = await Promise.all([
      prisma.replacement_data.count({
        where: { client_id: clientId, is_anomaly: true, anomaly_reviewed: false },
      }),
      prisma.maladaptive_data.count({
        where: { client_id: clientId, is_anomaly: true, anomaly_reviewed: false },
      }),
    ])

    return NextResponse.json({ count: replCount + maladCount })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
