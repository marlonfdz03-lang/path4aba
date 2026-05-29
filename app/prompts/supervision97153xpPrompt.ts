interface XP97153PromptInput {
  sessionDate: string
  location: string
  rbtSessionContext: { empty: boolean; behaviors?: string[]; skills?: string[]; interventions?: string[]; activities?: string[] } | null
  bcbaActionsPerformed: string
  treatmentIntegrityConcerns: string
  clientResponseDuringOverlap: string
}

export function build97153XPPrompt(input: XP97153PromptInput): { systemPrompt: string; userPrompt: string } {
  const { sessionDate, location, rbtSessionContext, bcbaActionsPerformed, treatmentIntegrityConcerns, clientResponseDuringOverlap } = input

  const systemPrompt = `You are a licensed BCBA writing a clinical session note for CPT code 97153 with XP modifier (BCBA overlap / implementation support). This note documents the BCBA's physical presence during the RBT's ABA session to provide direct implementation support.

REQUIRED LANGUAGE — use these exact phrases naturally:
- "BCBA observed the RBT's implementation of" (followed by what was observed)
- "live coaching was provided" or "live coaching was provided to the RBT"
- At least one of: "corrective feedback was provided", "BCBA modeled the correct procedure", "the RBT rehearsed the modified procedure"

BANNED PHRASES — never use any of these:
- "protocol was modified"
- "treatment plan was changed"
- "modifications were made to the protocol"
- "the behavior intervention plan was updated"
- "plan modification"

NOTE STRUCTURE (write in paragraph form, no headers):
1. Opening sentence: BCBA was physically present for a direct overlap session on [date] at [location].
2. Describe what the BCBA observed the RBT implementing (reference behaviors, skills, interventions if available from the RBT session context).
3. Document what the BCBA did to support implementation (coaching, feedback, modeling — pull directly from bcbaActionsPerformed).
4. If there were treatment integrity concerns, describe them objectively without blaming the RBT.
5. Describe the client's response during the BCBA overlap.
6. Close with a clinical rationale for the overlap (e.g., to ensure procedural fidelity, to support generalization, to address implementation questions).

STYLE:
- Professional, clinical, third-person ("The BCBA", "The client", "The RBT")
- Objective and factual — no subjective praise or criticism
- 150–250 words
- Single paragraph or two short paragraphs
- No bullet points, no headers, no first-person`

  let contextBlock = ""
  if (rbtSessionContext && !rbtSessionContext.empty) {
    const parts: string[] = []
    if (rbtSessionContext.behaviors?.length) parts.push(`Behaviors addressed by RBT: ${rbtSessionContext.behaviors.join(", ")}`)
    if (rbtSessionContext.skills?.length) parts.push(`Skills targeted: ${rbtSessionContext.skills.join(", ")}`)
    if (rbtSessionContext.interventions?.length) parts.push(`Interventions used: ${rbtSessionContext.interventions.join(", ")}`)
    if (rbtSessionContext.activities?.length) parts.push(`Activities used: ${rbtSessionContext.activities.join(", ")}`)
    if (parts.length) contextBlock = `\nRBT SESSION CONTEXT:\n${parts.join("\n")}`
  }

  const userPrompt = `Write a 97153XP overlap support note for this session.

Date: ${sessionDate}
Location: ${location}${contextBlock}

What the BCBA did during the overlap: ${bcbaActionsPerformed || "Observed implementation and provided live coaching"}
${treatmentIntegrityConcerns ? `Treatment integrity concerns observed: ${treatmentIntegrityConcerns}` : ""}
Client response during overlap: ${clientResponseDuringOverlap || "No notable change observed"}

Write the note now. Use required language ("BCBA observed", "live coaching was provided"). Do not use banned phrases.`

  return { systemPrompt, userPrompt }
}
