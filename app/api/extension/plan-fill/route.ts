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

  // Map a three-state boolean (true | false | 'unknown') to a radio value. 'unknown' (and any
  // other non-boolean) becomes 'unknown' so the executor SKIPS the field and flags it for
  // review — a false "No" is a clinical documentation error, never emitted by inference.
  const threeStateRadio = (v: unknown): 'Yes' | 'No' | 'unknown' => {
    if (v === true || v === 'Yes' || v === 'yes') return 'Yes'
    if (v === false || v === 'No' || v === 'no') return 'No'
    return 'unknown'
  }

  // Issue 1 (generalized): a radio whose "Yes" branch reveals a REQUIRED conditional field must
  // NOT be set to Yes unless that child can also be filled — otherwise the Yes leaves an empty
  // required child that fails validation. When the child can't be supplied, downgrade Yes ->
  // 'unknown' so the executor SKIPS the radio (needsReview) instead of emitting a broken Yes.
  // ('No' has no conditional child and is unaffected.) The DL specify-incident / specify-medical
  // -concern / describe-environmental-change detail boxes are conditional fields not present in
  // the pre-Yes scan, so they are not fillable from this plan -> childFillable is false for them.
  const radioWithConditional = (v: unknown, childFillable: boolean): 'Yes' | 'No' | 'unknown' => {
    const r = threeStateRadio(v)
    return r === 'Yes' && !childFillable ? 'unknown' : r
  }

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

  // ── Deterministic mapping ──────────────────────────────────────────────────
  // Fill known field->fact mappings directly (confidence 1). The AI is then only needed for
  // whatever fields are left. `facts` is the value already destructured above; emptyFields
  // objects carry `fieldId` (not `id`).
  const deterministicActions: any[] = []

  // Daily Log deterministic mappings
  if (facts.dailyLog) {
    const dl = facts.dailyLog
    const dlMappings = [
      { fieldId: 'DL_EnvironmentChanges', fieldType: 'radio', value: radioWithConditional(dl.environmentChanges, false) },
      { fieldId: 'DL_WhoWasPresent', fieldType: 'chip', value: dl.whoWasPresent?.[0] || '' },
      { fieldId: 'DL_PresentationStart', fieldType: 'textarea', value: dl.presentationStart || '' },
      { fieldId: 'DL_EvidencedBy', fieldType: 'text', value: dl.evidencedByStart || '' },
      { fieldId: 'DL_PresentationEnd', fieldType: 'textarea', value: dl.presentationEnd || '' },
      { fieldId: 'DL_EvidencedBy2', fieldType: 'textarea', value: dl.evidencedByEnd || '' },
      { fieldId: 'DL_Participation', fieldType: 'textarea', value: dl.participation || '' },
      { fieldId: 'DL_Incidents', fieldType: 'radio', value: radioWithConditional(dl.incidents, false) },
      { fieldId: 'DL_MedicalConcerns', fieldType: 'radio', value: radioWithConditional(dl.medicalConcerns, false) },
      { fieldId: 'DL_RelevantInformation', fieldType: 'textarea', value: dl.relevantInformation || '' },
    ]
    dlMappings.forEach((m) => {
      if (m.value && (m.fieldType === 'radio' || emptyFields.find((f) => f.fieldId === m.fieldId))) {
        deterministicActions.push({ fieldId: m.fieldId, sectionId: 'DL', fieldType: m.fieldType, value: m.value, confidence: 1 })
      }
    })
  }

  // Behavior deterministic mappings
  facts.behaviors?.forEach((b: any, i: number) => {
    const n = i + 1
    const normalizedFunction = b.function === 'Tangibles' ? 'Tangible' : b.function
    // Change 2b: the "Antecedent Interventions" field is a CONDITIONAL child revealed by the
    // Yes/No radio (not present in the pre-Yes scan), so — like promptTypes — its value rides on
    // the radio action as `conditional`, and the executor fills the revealed field. Only attach it
    // when the radio is Yes AND there is grounded text; otherwise the pair is left for review
    // (never a generic phrase).
    const antYesNo = threeStateRadio(b.hadAntecedentIntervention)
    const antText = String(b.antecedentInterventionText || '').trim()
    const brMappings: any[] = [
      { fieldId: `BR${n}_BehaviorName`, fieldType: 'select', value: b.name },
      { fieldId: `BR${n}_EvidencedBy`, fieldType: 'textarea', value: b.evidencedBy },
      // Carry the function review meta (FUNCTION_ANTECEDENT_CONFLICT when skipped, or
      // INFERRED_FROM_ANTECEDENT when the value was inferred from the antecedent) so the executor
      // emits an informative review entry — never a silent blank, and inferred values say "verify".
      { fieldId: `BR${n}_BehaviorFunction`, fieldType: 'select', value: normalizedFunction, review: b.functionReview || undefined },
      { fieldId: `BR${n}_Antecedent`, fieldType: 'textarea', value: b.antecedent },
      {
        fieldId: `BR${n}_AntecedentInterventionsYesNo`, fieldType: 'radio', value: antYesNo,
        conditional: antYesNo === 'Yes' && antText ? { value: antText, types: [antText] } : undefined,
      },
      { fieldId: `BR${n}_ConsequenceInterventions`, fieldType: 'chip', value: b.consequenceIntervention },
      { fieldId: `BR${n}_Interventions`, fieldType: 'chip', value: b.interventions },
      { fieldId: `BR${n}_MainFocus`, fieldType: 'select', value: b.mainFocus },
      { fieldId: `BR${n}_Result`, fieldType: 'textarea', value: b.result },
      { fieldId: `BR${n}_STO`, fieldType: 'radio', value: 'No' },
    ]
    brMappings.forEach((m) => {
      if (m.value && (m.fieldType === 'radio' || emptyFields.find((f) => f.fieldId === m.fieldId))) {
        deterministicActions.push({
          fieldId: m.fieldId, sectionId: `BR${n}`, fieldType: m.fieldType, value: m.value, confidence: 1,
          ...(m.conditional ? { conditional: m.conditional } : {}),
          ...(m.review ? { review: m.review } : {}),
        })
      }
    })
  })

  // Skill deterministic mappings
  facts.skills?.forEach((s: any, i: number) => {
    const n = i + 1
    // Issue 1c: promptsUsed = Yes reveals a required "which prompts" child. Prompts are clinically
    // significant, so — unlike incidents — we do NOT downgrade Yes; instead we attach the prompt
    // types so the executor fills that conditional child. If promptTypes is empty the Yes still
    // stands and the executor routes the empty child to needsReview (never left silently blank).
    const promptsRadio = threeStateRadio(s.promptsUsed)
    const promptTypes: string[] = Array.isArray(s.promptTypes) ? s.promptTypes : []
    const goalMappings: any[] = [
      { fieldId: `Goal${n}_GoalName`, fieldType: 'select', value: s.name },
      { fieldId: `Goal${n}_MedicalBarriers`, fieldType: 'chip', value: s.medicalNecessity },
      { fieldId: `Goal${n}_Activities`, fieldType: 'chip', value: s.activity },
      // Goal{n}_TeachingProcedure and Goal{n}_Schedule are LEFT BLANK for the RBT: teaching method and
      // reinforcement schedule are direct session observations the assessment does not specify, so
      // autofilling them (an LLM guess for teachingProcedure, a hardcoded "Continuous Reinforcement"
      // for schedule) invents a clinical value into a signed compliance form. Both are also excluded
      // from the AI candidate set below, so neither the deterministic nor the AI path fills them.
      {
        fieldId: `Goal${n}_PromptsUsed`, fieldType: 'radio', value: promptsRadio,
        conditional: promptsRadio === 'Yes' ? { value: promptTypes.join(', '), types: promptTypes } : undefined,
      },
      { fieldId: `Goal${n}_Reinforcers`, fieldType: 'chip', value: s.reinforcers },
    ]
    goalMappings.forEach((m) => {
      if (m.value && (m.fieldType === 'radio' || emptyFields.find((f) => f.fieldId === m.fieldId))) {
        deterministicActions.push({
          fieldId: m.fieldId, sectionId: `Goal${n}`, fieldType: m.fieldType, value: m.value, confidence: 1,
          ...(m.conditional ? { conditional: m.conditional } : {}),
        })
      }
    })
  })

  // Only send the fields NOT handled deterministically to the AI.
  const deterministicIds = new Set(deterministicActions.map((a) => a.fieldId))
  // Teaching method and reinforcement schedule are intentionally never autofilled (see goalMappings):
  // exclude them from the AI candidate set so the fallback planner cannot re-invent what we just
  // removed from the deterministic path. They are left blank for the RBT to complete by observation.
  const remainingFields = emptyFields.filter((f) =>
    !deterministicIds.has(f.fieldId) && !/_(TeachingProcedure|Schedule)$/.test(f.fieldId))

  const prompt = `You are an ABA documentation form-filling planner. You are given structured ClinicalFacts and a list of EMPTY fields from an ABA Matrix session form. For each field you can confidently fill, output one fill action. Perform NO clinical reasoning — only MATCH the already-extracted facts to the fields.

Return ONLY a JSON array — no markdown, no prose. Each action is exactly:
{ "fieldId": "...", "sectionId": "...", "fieldType": "...", "value": "...", "confidence": 0.0 }
confidence is a number 0.0–1.0 reflecting how well the fact matches the field. If you cannot determine a value for a field, OMIT it (do not guess).

CLINICAL FACTS:
${JSON.stringify(facts, null, 2)}

EMPTY FIELDS (fill these; echo each field's fieldId, sectionId and fieldType):
${JSON.stringify(remainingFields, null, 2)}

MATCHING RULES (section IDs encode order):
- BR{n}_* fields use facts.behaviors[n-1] (BR1 = first behavior, BR2 = second, …).
    BehaviorName->name, EvidencedBy->evidencedBy, BehaviorFunction->function, Antecedent->antecedent,
    AntecedentInterventions->antecedentIntervention, Interventions->interventions,
    ConsequenceInterventions->consequenceIntervention, MainFocus->mainFocus, Result->result,
    AntecedentInterventionsYesNo->hadAntecedentIntervention (Yes/No), STO->hasSTO (Yes/No).
- Goal{n}_* fields use facts.skills[n-1] (Goal1 = first skill, Goal2 = second, …).
    GoalName->name, MedicalBarriers->medicalNecessity, Activities->activity,
    PromptsUsed->promptsUsed (Yes/No), PromptsDetail->promptDetail, Reinforcers->reinforcers.
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
- BR{n}_ConsequenceInterventions: use behaviors[n-1].consequenceIntervention
- BR{n}_BehaviorFunction: use behaviors[n-1].function — must match exactly: 'Attention', 'Escape', 'Tangible', or 'Automatic Reinforcement'
- BR{n}_Result: use behaviors[n-1].result
NEVER leave EvidencedBy or Antecedent empty if the behavior data contains them.

The "Antecedent Interventions" field is a CONDITIONAL child handled deterministically from the
note's own text — do NOT plan it, and NEVER invent a generic antecedent phrase for it.`

  // Only call the AI for the fields not handled deterministically.
  let aiActions: any[] = []
  if (remainingFields.length > 0) {
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
      aiActions = Array.isArray(parsed) ? parsed : (parsed.plan || parsed.actions || [])
    } catch {
      // AI parse failed — proceed with the deterministic actions only rather than failing the plan.
      aiActions = []
    }
  }

  // Merge: deterministic (confidence 1) first, then AI, keeping only confident actions.
  const plan = [...deterministicActions, ...aiActions].filter(
    (a: any) => a && typeof a.confidence === 'number' && a.confidence >= 0.65
  )
  return NextResponse.json({ plan })
}
