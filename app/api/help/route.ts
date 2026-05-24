import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const SYSTEM_PROMPT = `You are a helpful support assistant for Path4ABA, a clinical documentation platform for ABA professionals (RBTs, BCBAs, and BCaBAs).

Help users with:
- Account issues (login, password reset, profile settings)
- How to generate session notes using AI
- How to upload assessment PDFs to create client profiles
- How to add and manage clients
- Billing questions (trial period, subscription plans, payment)
- How to connect with a BCBA (sharing client code)
- Schedule and missed hours tracking
- BCBA supervision workflow (reviewing notes, supervision notes)

Keep responses concise and practical. If the issue requires account-level access or cannot be resolved through guidance, tell the user to contact hello@path4abaapp.com.`

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

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Support chat is not configured.' }, { status: 503 })
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('[help] Claude API error:', err)
      return NextResponse.json({ error: 'Failed to get response. Please try again.' }, { status: 502 })
    }

    const data = await res.json()
    const reply = data.content?.[0]?.text || ''
    return NextResponse.json({ reply })
  } catch (err) {
    console.error('[help] fetch error:', err)
    return NextResponse.json({ error: 'Network error. Please try again.' }, { status: 500 })
  }
}
