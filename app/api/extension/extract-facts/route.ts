import { NextResponse } from 'next/server'
import { getExtensionAuth } from '@/lib/extensionAuth'
import OpenAI from 'openai'

export async function POST(req: Request) {
  // Bearer-token auth (extension). getExtensionAuth hashes the token and looks it up by
  // token_hash — the extension_tokens table stores a sha256 hash, not the raw token.
  const user = await getExtensionAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Instantiate the Azure OpenAI client per-request (not at module level) so a missing
  // AZURE_OPENAI_API_KEY at build time can't throw during route collection.
  const client = new OpenAI({
    apiKey: process.env.AZURE_OPENAI_API_KEY || '',
    baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/gpt-4o`,
    defaultQuery: { 'api-version': '2025-01-01-preview' },
    defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY || '' },
  })

  const { note, behaviors, skills, caregivers, clientName } = await req.json()
  if (!note) return NextResponse.json({ error: 'Missing note' }, { status: 400 })

  const prompt = `You are a clinical ABA documentation specialist.
Extract structured clinical facts from this session note.
Return ONLY valid JSON — no markdown, no explanation.

SESSION NOTE:
${note}

CLIENT: ${clientName || 'the client'}
BEHAVIORS IN TREATMENT PLAN: ${behaviors?.join(', ')}
SKILLS IN TREATMENT PLAN: ${skills?.join(', ')}
CAREGIVERS: ${caregivers?.join(', ')}

CRITICAL — presentationStart vs presentationEnd:
- presentationStart = how the client presented at the VERY BEGINNING of the session (first paragraph, arrival, initial behaviors)
- presentationEnd = how the client presented at the CLOSE of the session (last paragraph, 'By the close of the session...')
- These MUST be different values extracted from different parts of the note
- 'By the close of the session' or 'By the end of the session' always maps to presentationEnd, never to presentationStart
- The opening sentence/paragraph always maps to presentationStart

Return this exact JSON structure:
{
  "dailyLog": {
    "environmentChanges": "Yes or No",
    "environmentChangesDetail": "description if Yes, empty if No",
    "whoWasPresent": ["name1", "name2"],
    "presentationStart": "how client presented at start",
    "evidencedByStart": "what evidenced the start presentation",
    "presentationEnd": "how client presented at end",
    "evidencedByEnd": "what evidenced the end presentation",
    "participation": "how client participated",
    "incidents": "Yes or No",
    "incidentDetail": "description if Yes, empty if No",
    "medicalConcerns": "Yes or No",
    "medicalConcernDetail": "description if Yes, empty if No",
    "relevantInformation": ""
  },
  "behaviors": [
    {
      "name": "exact behavior name from treatment plan",
      "topography": "what the behavior looked like",
      "evidencedBy": "specific observable description",
      "function": "Attention or Escape or Tangible or Automatic Reinforcement",
      "antecedent": "what triggered the behavior",
      "hadAntecedentIntervention": true or false,
      "antecedentIntervention": "strategy used before behavior if any",
      "consequenceIntervention": "what RBT did after behavior",
      "interventions": "specific intervention names",
      "mainFocus": "Reduce the frequency or Reduce the duration or Reduce the intensity",
      "result": "what happened after intervention",
      "hasSTO": false
    }
  ],
  "skills": [
    {
      "name": "exact skill name from treatment plan",
      "activity": "activity used to practice",
      "teachingProcedure": "DTT or FCT or Modeling or Modeling and gestural prompts or Modeling and visual supports or Activity schedules",
      "promptsUsed": true or false,
      "promptDetail": "type of prompts if used",
      "reinforcers": "what was used as reinforcement",
      "schedule": "Continuous Reinforcement or Fixed Ratio (FR) Schedule or Variable Ratio (VR) Schedule or other",
      "medicalNecessity": "clinical justification sentence"
    }
  ]
}`

  // Same OpenAI completion pattern as fill-aba-matrix/route.ts. max_tokens is raised to 4000
  // because the ClinicalFacts payload (behaviors[] + skills[] with ~12 fields each) is larger
  // than the fill-aba-matrix answers — too low a cap truncates the JSON and breaks JSON.parse.
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    max_tokens: 4000,
  })

  const text = response.choices[0]?.message?.content || '{}'
  const clean = text.replace(/```json|```/g, '').trim()

  try {
    const facts = JSON.parse(clean)
    return NextResponse.json({ facts })
  } catch {
    return NextResponse.json({ error: 'Failed to parse AI response', raw: text }, { status: 500 })
  }
}
