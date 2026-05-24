export function buildSupervisionPrompt(data: {
  clientName: string;
  diagnosis: string[];
  sessionDate: string;
  supervisionType: 'face_to_face' | 'remote';
  behaviors: string[];
  interventions: string[];
  replacementSkills: string[];
  complianceLevel: 'satisfactory' | 'needs_improvement' | 'unsatisfactory';
  feedbackProvided?: string;
  rbtNoteContext?: string;
}): string {
  const supervisionTypeLabel =
    data.supervisionType === 'face_to_face'
      ? 'face-to-face direct supervision'
      : 'remote supervision via telehealth';

  const complianceLabel = {
    satisfactory: 'satisfactory',
    needs_improvement: 'needs improvement',
    unsatisfactory: 'unsatisfactory',
  }[data.complianceLevel];

  return `You are generating a clinical BCBA/BCaBA supervision note documenting supervisory oversight of an RBT during an ABA therapy session.

SESSION CONTEXT:
- Client: ${data.clientName}
- Diagnosis: ${data.diagnosis.join(', ') || 'ASD'}
- Date: ${data.sessionDate}
- Supervision type: ${supervisionTypeLabel}
- Behaviors observed during supervision: ${data.behaviors.join(', ')}
- Interventions supervised: ${data.interventions.join(', ')}
- Replacement skills targeted: ${data.replacementSkills.join(', ')}
- RBT performance evaluation: ${complianceLabel}
${data.feedbackProvided ? `- Additional context from supervisor: ${data.feedbackProvided}` : ''}
${data.rbtNoteContext ? `\nRBT SESSION NOTE FOR REFERENCE:\n${data.rbtNoteContext}` : ''}

CLINICAL RULES — FOLLOW ALL STRICTLY:

1. This is a SUPERVISION note, not an RBT session note. Write from the BCBA/supervisor's perspective.
2. Focus on: what the BCBA observed, corrective feedback delivered, modeling or rehearsal provided, protocol modifications made, treatment fidelity assessment, and RBT skill development.
3. Never copy or paraphrase the RBT note verbatim. Use the same behaviors and interventions but through a clinical oversight lens — observation, coaching, evaluation.
4. Use only observable, objective language. BANNED: wanted, felt, decided, refused, chose, was frustrated, was happy, was motivated, was upset.
5. No prohibited interventions: no punishment, restraint, time-out, response cost, overcorrection, aversive, standalone extinction.
6. Write as one continuous professional paragraph of 400+ words.
7. Always include: direct observation narrative, corrective feedback delivered to the RBT, modeling or rehearsal of intervention steps, RBT protocol fidelity assessment.
8. Vary sentence starters across the note — never repeat the same opener twice.
9. Supervision type must be stated explicitly: "${supervisionTypeLabel}."
10. End with RBT performance evaluation: "${complianceLabel}" and at least one specific area for continued development.
11. Closing sentence must reference that supervisory contact was documented in accordance with the current behavior intervention plan.

PERSPECTIVE — THIS IS CRITICAL:
- RBT note perspective: what happened in the session (implementation)
- YOUR perspective: what the BCBA observed and supervised (clinical oversight)
- Same behaviors, same interventions — completely different clinical lens
- You are evaluating RBT performance, coaching technique, and documenting fidelity — not narrating the session

QUALITY CHECKLIST before outputting:
☐ Written from supervisor's perspective throughout
☐ No mentalistic language
☐ Includes direct observation, corrective feedback, modeling/rehearsal, fidelity assessment
☐ States supervision type explicitly
☐ Ends with RBT performance evaluation (${complianceLabel}) and development area
☐ One continuous paragraph, 400+ words
☐ No two sentences start with the same word or phrase
☐ No prohibited interventions mentioned
☐ No future planning language

Output the supervision note only. No headers, no preamble, no explanation. Just the clinical paragraph.`;
}
