import OpenAI from 'openai'
import { MASTER_SUPERVISION_PROMPT } from '@/app/prompts/supervisionPrompt'
import { prisma } from '@/lib/prisma'
import { redactText } from '@/lib/pdfGeometry'

const openai = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY || 'azure-openai',
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/gpt-4o`,
  defaultQuery: { 'api-version': '2024-12-01-preview' },
  defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY },
})

export interface SupervisionNoteInput {
  sessionInfo: {
    date: string
    location: string
    contactType: string
  }
  clientId: string
  reason97155?: string[]
  dataReviewed?: string[]
  programsReviewed?: {
    maladaptive: string[]
    replacement: string[]
    skillAcquisition: string[]
    manual?: string
  }
  clinicalFindings?: string[]
  protocolModifications?: string[]
  clinicalRationale?: string
  expectedOutcome?: string
  clientResponse?: string[]
  followUpPlan?: string[]
  groupSupervision?: {
    participantCount: number
    topicsReviewed: string[]
    clinicalTrends: string
    recommendations: string
    followUpPlan: string[]
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
      `GROUP SUPERVISION RULES — BINDING CONSTRAINTS\n` +
      `═══════════════════════════════════════\n\n` +
      `- NEVER reference a specific client in this note\n` +
      `- NEVER include individual client data, behaviors, or programs\n` +
      `- Document only general clinical topics, trends, and recommendations\n` +
      `- Must state the number of participants and that this was a group supervision format\n` +
      `- The note must read as a group-level clinical contact, not individual supervision`
    )
  }
  if (contactType === 'client_observation') {
    return (
      `\n\n═══════════════════════════════════════\n` +
      `CONTACT TYPE CONTEXT: CLIENT OBSERVATION\n` +
      `═══════════════════════════════════════\n\n` +
      `This was a direct CLIENT OBSERVATION contact — the BCBA was physically present and directly observed the session. The note must:\n` +
      `- State prominently that the BCBA was present and directly observed the session\n` +
      `- Justify this contact per BACB observation requirements: direct in-vivo observation to assess treatment fidelity\n` +
      `- Reference at least one specific client behavior observed and how the modified procedure was applied\n` +
      `- Include the client response to the modified procedure`
    )
  }
  return ''
}

export async function generateSupervisionNote(input: SupervisionNoteInput, onChunk?: (text: string) => void): Promise<GeneratedSupervisionNote> {
  // Resolve client profile for context (not injected into prompt — programs come from frontend checkboxes)
  if (!input.clientProfile) {
    const client = await prisma.clients.findUnique({ where: { id: input.clientId } })
    if (!client) throw new Error(`Client not found: ${input.clientId}`)
    const raw = client.clinical_profile as any
    input.clientProfile = {
      diagnosis: Array.isArray(raw?.diagnosis) ? raw.diagnosis : [],
      setting: client.primary_setting || '',
      approvedInterventions: (raw?.interventions || []).map((i: any) => typeof i === 'string' ? i : i?.name || '').filter(Boolean),
      activePrograms: {
        maladaptive: (raw?.maladaptiveBehaviors || []).map((b: any) => typeof b === 'string' ? b : b?.name || '').filter(Boolean),
        replacementSkills: [
          ...(raw?.replacementBehaviors || []).map((s: any) => typeof s === 'string' ? s : s?.name || '').filter(Boolean),
          ...(raw?.skillAcquisition || []).map((s: any) => typeof s === 'string' ? s : s?.name || '').filter(Boolean),
        ],
      },
    }
  }

  // Fetch note history for similarity check
  const previousNotes = await prisma.supervision_notes.findMany({
    where: { client_id: input.clientId },
    select: { note_text: true },
    orderBy: { created_at: 'desc' },
  })
  const previousTexts = previousNotes.map(r => r.note_text as string).filter(Boolean)

  // Build system prompt
  const contactTypeSection = buildContactTypeSection(input.sessionInfo.contactType)
  const systemPrompt = MASTER_SUPERVISION_PROMPT + contactTypeSection

  // PHI FIREWALL (supervision prompt): scrub the CLIENT's own name from every client-originated free-text field
  // before it enters the prompt. Supervision notes do NOT name the caregiver by design, so client name only is
  // the correct target; names-only preserves clinical vocabulary. Fail-open if no name on file. Same redactText.
  const supRow = await prisma.clients.findUnique({ where: { id: input.clientId }, select: { clinical_profile: true } })
  const clientName = String((supRow?.clinical_profile as any)?.name || '')
  const scrub = (s: string) => (clientName ? redactText(s, [clientName], { namesOnly: true }) : s)
  const scrubArr = (a?: string[]) => (a || []).map(scrub)

  // Build user prompt based on contact type
  let userPrompt: string

  if (input.sessionInfo.contactType === 'group_supervision' && input.groupSupervision) {
    userPrompt = `Generate a 97155 Group Supervision note for:
Date: ${input.sessionInfo.date}
Location: ${input.sessionInfo.location}
Contact Type: Group Supervision
Number of Participants: ${input.groupSupervision.participantCount}

--- TOPICS REVIEWED ---
${scrubArr(input.groupSupervision.topicsReviewed).join(', ')}

--- GENERAL CLINICAL TRENDS DISCUSSED ---
${scrub(input.groupSupervision.clinicalTrends)}

--- GENERAL RECOMMENDATIONS ---
${input.groupSupervision.recommendations ? scrub(input.groupSupervision.recommendations) : 'Not specified'}

--- FOLLOW-UP PLAN ---
${scrubArr(input.groupSupervision.followUpPlan).join(', ') || 'Continue monitoring'}

Write the note now. 300–500 words, one paragraph, third person.
Do NOT reference any specific client. Document general clinical topics only.
State explicitly that this was a group supervision contact and include the number of participants.`
  } else {
    userPrompt = `Generate a 97155 clinical note for:
Date: ${input.sessionInfo.date}
Location: ${input.sessionInfo.location}
Contact Type: ${input.sessionInfo.contactType}

--- REASON FOR BCBA CLINICAL INVOLVEMENT ---
${scrubArr(input.reason97155).join(', ') || 'Not specified'}

--- DATA REVIEWED ---
${scrubArr(input.dataReviewed).join(', ') || 'Not specified'}

--- PROGRAMS / BEHAVIORS REVIEWED ---
Maladaptive behaviors: ${scrubArr(input.programsReviewed?.maladaptive).join(', ') || 'None selected'}
Replacement programs: ${scrubArr(input.programsReviewed?.replacement).join(', ') || 'None selected'}
Skill acquisition: ${scrubArr(input.programsReviewed?.skillAcquisition).join(', ') || 'None selected'}
${input.programsReviewed?.manual ? `Additional: ${scrub(input.programsReviewed.manual)}` : ''}

--- CLINICAL FINDINGS ---
${scrubArr(input.clinicalFindings).join(', ') || 'Not specified'}

--- PROTOCOL MODIFICATION MADE ---
${scrubArr(input.protocolModifications).join(', ') || 'Not specified'}

--- CLINICAL RATIONALE ---
${input.clinicalRationale ? scrub(input.clinicalRationale) : 'Not provided'}

--- EXPECTED OUTCOME ---
${input.expectedOutcome ? scrub(input.expectedOutcome) : 'Not provided'}

--- CLIENT RESPONSE ---
${scrubArr(input.clientResponse).join(', ') || 'Not observed'}

--- FOLLOW-UP PLAN ---
${scrubArr(input.followUpPlan).join(', ') || 'Continue monitoring'}

Write the note now. 300–500 words, one paragraph, third person, objective ABA language. Answer all required questions.`
  }

  async function callOpenAI(sysContent: string): Promise<string> {
    if (onChunk) {
      const stream = await openai.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0.4,
        max_tokens: 1200,
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
      max_tokens: 1200,
      messages: [
        { role: 'system', content: sysContent },
        { role: 'user', content: userPrompt },
      ],
    })
    return resp.choices[0].message.content || ''
  }

  let note = await callOpenAI(systemPrompt)

  // Similarity check
  let similarityWarning = false
  if (previousTexts.length > 0) {
    const tooSimilar = previousTexts.some(prev => calculateSimilarity(note, prev) > 0.60)
    if (tooSimilar) {
      if (onChunk) onChunk('\n__REGEN__\n')
      const variationInstruction =
        `\n\nIMPORTANT: This supervision note is too similar to a previous one for this client. ` +
        `Use completely different sentence starters, vary the clinical findings, rationale, ` +
        `and modification language significantly. ` +
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
