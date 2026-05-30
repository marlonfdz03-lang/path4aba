import OpenAI from 'openai'
import { MASTER_PARENT_TRAINING_PROMPT } from '@/app/prompts/parentTrainingPrompt'
import { prisma } from '@/lib/prisma'

const openai = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/gpt-4o`,
  defaultQuery: { 'api-version': '2024-12-01-preview' },
  defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY },
})

export interface ParentTrainingNoteInput {
  sessionInfo: {
    date: string
    timeRange: string
    location: string
    bcbaName: string
    caregiverName: string
    caregiverRelation: string
  }
  clientId: string
  sessionDetails: {
    behaviorsObservedDuringSession: string[]
    proceduresTrainedToday: string[]
    whatBCBAModeled: string
    caregiverPracticeDescription: string
    feedbackProvided: string
    caregiverOutcome: string
    generalizationTopicsDiscussed: string
    nextSessionGoals: string
    clientPresent?: string
  }
  clientProfile?: {
    diagnosis: string[]
    setting: string
    approvedInterventions: string[]
    activePrograms: {
      maladaptive: string[]
      replacementSkills: string[]
    }
    caregiverTrainingGoals: string[]
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
  // Step 1: Resolve client profile
  let resolvedProfile: NonNullable<ParentTrainingNoteInput['clientProfile']>

  if (input.clientProfile) {
    resolvedProfile = input.clientProfile
  } else {
    const client = await prisma.clients.findUnique({ where: { id: input.clientId } })
    if (!client) throw new Error(`Client not found: ${input.clientId}`)

    const raw = client.clinical_profile as any
    resolvedProfile = {
      diagnosis: (client.diagnosis as unknown as string[]) || [],
      setting: client.primary_setting || '',
      approvedInterventions: raw?.approvedInterventions || [],
      activePrograms: {
        maladaptive: raw?.activePrograms?.maladaptive || [],
        replacementSkills: raw?.activePrograms?.replacementSkills || [],
      },
      caregiverTrainingGoals: raw?.caregiverTrainingGoals || [],
    }
  }

  // Step 2: Build structured context (no client name, DOB, or identifying info)
  // nextSessionGoals is intentionally excluded from the prompt context to
  // prevent the AI from inserting future-planning language into the note.
  const { nextSessionGoals: _omitted, ...sessionDetailsForPrompt } = input.sessionDetails
  const sessionContext = {
    sessionInfo: input.sessionInfo,
    clientProfile: resolvedProfile,
    sessionDetails: sessionDetailsForPrompt,
  }

  // Step 3: Fetch note history for similarity check
  const previousNotes = await prisma.parent_training_notes.findMany({
    where: { client_id: input.clientId },
    select: { note_text: true },
    orderBy: { created_at: 'desc' },
  })

  const previousTexts = previousNotes
    .map((r) => r.note_text as string)
    .filter(Boolean)

  // Step 4: Build prompts
  const userPrompt =
    `Generate a clinical BCBA parent/caregiver training note (97156) using this session data:\n\n` +
    `${JSON.stringify(sessionContext, null, 2)}\n\n` +
    `Remember: 2–3 paragraphs, 400–500 words total, caregiver must be shown as active throughout, ` +
    `all eight mandatory content elements must be present, BST sequence explicit ` +
    `(instruction → modeling → rehearsal → feedback), no client identifying information, ` +
    `caregiver name must appear in the note.`

  async function callOpenAI(systemContent: string): Promise<string> {
    if (onChunk) {
      const stream = await openai.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0.4,
        max_tokens: 1000,
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
      max_tokens: 1000,
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: userPrompt },
      ],
    })
    return resp.choices[0].message.content || ''
  }

  let note = await callOpenAI(MASTER_PARENT_TRAINING_PROMPT)

  // Step 5: Similarity check
  let similarityWarning = false
  if (previousTexts.length > 0) {
    const tooSimilar = previousTexts.some(prev => calculateSimilarity(note, prev) > 0.60)
    if (tooSimilar) {
      if (onChunk) onChunk('\n__REGEN__\n')
      const variationInstruction =
        `\n\nIMPORTANT: This parent training note is too similar to a previous one for this client. ` +
        `Use completely different sentence starters, vary the caregiver practice descriptions, ` +
        `feedback examples, and generalization discussion significantly. ` +
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
