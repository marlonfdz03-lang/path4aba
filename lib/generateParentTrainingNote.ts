import OpenAI from 'openai'
import { MASTER_PARENT_TRAINING_PROMPT } from '@/app/prompts/parentTrainingPrompt'
import { prisma } from '@/lib/prisma'
import { redactText } from '@/lib/pdfGeometry'

const openai = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY || 'azure-openai',
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/gpt-4o`,
  defaultQuery: { 'api-version': '2024-12-01-preview' },
  defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY },
})

export interface ParentTrainingNoteInput {
  sessionInfo: {
    date: string
    location: string
    bcbaName?: string
    caregiverName: string
    caregiverRelation: string
  }
  clientId: string
  clientPresent: 'yes' | 'no' | 'partial' | ''
  trainingTopics?: string[]
  parentTrainingGoals?: string[]
  manualPTGoal?: string
  proceduresTrained?: string[]
  bstComponents?: string[]
  caregiverPerformance?: string
  didNotPracticeReason?: string
  feedbackProvided?: string[]
  clientResponse?: string[]
  barriersIdentified?: string[]
  homeImplementationPlan?: string
  followUpPlan?: string[]
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

export interface GeneratedParentTrainingNote {
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

export async function generateParentTrainingNote(input: ParentTrainingNoteInput, onChunk?: (text: string) => void): Promise<GeneratedParentTrainingNote> {
  if (!input.clientProfile) {
    const client = await prisma.clients.findUnique({ where: { id: input.clientId } })
    if (!client) throw new Error(`Client not found: ${input.clientId}`)
    const raw = client.clinical_profile as any
    input.clientProfile = {
      diagnosis: raw?.diagnosis || [],
      setting: client.primary_setting || '',
      approvedInterventions: (raw?.interventions || []).map((i: any) => typeof i === 'string' ? i : i?.name || '').filter(Boolean),
      activePrograms: {
        maladaptive: (raw?.maladaptiveBehaviors || raw?.activePrograms?.maladaptive || []).map((b: any) => typeof b === 'string' ? b : b?.name || '').filter(Boolean),
        replacementSkills: [
          ...(raw?.replacementBehaviors || []).map((s: any) => typeof s === 'string' ? s : s?.name || '').filter(Boolean),
          ...(raw?.skillAcquisition || []).map((s: any) => typeof s === 'string' ? s : s?.name || '').filter(Boolean),
        ],
      },
    }
  }

  const previousNotes = await prisma.parent_training_notes.findMany({
    where: { client_id: input.clientId },
    select: { note_text: true },
    orderBy: { created_at: 'desc' },
  })
  const previousTexts = previousNotes.map(r => r.note_text as string).filter(Boolean)

  // PHI FIREWALL (parent-training prompt): EVERY client-originated free-text field can carry the CLIENT's name.
  // Scrub the client's own name (names-only) from all of them before they enter the prompt. Scrub the CLIENT name
  // ONLY — this note type LEGITIMATELY names the caregiver (see the Caregiver: line), so caregiver names survive
  // (only the client name is passed to redactText). Fail-open if no name on file. Same redactText; no 2nd scrubber.
  const cnameRow = await prisma.clients.findUnique({ where: { id: input.clientId }, select: { clinical_profile: true } })
  const clientName = String((cnameRow?.clinical_profile as any)?.name || '')
  const scrub = (s: string) => (clientName ? redactText(s, [clientName], { namesOnly: true }) : s)
  const scrubArr = (a?: string[]) => (a || []).map(scrub)
  const allPTGoals = [
    ...scrubArr(input.parentTrainingGoals),
    input.manualPTGoal ? `${scrub(input.manualPTGoal)} (manually added)` : '',
  ].filter(Boolean).join(', ') || 'Not specified'

  const userPrompt = `Generate a 97156 Parent Training note for:
Date: ${input.sessionInfo.date}
Location: ${input.sessionInfo.location}
Caregiver: ${input.sessionInfo.caregiverName} (${input.sessionInfo.caregiverRelation})
Client Present: ${input.clientPresent || 'not specified'}

--- PARENT TRAINING GOALS ADDRESSED ---
${allPTGoals}

--- TRAINING TOPICS ---
${scrubArr(input.trainingTopics).join(', ') || 'Not specified'}

--- PROCEDURES TRAINED ---
${scrubArr(input.proceduresTrained).join(', ') || 'Not specified'}

--- BST COMPONENTS USED ---
${scrubArr(input.bstComponents).join(', ') || 'Not specified'}

--- CAREGIVER PERFORMANCE ---
${input.caregiverPerformance ? scrub(input.caregiverPerformance) : 'Not specified'}
${input.didNotPracticeReason ? `Reason did not practice: ${scrub(input.didNotPracticeReason)}` : ''}

--- FEEDBACK PROVIDED TO CAREGIVER ---
${scrubArr(input.feedbackProvided).join(', ') || 'Not specified'}

--- CLIENT RESPONSE ---
${input.clientPresent === 'no' ? 'Client was not present during this session.' : scrubArr(input.clientResponse).join(', ') || 'Not observed'}

--- BARRIERS IDENTIFIED ---
${scrubArr(input.barriersIdentified).join(', ') || 'None identified'}

--- HOME IMPLEMENTATION PLAN ---
${input.homeImplementationPlan ? scrub(input.homeImplementationPlan) : 'Not provided'}

--- FOLLOW-UP PLAN ---
${scrubArr(input.followUpPlan).join(', ') || 'Continue monitoring'}

Write the note now. 300–500 words, one paragraph, third person, objective ABA language. Caregiver must appear as active practitioner. Answer all 9 required questions.`

  async function callOpenAI(systemContent: string): Promise<string> {
    if (onChunk) {
      const stream = await openai.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0.4,
        max_tokens: 1200,
        stream: true,
        messages: [
          { role: 'system', content: systemContent },
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
        { role: 'system', content: systemContent },
        { role: 'user', content: userPrompt },
      ],
    })
    return resp.choices[0].message.content || ''
  }

  let note = await callOpenAI(MASTER_PARENT_TRAINING_PROMPT)

  let similarityWarning = false
  if (previousTexts.length > 0) {
    const tooSimilar = previousTexts.some(prev => calculateSimilarity(note, prev) > 0.60)
    if (tooSimilar) {
      if (onChunk) onChunk('\n__REGEN__\n')
      const variationInstruction =
        `\n\nIMPORTANT: This parent training note is too similar to a previous one for this client. ` +
        `Use completely different sentence starters, vary the caregiver practice descriptions, ` +
        `feedback examples, and home implementation plan significantly. ` +
        `The note must read as a distinctly different training session.`
      note = await callOpenAI(MASTER_PARENT_TRAINING_PROMPT + variationInstruction)
      const stillTooSimilar = previousTexts.some(prev => calculateSimilarity(note, prev) > 0.60)
      if (stillTooSimilar) {
        similarityWarning = true
        console.warn('[generateParentTrainingNote] Similarity >60% after regeneration for client:', input.clientId)
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
