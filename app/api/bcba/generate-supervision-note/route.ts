import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { supabaseServer } from '@/lib/supabaseServer'
import { buildSupervisionPrompt } from '@/app/prompts/supervisionPrompt'
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

function calculateSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/))
  const words2 = new Set(text2.toLowerCase().split(/\s+/))
  const intersection = new Set([...words1].filter(w => words2.has(w)))
  const union = new Set([...words1, ...words2])
  return intersection.size / union.size
}

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
    supervisionType?: 'face_to_face' | 'remote'
    rbtNoteId?: string
    behaviors?: string[]
    interventions?: string[]
    replacementSkills?: string[]
    feedbackProvided?: string
    complianceLevel?: 'satisfactory' | 'needs_improvement' | 'unsatisfactory'
  }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { clientId, sessionDate, supervisionType, rbtNoteId, behaviors, interventions, replacementSkills, feedbackProvided, complianceLevel } = body

  if (!clientId || !sessionDate || !supervisionType || !complianceLevel) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Verify BCBA is connected to this client
  const { data: connection } = await supabaseServer
    .from('bcba_clients')
    .select('id, rbt_id')
    .eq('bcba_id', user.id)
    .eq('client_id', clientId)
    .maybeSingle()

  if (!connection) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Fetch client data
  const { data: client } = await supabaseServer
    .from('clients')
    .select('client_name, diagnosis, clinical_profile')
    .eq('id', clientId)
    .maybeSingle()

  // Optionally fetch the RBT note for context
  let rbtNoteContext: string | undefined
  if (rbtNoteId) {
    const { data: rbtNote } = await supabaseServer
      .from('session_notes')
      .select('generated_note')
      .eq('id', rbtNoteId)
      .maybeSingle()
    rbtNoteContext = rbtNote?.generated_note
  }

  // Fetch full supervision note history for similarity check
  const { data: previousSupervisionNotes } = await supabaseServer
    .from('supervision_notes')
    .select('note_text')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })

  const previousTexts = (previousSupervisionNotes || [])
    .map(r => r.note_text as string)
    .filter(Boolean)

  const promptData = {
    clientName: client?.client_name || 'the client',
    diagnosis: client?.diagnosis || ['ASD'],
    sessionDate,
    supervisionType: supervisionType as 'face_to_face' | 'remote',
    behaviors: behaviors || [],
    interventions: interventions || [],
    replacementSkills: replacementSkills || [],
    complianceLevel: complianceLevel as 'satisfactory' | 'needs_improvement' | 'unsatisfactory',
    feedbackProvided,
    rbtNoteContext,
  }

  const systemPrompt = buildSupervisionPrompt(promptData)

  async function callOpenAI(prompt: string): Promise<string> {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.4,
      max_tokens: 1500,
      messages: [{ role: 'system', content: prompt }],
    })
    return resp.choices[0].message.content || ''
  }

  let note = await callOpenAI(systemPrompt)

  let similarityWarning = false
  if (previousTexts.length > 0) {
    const tooSimilar = previousTexts.some(prev => calculateSimilarity(note, prev) > 0.70)
    if (tooSimilar) {
      const variationInstruction = '\n\nIMPORTANT: This supervision note is too similar to a previous one. Use completely different sentence starters, vary the clinical observations, corrective feedback examples, and narrative structure significantly. The note must read as a distinctly different supervision contact.'
      note = await callOpenAI(systemPrompt + variationInstruction)
      const stillTooSimilar = previousTexts.some(prev => calculateSimilarity(note, prev) > 0.70)
      if (stillTooSimilar) similarityWarning = true
    }
  }

  // Save to supervision_notes
  await supabaseServer.from('supervision_notes').insert({
    client_id: clientId,
    bcba_id: user.id,
    rbt_id: connection.rbt_id,
    session_date: sessionDate,
    supervision_type: supervisionType,
    note_text: note,
    rbt_note_id: rbtNoteId || null,
    status: 'draft',
  })

  return NextResponse.json({ note, similarityWarning: similarityWarning || undefined })
}
