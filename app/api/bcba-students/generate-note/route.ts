import { NextResponse } from 'next/server'
import OpenAI from 'openai'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let body: { activityType?: string; contactType?: string; setting?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { activityType = 'unrestricted', contactType = 'none', setting = '' } = body

  const prompt = `Generate a BACB-compliant fieldwork session description for a BCBA student trainee.
Activity type: ${activityType}
Contact type: ${contactType}
Setting: ${setting}
Write 2-3 sentences. Use professional behavior-analytic language. Reference client services without using client names. Do not use mentalistic language. Do not fabricate specific data or numbers.`

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
    })
    const note = response.choices[0]?.message?.content || ''
    return NextResponse.json({ note })
  } catch (err: any) {
    console.error('[generate-note] OpenAI error:', err?.message)
    return NextResponse.json({ error: 'Failed to generate note' }, { status: 500 })
  }
}
