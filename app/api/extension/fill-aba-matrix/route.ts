import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import OpenAI from 'openai'

const client = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/gpt-4o`,
  defaultQuery: { 'api-version': '2025-01-01-preview' },
  defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY },
})

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { note, questions } = await req.json()
  if (!note || !questions?.length) return NextResponse.json({ error: 'Missing note or questions' }, { status: 400 })

  const prompt = `You are a clinical ABA documentation assistant. Based on the session note provided, answer each form question concisely and clinically. Return ONLY a JSON object where each key is the question index (0, 1, 2...) and each value is the answer string. Do not include explanations or markdown.

SESSION NOTE:
${note}

FORM QUESTIONS:
${questions.map((q: string, i: number) => `${i}: ${q}`).join('\n')}

Rules:
- Answer each question based ONLY on information in the note
- Keep answers concise (1-3 sentences max)
- Use clinical ABA language
- For Yes/No questions, answer only "Yes" or "No"
- For "Evidenced by" fields, describe observable behaviors from the note
- For "How did client present" fields, describe presentation at start/end
- For "Participation" fields, describe engagement level
- For "Behavior" fields, use the exact behavior name from the note
- For "Function" fields, identify attention/escape/tangible/automatic
- For "Antecedent" fields, describe what triggered the behavior
- For "Interventions" fields, list the interventions used
- For "Result" fields, describe the outcome
- NEVER include client name — use "the client" only
- NEVER include numbers or trial counts`

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    max_tokens: 2000,
  })

  const text = response.choices[0]?.message?.content || '{}'
  const clean = text.replace(/```json|```/g, '').trim()

  try {
    const answers = JSON.parse(clean)
    return NextResponse.json({ answers })
  } catch {
    return NextResponse.json({ error: 'Failed to parse AI response', raw: text }, { status: 500 })
  }
}
