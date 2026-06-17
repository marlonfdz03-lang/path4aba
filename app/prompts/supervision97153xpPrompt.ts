export interface Input97153XP {
  sessionDate: string
  location: string
  rbtSessionContext?: Record<string, unknown> | null
  rbtBehaviorsReported?: string[]
  rbtInterventionsUsed?: string[]
  rbtProgramsWorked?: string[]
  bcbaObservedPrograms?: string[]
  bcbaObservedBehaviors?: string[]
  supervisionFocus?: string[]
  integrityReview?: {
    prompting: string
    reinforcement: string
    behaviorReduction: string
    dataCollection: string
  }
  bcbaActionsPerformed: string[]
  feedbackToRbt?: string[]
  clientResponseDuringOverlap: string[]
  recommendations?: string[]
  narrativeStyle?: string
}

export function build97153XPPrompt(input: Input97153XP): { systemPrompt: string; userPrompt: string } {
  const styleInstructions: Record<string, string> = {
    'Insurance-Friendly': 'Write in a clear, concise style optimized for insurance authorization. Use standard billing language. 150-200 words.',
    'Clinical': 'Write in standard ABA clinical language. Use behavioral terminology accurately. 200-250 words.',
    'Detailed Clinical': 'Write in detailed clinical language with full behavioral descriptions and clinical rationale. 250-350 words.',
    'Audit-Ready': 'Write with maximum specificity for audit defense. Include all observable details, specific procedures, and measurable outcomes. 300-400 words.',
  }

  const style = input.narrativeStyle || 'Insurance-Friendly'
  const styleInstruction = styleInstructions[style] || styleInstructions['Insurance-Friendly']

  const systemPrompt = `You are a licensed BCBA writing a CPT 97153 XP modifier supervision note.

REQUIRED phrases (use naturally, do not force):
- "BCBA observed the RBT's implementation of"
- "live coaching was provided"

BANNED phrases (never use):
- "protocol was modified"
- "treatment plan was changed"
- "modifications were made to the protocol"
- "the behavior intervention plan was updated"
- "plan modification"

TREATMENT INTEGRITY RULE:
If any area is rated "Needs Improvement", describe the specific area objectively using observable language. State that the BCBA provided coaching, modeling, or performance feedback to the RBT in that area. Never frame this as a protocol modification, plan change, or treatment update. Needs Improvement in treatment integrity reflects implementation fidelity, not intervention effectiveness. Never imply the intervention itself is ineffective. Example: "Data collection procedures were identified as an area for improvement; the BCBA provided in-vivo coaching and modeling to support accurate implementation."

NOTE STRUCTURE — write in this order:
1. BCBA presence and purpose of overlap
2. RBT behaviors and programs observed (reference what RBT worked on)
3. Treatment integrity findings (prompting, reinforcement, behavior reduction, data collection)
4. BCBA actions performed during overlap
5. Feedback provided to RBT
6. Client response and clinical rationale
7. Recommendations

STYLE: ${styleInstruction}

CRITICAL HIPAA RULES:
- Never use client name, DOB, Medicaid ID, or any identifier
- Refer to client only as "the client" or "the individual"
- Never use RBT's full name — use "the RBT" or "the technician"
- Third person throughout`

  const rbtLines: string[] = []
  if (input.rbtBehaviorsReported?.length)
    rbtLines.push(`Behaviors reported by RBT: ${input.rbtBehaviorsReported.join(', ')}`)
  if (input.rbtInterventionsUsed?.length)
    rbtLines.push(`Interventions used by RBT: ${input.rbtInterventionsUsed.join(', ')}`)
  if (input.rbtProgramsWorked?.length)
    rbtLines.push(`Programs worked on by RBT: ${input.rbtProgramsWorked.join(', ')}`)

  const bcbaObsLines: string[] = []
  if (input.bcbaObservedPrograms?.length)
    bcbaObsLines.push(`Programs observed by BCBA: ${input.bcbaObservedPrograms.join(', ')}`)
  if (input.bcbaObservedBehaviors?.length)
    bcbaObsLines.push(`Behaviors observed by BCBA: ${input.bcbaObservedBehaviors.join(', ')}`)

  const integrityLines: string[] = []
  if (input.integrityReview) {
    const ir = input.integrityReview
    if (ir.prompting) integrityLines.push(`Prompting procedures: ${ir.prompting}`)
    if (ir.reinforcement) integrityLines.push(`Reinforcement procedures: ${ir.reinforcement}`)
    if (ir.behaviorReduction) integrityLines.push(`Behavior reduction procedures: ${ir.behaviorReduction}`)
    if (ir.dataCollection) integrityLines.push(`Data collection: ${ir.dataCollection}`)
  }

  const userPrompt = `Generate a CPT 97153 XP overlap supervision note for:
Date: ${input.sessionDate}
Location: ${input.location}

--- RBT SESSION (Shared Information) ---
${rbtLines.length ? rbtLines.join('\n') : 'No RBT session context available'}

--- BCBA OBSERVATION ---
${bcbaObsLines.length ? bcbaObsLines.join('\n') : 'Not specified'}

--- SUPERVISION FOCUS ---
${input.supervisionFocus?.length ? input.supervisionFocus.join(', ') : 'General supervision'}

--- TREATMENT INTEGRITY REVIEW ---
${integrityLines.length ? integrityLines.join('\n') : 'Not assessed'}

--- BCBA ACTIONS PERFORMED ---
${input.bcbaActionsPerformed.join(', ')}

--- FEEDBACK PROVIDED TO RBT ---
${input.feedbackToRbt?.length ? input.feedbackToRbt.join(', ') : 'Not specified'}

--- CLIENT RESPONSE DURING OVERLAP ---
${input.clientResponseDuringOverlap.join(', ')}

--- RECOMMENDATIONS ---
${input.recommendations?.length ? input.recommendations.join(', ') : 'Continue current procedures'}

Write the note now. Follow the structure and style exactly as instructed.`

  return { systemPrompt, userPrompt }
}
