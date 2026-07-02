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

  const { facts, normalizedForm } = await req.json()
  if (!facts || !normalizedForm) {
    return NextResponse.json({ error: 'Missing facts or normalizedForm' }, { status: 400 })
  }

  // A field is empty when its NormalizedForm.isEmpty flag says so; fall back to currentValue
  // for robustness in case an older normalizer (without isEmpty) produced the form.
  const isBlank = (v: unknown) =>
    v === null || v === undefined || (Array.isArray(v) ? v.length === 0 : String(v).trim() === '')

  const emptyFields: any[] = []
  for (const section of (normalizedForm.sections || [])) {
    for (const f of (section.fields || [])) {
      const empty = f.isEmpty !== undefined ? f.isEmpty : isBlank(f.currentValue)
      if (empty) {
        emptyFields.push({
          fieldId: f.id,
          sectionId: section.id,
          sectionType: section.type,
          fieldKey: f.fieldKey,
          fieldType: f.fieldType,
          question: f.questionText,
          options: f.options,
        })
      }
    }
  }

  if (emptyFields.length === 0) return NextResponse.json({ plan: [] })

  const prompt = `You are an ABA documentation form-filling planner. You are given structured ClinicalFacts and a list of EMPTY fields from an ABA Matrix session form. For each field you can confidently fill, output one fill action. Perform NO clinical reasoning — only MATCH the already-extracted facts to the fields.

Return ONLY a JSON array — no markdown, no prose. Each action is exactly:
{ "fieldId": "...", "sectionId": "...", "fieldType": "...", "value": "...", "confidence": 0.0 }
confidence is a number 0.0–1.0 reflecting how well the fact matches the field. If you cannot determine a value for a field, OMIT it (do not guess).

CLINICAL FACTS:
${JSON.stringify(facts, null, 2)}

EMPTY FIELDS (fill these; echo each field's fieldId, sectionId and fieldType):
${JSON.stringify(emptyFields, null, 2)}

MATCHING RULES (section IDs encode order):
- BR{n}_* fields use facts.behaviors[n-1] (BR1 = first behavior, BR2 = second, …).
    BehaviorName->name, EvidencedBy->evidencedBy, BehaviorFunction->function, Antecedent->antecedent,
    AntecedentInterventions->antecedentIntervention, Interventions->interventions,
    ConsequenceInterventions->consequenceIntervention, MainFocus->mainFocus, Result->result,
    AntecedentInterventionsYesNo->hadAntecedentIntervention (Yes/No), STO->hasSTO (Yes/No).
- Goal{n}_* fields use facts.skills[n-1] (Goal1 = first skill, Goal2 = second, …).
    GoalName->name, MedicalBarriers->medicalNecessity, Activities->activity,
    TeachingProcedure->teachingProcedure, PromptsUsed->promptsUsed (Yes/No), PromptsDetail->promptDetail,
    Reinforcers->reinforcers, Schedule->schedule.
- DL_* fields use facts.dailyLog.
    PresentationStart->presentationStart, PresentationEnd->presentationEnd, Participation->participation,
    EvidencedBy->evidencedByStart (or evidencedByEnd), WhoWasPresent->whoWasPresent,
    EnvironmentChanges->environmentChanges (Yes/No), Incidents->incidents (Yes/No),
    MedicalConcerns->medicalConcerns (Yes/No), RelevantInformation->relevantInformation.

FIELD-TYPE RULES:
- radio: value MUST be one of that field's options EXACTLY (e.g. "Yes" or "No").
- select: value must CLOSELY match one of the field's options — return the option text that best fits the fact.
- chip: output ONE action per chip value. If a fact is a list (e.g. multiple caregivers or reinforcers), emit multiple actions with the SAME fieldId, one value each.
- textarea / text: write clinically appropriate text grounded ONLY in the facts.
- Never invent client names, numbers, or trial counts.

FIELD-MAPPING CORRECTIONS (apply these exactly):

CRITICAL: DL_PresentationStart = how the client presented at the BEGINNING of the session (first minutes).
DL_PresentationEnd = how the client presented at the END of the session (last minutes, closing).
These are DIFFERENT values. Do NOT use the same text for both.
Use facts.dailyLog.presentationStart for DL_PresentationStart.
Use facts.dailyLog.presentationEnd for DL_PresentationEnd.

For each Behavior Reduction section (BR1, BR2, etc.):
- BR{n}_BehaviorName: use behaviors[n-1].name — this is a select field
- BR{n}_EvidencedBy: use behaviors[n-1].evidencedBy — write specific observable description
- BR{n}_Antecedent: use behaviors[n-1].antecedent — write what triggered the behavior
- BR{n}_AntecedentInterventionsYesNo: if behaviors[n-1].hadAntecedentIntervention is true → value must be exactly 'Yes', if false → 'No'
- BR{n}_AntecedentInterventions: if hadAntecedentIntervention is true → use behaviors[n-1].antecedentIntervention
- BR{n}_ConsequenceInterventions: use behaviors[n-1].consequenceIntervention
- BR{n}_BehaviorFunction: use behaviors[n-1].function — must match exactly: 'Attention', 'Escape', 'Tangible', or 'Automatic Reinforcement'
- BR{n}_Result: use behaviors[n-1].result
NEVER leave EvidencedBy or Antecedent empty if the behavior data contains them.

BR{n}_AntecedentInterventions is a chip field that appears when AntecedentInterventionsYesNo is Yes.
Always include a fill action for BR{n}_AntecedentInterventions when hadAntecedentIntervention is true.
Value: use behaviors[n-1].antecedentIntervention or write 'Visual schedule and verbal prompts to prevent recurrence.'`

  // Same OpenAI completion pattern as fill-aba-matrix/route.ts (max_tokens raised for the plan).
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    max_tokens: 4000,
  })

  const text = response.choices[0]?.message?.content || '[]'
  const clean = text.replace(/```json|```/g, '').trim()

  try {
    const parsed = JSON.parse(clean)
    const actions = Array.isArray(parsed) ? parsed : (parsed.plan || parsed.actions || [])
    const plan = actions.filter(
      (a: any) => a && typeof a.confidence === 'number' && a.confidence >= 0.65
    )
    return NextResponse.json({ plan })
  } catch {
    return NextResponse.json({ error: 'Failed to parse AI response', raw: text }, { status: 500 })
  }
}
