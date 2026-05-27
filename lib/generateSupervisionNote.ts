import OpenAI from 'openai'
import { MASTER_SUPERVISION_PROMPT } from '@/app/prompts/supervisionPrompt'
import { supabaseServer as supabase } from '@/lib/supabaseServer'

const openai = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/gpt-4o`,
  defaultQuery: { 'api-version': '2024-12-01-preview' },
  defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY },
})

export interface SupervisionNoteInput {
  sessionInfo: {
    date: string
    timeRange: string
    location: string
    supervisorName: string
    rbtName: string
    contactType: 'individual_supervision' | 'group_supervision' | 'client_observation'
  }
  clientId: string
  supervisionDetails: {
    behaviorsObservedDuringVisit: string[]
    protocolModificationsMade: string
    feedbackProvidedToRBT: string
    rbtPerformanceNotes: string
    clinicalDecisionsMade: string
    nextSteps: string
  }
  clientProfile?: {
    diagnosis: string[]
    setting: string
    approvedInterventions: string[]
    activePrograms: {
      maladaptive: string[]
      replacementSkills: string[]
    }
  }
}

export interface GeneratedSupervisionNote {
  note: string
  clientId: string
  sessionDate: string
  generatedAt: string
  similarityWarning?: boolean
}

function calculateSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/))
  const words2 = new Set(text2.toLowerCase().split(/\s+/))
  const intersection = new Set([...words1].filter(w => words2.has(w)))
  const union = new Set([...words1, ...words2])
  return intersection.size / union.size
}

function buildContactTypeSection(contactType: string): string {
  if (contactType === 'group_supervision') {
    return (
      `\n\n═══════════════════════════════════════\n` +
      `CONTACT TYPE CONTEXT: GROUP SUPERVISION\n` +
      `═══════════════════════════════════════\n\n` +
      `This was a GROUP supervision contact. The note must:\n` +
      `- State explicitly that this was a group supervision format\n` +
      `- Note that up to 10 trainees may participate per BACB supervision requirements\n` +
      `- Document group dynamics where clinically relevant (e.g., peer modeling opportunities, group-delivered feedback)\n` +
      `- Include at least one observation directed at a specific trainee's performance (refer to as "the RBT" not by name)\n` +
      `- Do NOT describe this as individual supervision — the group format must be explicit in the note`
    )
  }
  if (contactType === 'client_observation') {
    return (
      `\n\n═══════════════════════════════════════\n` +
      `CONTACT TYPE CONTEXT: CLIENT OBSERVATION\n` +
      `═══════════════════════════════════════\n\n` +
      `This was a direct CLIENT OBSERVATION contact — the BCBA was physically present and directly observed the RBT working with the client in the natural environment. The note must:\n` +
      `- State prominently that the BCBA was present in the natural environment and directly observed RBT-client interaction (not via recording or data review)\n` +
      `- Justify this contact per BACB observation requirements: direct in-vivo observation to assess treatment fidelity and client responsiveness in the natural environment\n` +
      `- Document real-time or immediately post-session feedback delivered to the RBT based on direct observation\n` +
      `- Reference at least one specific client behavior observed by the BCBA during the visit and how the RBT responded to it\n` +
      `- This is the most intensive form of supervisory contact — the clinical depth and specificity must reflect that`
    )
  }
  // individual_supervision is the default — no extra section needed
  return ''
}

export async function generateSupervisionNote(input: SupervisionNoteInput, onChunk?: (text: string) => void): Promise<GeneratedSupervisionNote> {
  // Step 1: Resolve client profile
  let resolvedProfile: NonNullable<SupervisionNoteInput['clientProfile']>

  if (input.clientProfile) {
    resolvedProfile = input.clientProfile
  } else {
    const { data: client, error } = await supabase
      .from('clients')
      .select('*')
      .eq('id', input.clientId)
      .single()

    if (error || !client) throw new Error(`Client not found: ${input.clientId}`)

    const raw = client.clinical_profile
    resolvedProfile = {
      diagnosis: client.diagnosis || [],
      setting: client.primary_setting || '',
      approvedInterventions: raw?.approvedInterventions || [],
      activePrograms: {
        maladaptive: raw?.activePrograms?.maladaptive || [],
        replacementSkills: raw?.activePrograms?.replacementSkills || [],
      },
    }
  }

  // Step 2: Build structured context (no client name, DOB, or identifying info)
  const sessionContext = {
    sessionInfo: input.sessionInfo,
    clientProfile: resolvedProfile,
    supervisionDetails: input.supervisionDetails,
  }

  // Step 3: Fetch note history for similarity check
  const { data: previousNotes } = await supabase
    .from('supervision_notes')
    .select('note_text')
    .eq('client_id', input.clientId)
    .order('created_at', { ascending: false })

  const previousTexts = (previousNotes || [])
    .map(r => r.note_text as string)
    .filter(Boolean)

  // Step 4: Build system prompt with contact-type dynamic section
  const contactTypeSection = buildContactTypeSection(input.sessionInfo.contactType)
  const systemPrompt = MASTER_SUPERVISION_PROMPT + contactTypeSection

  const userPrompt =
    `Generate a clinical BCBA supervision note (97155) using this session data:\n\n` +
    `${JSON.stringify(sessionContext, null, 2)}\n\n` +
    `Remember: ONE continuous paragraph, 350–500 words, BCBA supervisor perspective only, ` +
    `all five mandatory content elements present, explicit protocol modification with clinical rationale, ` +
    `no client identifying information.`

  async function callOpenAI(sysContent: string): Promise<string> {
    if (onChunk) {
      const stream = await openai.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0.4,
        max_tokens: 1000,
        stream: true,
        messages: [
          { role: 'system', content: sysContent },
          { role: 'user', content: userPrompt },
        ],
      })
      let text = ''
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || ''
        if (delta) { text += delta; onChunk(delta) }
      }
      return text
    }
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.4,
      max_tokens: 1000,
      messages: [
        { role: 'system', content: sysContent },
        { role: 'user', content: userPrompt },
      ],
    })
    return resp.choices[0].message.content || ''
  }

  let note = await callOpenAI(systemPrompt)

  // Step 5: Similarity check
  let similarityWarning = false
  if (previousTexts.length > 0) {
    const tooSimilar = previousTexts.some(prev => calculateSimilarity(note, prev) > 0.60)
    if (tooSimilar) {
      if (onChunk) onChunk('\n__REGEN__\n')
      const variationInstruction =
        `\n\nIMPORTANT: This supervision note is too similar to a previous one for this client. ` +
        `Use completely different sentence starters, vary the clinical observations, feedback examples, ` +
        `fidelity findings, and protocol modification rationale significantly. ` +
        `The note must read as a distinctly different supervision contact.`
      note = await callOpenAI(systemPrompt + variationInstruction)
      const stillTooSimilar = previousTexts.some(prev => calculateSimilarity(note, prev) > 0.60)
      if (stillTooSimilar) {
        similarityWarning = true
        console.warn('[generateSupervisionNote] Similarity >60% after regeneration for client:', input.clientId)
      }
    }
  }

  return {
    note,
    clientId: input.clientId,
    sessionDate: input.sessionInfo.date,
    generatedAt: new Date().toISOString(),
    similarityWarning,
  }
}
