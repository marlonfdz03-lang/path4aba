import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { supabaseServer } from '@/lib/supabaseServer'
import OpenAI from 'openai'
import { build97153XPPrompt } from '@/app/prompts/supervision97153xpPrompt'

const openai = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/gpt-4o`,
  defaultQuery: { 'api-version': '2024-12-01-preview' },
  defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY },
})

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const cookieStore = await cookies()
  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    clientId?: string
    sessionDate?: string
    location?: string
    rbtSessionContext?: { empty: boolean; behaviors?: string[]; skills?: string[]; interventions?: string[]; activities?: string[] } | null
    bcbaActionsPerformed?: string
    treatmentIntegrityConcerns?: string
    clientResponseDuringOverlap?: string
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { clientId, sessionDate, location, rbtSessionContext, bcbaActionsPerformed, treatmentIntegrityConcerns, clientResponseDuringOverlap } = body

  if (!clientId || !sessionDate) {
    return NextResponse.json({ error: 'Missing clientId or sessionDate' }, { status: 400 })
  }

  // Verify BCBA owns this client relationship
  const { data: connection } = await supabaseServer
    .from('bcba_clients')
    .select('id')
    .eq('bcba_id', user.id)
    .eq('client_id', clientId)
    .maybeSingle()

  if (!connection) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { systemPrompt, userPrompt } = build97153XPPrompt({
    sessionDate,
    location: location || '',
    rbtSessionContext: rbtSessionContext ?? null,
    bcbaActionsPerformed: bcbaActionsPerformed || '',
    treatmentIntegrityConcerns: treatmentIntegrityConcerns || '',
    clientResponseDuringOverlap: clientResponseDuringOverlap || '',
  })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const aiStream = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          stream: true,
          max_tokens: 1200,
          temperature: 0.3,
        })

        let fullNote = ''
        for await (const chunk of aiStream) {
          const delta = chunk.choices[0]?.delta?.content || ''
          if (delta) {
            fullNote += delta
            controller.enqueue(encoder.encode(delta))
          }
        }

        // Save to supervision_notes_97153xp
        let savedId: string | undefined
        const { data: inserted } = await supabaseServer
          .from('supervision_notes_97153xp')
          .insert({
            client_id: clientId,
            bcba_id: user.id,
            session_date: sessionDate,
            note_text: fullNote,
            rbt_session_context: rbtSessionContext || null,
          })
          .select('id')
          .single()
        savedId = inserted?.id

        controller.enqueue(encoder.encode(`__META__${JSON.stringify({ saved: !!savedId })}`))
      } catch (err: any) {
        controller.enqueue(encoder.encode(`__META__${JSON.stringify({ error: err.message || 'Generation failed' })}`))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
    },
  })
}
