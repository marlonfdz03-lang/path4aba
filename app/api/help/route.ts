import { NextResponse } from 'next/server'
import OpenAI from 'openai'

export const dynamic = 'force-dynamic'

const SYSTEM_PROMPT = `You are a helpful support assistant for Path4ABA, a clinical documentation platform for ABA professionals (RBTs, BCBAs, BCaBAs).
Help users with: how to generate session notes, how to upload assessments, how to add clients, how to connect with a BCBA using a client code, billing and subscription questions, schedule tracking, how to refine notes, account issues.
Keep answers short and clear.
If you cannot resolve the issue, tell them to contact hello@path4abaapp.com`

export async function POST(req: Request) {
  let body: { messages?: { role: string; content: string }[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { messages } = body
  if (!messages || !Array.isArray(messages)) {
    return NextResponse.json({ error: 'Missing messages' }, { status: 400 })
  }

  try {
    const openai = new OpenAI({
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/gpt-4o`,
      defaultQuery: { 'api-version': '2024-11-20' },
      defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY },
    })

    const response = await openai.chat.completions.create({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages as OpenAI.Chat.ChatCompletionMessageParam[],
      ],
      max_tokens: 500,
    })

    const reply = response.choices[0]?.message?.content || ''
    return NextResponse.json({ reply })
  } catch (err: any) {
    console.error('[help] OpenAI error:', err?.message)
    return NextResponse.json({ error: 'Failed to get response. Please try again.' }, { status: 500 })
  }
}
