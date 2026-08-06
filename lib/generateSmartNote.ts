import OpenAI from 'openai';
import { MASTER_RBT_NOTE_PROMPT } from '@/app/prompts/masterPrompt';
import { prisma } from '@/lib/prisma';
import {
  filterApprovedInterventions,
  isValidActivity,
  isValidSkillForLocation,
  cleanBehaviorLabel,
} from '@/lib/clinicalFilters';
import { filterBlockedNarrative, type BlockedTerm } from '@/lib/blockedNarrativeTerms';
import { findInterventionViolations } from '@/lib/interventionPolicy';
import { findTeachingMethodViolations, approvedTeachingMethods } from '@/lib/teachingMethods';
import {
  findFunctionAntecedentContradictions,
  segmentNoteByBehavior, deriveBehaviorFunction, functionToCanonical,
  normalizeApprovedFunctions, functionDisplayLabel, effectiveAllowedFunctions,
} from '@/lib/functionPatterns';
import { stripInvalidNextSession } from '@/lib/nextSessionDate';
import { findRedFlagFlags } from '@/lib/redFlagPhrases';

const openai = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY || 'azure-openai',
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/gpt-4o`,
  defaultQuery: { 'api-version': '2024-12-01-preview' },
  defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY },
});

export interface SessionInput {
  sessionInfo: {
    date: string;
    timeRange: string;
    location: string;
    caregiver: string;
    caregiverName?: string;
    rbtName?: string;
  };
  clientId: string;
  gender?: string;
  pronouns?: string;
  behaviorsObserved: {
    name: string;
    topography: string;
    frequency: number;
    antecedentContext: string;
    function: string;
    // The assessment-approved function set for THIS behavior (clinical_profile.maladaptiveBehaviors[].functions).
    // The written function must be one of these; the gate enforces it. Empty/absent = no constraint.
    allowedFunctions?: string[];
    // THIS behavior's OWN captured ABA-Matrix dropdown (per-behavior; the server builder resolves it,
    // falling back to the global union). Preferred over the top-level union for the prompt nudge below.
    matrixFunctions?: string[];
  }[];
  // The function options the client's ABA Matrix dropdown can record (observedCatalog.aba_matrix.current.functions),
  // captured by the extension at fill time. Absent for most clients (never filled yet). When present, the prompt
  // prefers a function in (approved ∩ dropdown) so the written prose matches what the matrix will record.
  // This is the GLOBAL UNION across behaviors; per-behavior narrowing lives on behaviorsObserved[].matrixFunctions.
  matrixFunctions?: string[];
  replacementSkillsAddressed: {
    name: string;
    promptLevel: string;
    clientResponse: string;
    successful: boolean;
  }[];
  activitiesUsed: {
    name: string;
    preferred: boolean;
  }[];
  reinforcersUsed: {
    type: 'edible' | 'non-edible' | 'social';
    item: string;
    deliveredWhen: string;
  }[];
  clinicalEvents?: string;
  complianceLevel?: 'typical' | 'below_typical' | 'poor';
  environmentalChangeDescription?: string;
  missedHoursData?: { totalHours: number; reason: string };
  continuityContext?: {
    periodLabel: string;
    behaviorTrends: Record<string, 'improving' | 'stable' | 'worsening' | 'insufficient_data'>;
    skillTrends: Record<string, 'improving' | 'stable' | 'worsening' | 'insufficient_data'>;
    frequentlyUsedInterventions: string[];
    summary: string;
  } | null;
  clientProfile?: {
    diagnosis: string[];
    setting: string;
    approvedInterventions: string[];
    prohibitedInterventions: string[];
    reinforcers: {
      tangibles: string;
      activities: string;
      social: string;
      people: string;
    };
    activePrograms: {
      maladaptive: string[];
      replacementSkills: string[];
    };
  };
}

export interface GeneratedNote {
  note: string;
  clientId: string;
  sessionDate: string;
  behaviorsDocumented: string[];
  replacementSkillsDocumented: string[];
  generatedAt: string;
  similarityWarning?: boolean;
  // Host-EHR-blocked narrative terms that had NO substitute — left in place and surfaced to the RBT.
  blockedFlagged?: string[];
  // Function↔antecedent contradictions (automatic asserted alongside a social antecedent) — the
  // note is returned as-is but flagged "review before using"; never auto-corrected.
  coherenceFlags?: string[];
  // Universal 97153 red-flag phrases (vague/mentalistic/generic-intervention/filler) present in the
  // note — surfaced for the RBT to rewrite with observable detail; never auto-deleted (see redFlagPhrases.ts).
  redFlags?: string[];
}

function calculateSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  return intersection.size / union.size;
}

function buildContextualFactors(input: SessionInput): string {
  const blocks: string[] = [];

  if (input.missedHoursData && input.missedHoursData.totalHours > 0) {
    const { totalHours, reason } = input.missedHoursData;
    blocks.push(
      `MISSED HOURS CONTEXT — WEAVE NATURALLY INTO NOTE:\n` +
      `This client missed ${totalHours} hour${totalHours !== 1 ? 's' : ''} of service in the past 7 days${reason ? ` due to ${reason}` : ''}. ` +
      `Clinical context: when a client does not receive the full recommended hours of ABA therapy, behavioral gains may regress and maladaptive behaviors may increase in frequency and intensity. ` +
      `Reflect this by documenting increased behavior frequency compared to baseline, reduced response to interventions, and slower task initiation. ` +
      `Include one clinical statement noting that interruptions in service delivery can adversely impact behavioral progress. ` +
      `Do NOT say the session went poorly — document it observationally. ` +
      `Example language: "Following a gap in service delivery earlier this week, the client demonstrated increased frequency of [behavior] compared to recent baseline. Compliance with task demands required additional prompting, and initiation of preferred activities was delayed."`
    );
  }

  if (input.environmentalChangeDescription && input.environmentalChangeDescription.trim()) {
    blocks.push(
      `ENVIRONMENTAL CHANGE CONTEXT — WEAVE NATURALLY INTO NOTE:\n` +
      `The RBT reported the following environmental change during this session: ${input.environmentalChangeDescription.trim()}. ` +
      `Clinical context: changes in the client's typical environment can disrupt established routines and increase behavioral reactivity. ` +
      `Reflect this by documenting slightly reduced compliance compared to typical sessions, increased latency to task initiation, and behaviors occurring at higher frequency than recent sessions. ` +
      `Do NOT say the session was bad — document it observationally. ` +
      `Example language: "The presence of [environmental change] appeared to correlate with increased behavioral frequency during the first portion of the session. As the session progressed and the client habituated to the change, compliance improved moderately."`
    );
  }

  if (input.complianceLevel === 'below_typical' || input.complianceLevel === 'poor') {
    const level = input.complianceLevel === 'poor' ? 'poor' : 'below typical';
    blocks.push(
      `COMPLIANCE CONTEXT — WEAVE NATURALLY INTO NOTE:\n` +
      `The RBT reported that the client's compliance was ${level} today. ` +
      `The client demonstrated increased latency to instructions, did not initiate several activities independently, and required additional prompting throughout the session. ` +
      `Reflect this observationally in the note without using mentalistic language. ` +
      `Do NOT say the client "didn't want to" or "refused" — use observable language only. ` +
      `Example language: "The client demonstrated increased latency to task demands throughout the session, requiring additional gestural and verbal prompting to initiate activities. Response to instructions was below the client's typical baseline, with compliance achieved following 2–3 prompt repetitions across most tasks."`
    );
  }

  if (input.continuityContext && Object.keys(input.continuityContext.behaviorTrends || {}).length > 0) {
    const ctx = input.continuityContext;
    const worseningBehaviors = Object.entries(ctx.behaviorTrends)
      .filter(([, t]) => t === 'worsening').map(([n]) => n);
    const improvingBehaviors = Object.entries(ctx.behaviorTrends)
      .filter(([, t]) => t === 'improving').map(([n]) => n);
    const improvingSkills = Object.entries(ctx.skillTrends)
      .filter(([, t]) => t === 'improving').map(([n]) => n);
    const worseningSkills = Object.entries(ctx.skillTrends)
      .filter(([, t]) => t === 'worsening').map(([n]) => n);

    const lines: string[] = [
      `CRITICAL RULE FOR TREND CONTEXT: NEVER mention numbers, frequencies, percentages, or counts when reflecting trends in the note. ` +
      `Trends must be reflected through QUALITATIVE clinical language only.\n` +
      `BANNED: "the behavior occurred 6 times", "frequency increased by 20%", "3 more episodes than last week"\n` +
      `CORRECT: "the behavior continued to require active intervention support", "the client demonstrated emerging behavioral control", "the behavior remained an active treatment target"\n`,
    ];
    if (worseningBehaviors.length > 0) lines.push(
      `The following behaviors have been trending UPWARD in recent weeks: ${worseningBehaviors.join(', ')}. ` +
      `IMPORTANT: Behavior reduction in ABA takes months of consistent intervention. Do NOT dramatize. ` +
      `Reflect this as a SLIGHT increase — document the behavior occurring with marginally higher frequency compared to recent sessions, or requiring slightly more intervention support than the previous week. ` +
      `Use language like: "continued to require intervention support", "occurred at a frequency consistent with recent sessions", "remained an active target requiring ongoing implementation". ` +
      `NEVER say the behavior is significantly worse or out of control — that is clinically inaccurate for a weekly fluctuation.`
    );
    if (improvingBehaviors.length > 0) lines.push(
      `The following behaviors have been trending DOWNWARD in recent weeks: ${improvingBehaviors.join(', ')}. ` +
      `IMPORTANT: Reflect this as GRADUAL improvement over time — not sudden mastery. ` +
      `Use language like: "demonstrated a slight reduction in frequency compared to recent baseline", "continued to respond to intervention with improved compliance", "showed emerging behavioral control with consistent intervention support". ` +
      `NEVER say the behavior is resolved or mastered unless goalStatus is Mastered.`
    );
    if (improvingSkills.length > 0) lines.push(
      `The following replacement skills have been trending UPWARD (improving): ${improvingSkills.join(', ')}. ` +
      `Document these skills showing increased independence, reduced prompting, or higher accuracy compared to baseline.`
    );
    if (worseningSkills.length > 0) lines.push(
      `The following replacement skills have been trending DOWNWARD (declining): ${worseningSkills.join(', ')}. ` +
      `Document these skills requiring increased prompting or showing reduced accuracy.`
    );
    if (ctx.frequentlyUsedInterventions?.length > 0) lines.push(
      `Frequently used interventions in recent sessions: ${ctx.frequentlyUsedInterventions.join(', ')}. ` +
      `Prioritize these interventions when selecting which to document in this note.`
    );

    if (lines.length > 1) {
      blocks.push(
        `PROGRESS TREND CONTEXT — WEAVE NATURALLY INTO NOTE:\n` +
        `Based on the client's recent progress report (${ctx.periodLabel}):\n` +
        lines.join('\n') +
        `\nDATA INTEGRATION NOTE: This trend context is derived from the client's data collection records. ` +
        `As the data system matures and more weeks of data are collected, these trends will become increasingly precise and the notes will more accurately reflect the client's actual clinical trajectory over time.` +
        `\n\nIMPORTANT: Do not mention "progress report" or "trend analysis" in the note. Weave these clinical observations naturally into the narrative.`
      );
    }
  }

  if (blocks.length === 0) return '';

  // CLIENT PRONOUNS: guidance for the note generator
  if (input.gender || input.pronouns) {
    blocks.push(
      `CLIENT PRONOUNS: Use ${input.pronouns || (input.gender === 'male' ? 'he/him/his' : input.gender === 'female' ? 'she/her/hers' : '"the client"')} consistently throughout the note.`
    );
  } else {
    blocks.push(`CLIENT PRONOUNS: Gender not specified — use "the client" instead of any pronouns.`);
  }

  return (
    `\n\n═══════════════════════════════════════\n` +
    `CONTEXTUAL CLINICAL FACTORS — MUST BE WOVEN NATURALLY INTO THE NOTE\n` +
    `═══════════════════════════════════════\n\n` +
    blocks.join('\n\n') +
    `\n\nIMPORTANT: Do not list these factors as a separate section. Integrate them into the narrative of the note naturally. The note must still contain exactly 5 ABCs, still be one paragraph, and still read as professional clinical documentation.`
  );
}

export async function generateSmartNote(input: SessionInput, rbtId?: string, onChunk?: (text: string) => void): Promise<GeneratedNote> {
  // Step 1: Get client profile — use provided profile or fetch from Supabase
  let resolvedProfile: any;

  if (input.clientProfile) {
    resolvedProfile = input.clientProfile;
  } else {
    const client = await prisma.clients.findUnique({ where: { id: input.clientId } });
    if (!client) throw new Error(`Client not found: ${input.clientId}`);

    const raw = client.clinical_profile as any;
    resolvedProfile = {
      diagnosis: client.diagnosis || [],
      setting: client.primary_setting || '',
      approvedInterventions: raw?.approvedInterventions || [],
      prohibitedInterventions: raw?.prohibitedInterventions || [
        'Punishment', 'ResponseCost', 'Restraint',
        'StandaloneExtinction', 'TimeOut', 'Overcorrection', 'Aversive'
      ],
      reinforcers: raw?.reinforcers || {},
      activePrograms: raw?.activePrograms || {},
      settingDetails: raw?.setting_details || raw?.setting || '',
    };
  }

  // Pre-process: filter interventions and clean input using clinical rules
  if (resolvedProfile.approvedInterventions?.length) {
    resolvedProfile.approvedInterventions = filterApprovedInterventions(
      resolvedProfile.approvedInterventions
    );
  }
  if (input.activitiesUsed?.length) {
    input.activitiesUsed = input.activitiesUsed.filter(a =>
      isValidActivity(a.name, input.sessionInfo.location)
    );
  }
  if (input.behaviorsObserved?.length) {
    input.behaviorsObserved = input.behaviorsObserved.map(b => ({
      ...b,
      name: cleanBehaviorLabel(b.name),
    }));
  }
  if (resolvedProfile.activePrograms?.replacementSkills?.length) {
    resolvedProfile.activePrograms.replacementSkills =
      resolvedProfile.activePrograms.replacementSkills.filter((s: string) =>
        isValidSkillForLocation(s, input.sessionInfo.location)
      );
  }

  // ── Missed session: generate absence note instead of full clinical note ──
  if (input.missedHoursData && input.missedHoursData.totalHours > 0) {
    const { totalHours, reason } = input.missedHoursData;
    const location = input.sessionInfo.location || 'home';
    const caregiver = input.sessionInfo.caregiverName || input.sessionInfo.caregiver || 'caregiver';
    const date = input.sessionInfo.date || new Date().toISOString().split('T')[0];
    const setting = location === 'school' ? 'school-based' : location === 'clinic' ? 'clinic-based' : 'home-based';

    const absenceNote = `Scheduled ${setting} ABA session on ${date} was not held. ${caregiver} reported that the client was unable to attend due to ${reason || 'an unplanned absence'}. A total of ${totalHours} hour${totalHours !== 1 ? 's' : ''} of authorized ABA services were not rendered during this period. Clinical literature and ABA research support that interruptions in consistent service delivery can adversely affect behavioral progress, including increased frequency and intensity of targeted maladaptive behaviors and reduced maintenance of acquired replacement skills. The treating BCBA has been notified of the missed service hours. This note documents the absence in accordance with the current treatment plan and insurance authorization requirements. Makeup hours will be scheduled as clinically indicated and as authorized under the current service plan.`;

    // No auto-save (persistence is explicit-save-only, same as the main note path) — the absence note
    // is written to session_notes only when the RBT saves it, so it can't accumulate on regeneration.

    if (onChunk) onChunk(absenceNote);

    return {
      note: absenceNote,
      clientId: input.clientId,
      sessionDate: date,
      behaviorsDocumented: [],
      replacementSkillsDocumented: [],
      generatedAt: new Date().toISOString(),
      similarityWarning: false,
    };
  }

  // Steps 2, 3, 5: Run all DB queries in parallel
  const [topographies, replacementSkills, previousNotes] = await Promise.all([
    prisma.topographies.findMany({
      where: {
        behavior_id: {
          in: [
            '00000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000002',
            '00000000-0000-0000-0000-000000000003',
            '00000000-0000-0000-0000-000000000004',
            '00000000-0000-0000-0000-000000000005',
          ],
        },
      },
      select: { description: true, vocabulary_variants: true, behavior_id: true },
    }),
    prisma.replacement_skills.findMany({
      select: { skill_description: true, vocabulary_variants: true, function_targeted: true },
    }),
    prisma.session_notes.findMany({
      where: { client_id: input.clientId },
      select: { note_text: true },
      orderBy: { created_at: 'desc' },
      take: 10,
    }),
  ]);

  const previousTexts = previousNotes
    .map((r) => r.note_text as string)
    .filter(Boolean);

  // Step 4: Build the structured context for the AI
  const sessionContext = {
    sessionInfo: input.sessionInfo,
    clientProfile: {
      diagnosis: resolvedProfile.diagnosis || [],
      setting: resolvedProfile.setting || '',
      settingDetails: resolvedProfile.settingDetails || '',
      approvedInterventions: resolvedProfile.approvedInterventions || [],
      prohibitedInterventions: resolvedProfile.prohibitedInterventions || [
        'Punishment', 'ResponseCost', 'Restraint',
        'StandaloneExtinction', 'TimeOut', 'Overcorrection', 'Aversive'
      ],
      reinforcers: resolvedProfile.reinforcers || {},
      activePrograms: resolvedProfile.activePrograms || {},
    },
    behaviorsObserved: input.behaviorsObserved.map(b => ({
      ...b,
      topographyVariants: topographies
        .filter(t => t.description?.toLowerCase().includes(b.name.toLowerCase()))
        .map(t => t.vocabulary_variants)
        .flat()
        .slice(0, 4)
    })),
    replacementSkillsAddressed: input.replacementSkillsAddressed.map(s => ({
      ...s,
      vocabularyVariants: replacementSkills
        .find(r => r.skill_description?.toLowerCase().includes(s.name.toLowerCase().split(' ')[0]))
        ?.vocabulary_variants || []
    })),
    activitiesUsed: input.activitiesUsed,
    reinforcersUsed: input.reinforcersUsed,
    // Server-side guard: drop any "Next scheduled appointment:" clause whose date is not strictly
    // after the session date, so a past/equal next-session date never reaches the note regardless
    // of which form (or future caller) built clinicalEvents.
    clinicalEvents: stripInvalidNextSession(input.clinicalEvents || '', input.sessionInfo.date),
    knowledgeBase: {
      topographyVariants: topographies.map(t => ({
        description: t.description,
        variants: t.vocabulary_variants
      })),
      replacementSkillVariants: replacementSkills.map(r => ({
        skill: r.skill_description,
        variants: r.vocabulary_variants,
        function: r.function_targeted
      }))
    }
  };

  // Step 6: Generate the note using the master prompt + contextual clinical factors
  const contextualFactors = buildContextualFactors(input);
  // Per-behavior approved-function constraint (from the assessment). The written function for each
  // behavior MUST be in its approved set; the post-generation gate enforces it.
  const approvedFunctionLines = input.behaviorsObserved
    .filter((b) => Array.isArray(b.allowedFunctions) && b.allowedFunctions.length)
    .map((b) => {
      // Prefer functions the client's ABA Matrix can record (approved ∩ dropdown). When that intersection
      // is empty (a config gap — the matrix lacks a function the assessment requires) fall back to the
      // full approved set so the prose still states a clinically valid function. Use THIS behavior's own
      // dropdown (per-behavior); the top-level union is only a fallback for pre-per-behavior captures.
      const { allowed } = effectiveAllowedFunctions(b.allowedFunctions, b.matrixFunctions ?? input.matrixFunctions);
      const set = allowed.size ? [...allowed].map(functionDisplayLabel) : b.allowedFunctions!.map(functionDisplayLabel);
      return `- ${b.name}: ${set.join(' or ')}`;
    })
    .join('\n');
  const approvedFunctionConstraint = approvedFunctionLines
    ? `\n\nAPPROVED BEHAVIOR FUNCTIONS — HARD CONSTRAINT (do not violate): the assessment approved ONLY these functions per behavior. Assign each behavior a function from its approved set, and write an antecedent consistent with that function. NEVER assign a function outside a behavior's approved set:\n${approvedFunctionLines}`
    : '';
  // Closed teaching-method set (Commit 4, Part 1): the replacement-skill prose may name ONLY a method
  // the assessment approves, so the fill can copy an approved method. Derived from the LIVE profile, so
  // updating the assessment updates what is allowed.
  const approvedMethodSet = [...approvedTeachingMethods(resolvedProfile.approvedInterventions)];
  const approvedMethodConstraint = approvedMethodSet.length
    ? `\n\nAPPROVED TEACHING METHODS — HARD CONSTRAINT (do not violate): when you state how a replacement skill was practiced, name ONLY a teaching method from this approved set — ${approvedMethodSet.join(', ')}. NEVER name a method outside it; never default to "Modeling" or "DTT" unless it is in this set.`
    : '';
  const userPrompt = `Generate a clinical ABA session note using this session data:\n\n${JSON.stringify(sessionContext, null, 2)}${approvedFunctionConstraint}${approvedMethodConstraint}\n\nRemember: ONE continuous paragraph, EXACTLY 5 ABCs, no mentalistic language, no prohibited interventions, all activities in parentheses format, every behavior must have an intervention.`;

  async function callOpenAI(systemContent: string): Promise<string> {
    if (onChunk) {
      const stream = await openai.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0.85,
        seed: Math.floor(Math.random() * 1000000),
        max_tokens: 2000,
        stream: true,
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: userPrompt }
        ]
      });
      let text = '';
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        if (delta) { text += delta; onChunk(delta); }
      }
      return text;
    }
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.85,
      seed: Math.floor(Math.random() * 1000000),
      max_tokens: 1500,
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: userPrompt }
      ]
    });
    return resp.choices[0].message.content || '';
  }

  let note = await callOpenAI(MASTER_RBT_NOTE_PROMPT + contextualFactors);

  // Step 7: Similarity check — compare against entire note history
  let similarityWarning = false;
  if (previousTexts.length > 0) {
    const tooSimilar = previousTexts.some(prev => calculateSimilarity(note, prev) > 0.60);
    if (tooSimilar) {
      if (onChunk) onChunk('\n__REGEN__\n');
      const variationInstruction = `\n\nIMPORTANT: This note is too similar to a previous session note. You must vary the sentence starters, intervention descriptions, behavior topographies used, and narrative structure significantly. Use completely different ABC sequences and different order of events. The note must read as a distinctly different session.`;
      note = await callOpenAI(MASTER_RBT_NOTE_PROMPT + contextualFactors + variationInstruction);

      // If still too similar after regeneration, flag it but return the note
      const stillTooSimilar = previousTexts.some(prev => calculateSimilarity(note, prev) > 0.60);
      if (stillTooSimilar) {
        similarityWarning = true;
        console.warn('[generateSmartNote] Note similarity still >60% after regeneration for client:', input.clientId);
      }
    }
  }

  // Step 7b: Strip host-EHR-blocked narrative terms (payer-compliance on ABA Matrix's side — e.g.
  // "sensory" is not billable under 97153 and is rejected on submit). Substitute where we can, flag
  // where we can't. Merge in any per-client terms the extension learned from host validation
  // messages. Runs BEFORE save so the stored/reused note is also clean. Re-runnable so the
  // intervention gate (Step 7c) can re-clean a regenerated note.
  let learnedBlockedTerms: BlockedTerm[] = [];
  try {
    const c = await prisma.clients.findUnique({ where: { id: input.clientId }, select: { clinical_profile: true } });
    const bt = (c?.clinical_profile as any)?.blockedNarrativeTerms;
    if (Array.isArray(bt)) {
      learnedBlockedTerms = bt
        .map((t: any) => (typeof t === 'string' ? { term: t, substitute: null } : { term: t?.term, substitute: t?.substitute ?? null }))
        .filter((t: BlockedTerm) => t.term);
    }
  } catch { /* learned terms are best-effort; the seeded list still applies */ }
  let blockedFlagged: string[] = [];
  const applyBlockedFilter = (text: string): string => {
    const result = filterBlockedNarrative(text, learnedBlockedTerms);
    blockedFlagged = result.flagged;
    return result.text;
  };
  note = applyBlockedFilter(note);

  // Step 7c: TREATMENT-PLAN INTERVENTION GATE (compliance, not quality). An RBT may document ONLY
  // interventions in the client's approved assessment — an out-of-plan procedure records work
  // outside scope, bills against an authorization that does not cover it, and exposes the
  // supervising BCBA to liability. A prompt instruction is not enough (the model has generated RIRD
  // despite the constraint), so this is a hard gate: if the note documents a prohibited (e.g. RIRD)
  // or unapproved intervention, regenerate ONCE naming the violation; if it still violates, throw an
  // error naming the intervention rather than return a note the RBT might sign. With NO approved
  // list captured we cannot know the plan, so only the always-prohibited set applies — we never
  // block every note for a client whose approved interventions were never synced.
  const approvedInterventions: string[] = resolvedProfile.approvedInterventions || [];
  // Skill programs (replacement skills). Role-awareness: a skill like FCT is valid documented as a
  // skill being taught, but INVALID documented as a behavior-reduction intervention unless it is also
  // an approved reduction intervention.
  const skillPrograms: string[] = resolvedProfile.activePrograms?.replacementSkills || [];
  let violations = findInterventionViolations(note, approvedInterventions, skillPrograms);
  const violatingNames = () => [...new Set([...violations.prohibited, ...violations.unapproved, ...violations.skillAsReduction])];
  if (violatingNames().length > 0) {
    const bad = violatingNames();
    const roleNote = violations.skillAsReduction.length
      ? ` NOTE: ${violations.skillAsReduction.join(', ')} ${violations.skillAsReduction.length === 1 ? 'is a skill program' : 'are skill programs'}, not an approved reduction intervention — document ${violations.skillAsReduction.length === 1 ? 'it' : 'them'} ONLY as a skill being taught, never as a behavior-reduction intervention.`
      : '';
    const approvedClause = approvedInterventions.length
      ? `ONLY these approved interventions: ${approvedInterventions.join(', ')}`
      : `ONLY interventions named in the session data's approved list`;
    if (onChunk) onChunk('\n__REGEN__\n');
    const violationInstruction = `\n\nCOMPLIANCE VIOLATION — REGENERATE: the previous note documented ${bad.join(', ')}, which ${bad.length === 1 ? 'is' : 'are'} NOT permitted as documented for this client.${roleNote} An RBT may only document reduction interventions the BCBA has approved. Rewrite the entire note using ${approvedClause}. Never mention response interruption and redirection (RIRD) or any intervention outside the approved list.`;
    note = applyBlockedFilter(await callOpenAI(MASTER_RBT_NOTE_PROMPT + contextualFactors + violationInstruction));
    violations = findInterventionViolations(note, approvedInterventions, skillPrograms);
    if (violatingNames().length > 0) {
      const still = violatingNames();
      throw new Error(
        `Note could not be generated within the client's approved treatment plan: it repeatedly documented ${still.join(', ')}, which ${still.length === 1 ? 'is' : 'are'} not approved for this client. ` +
        `An RBT may only document interventions in the approved plan — please review the client's assessment or regenerate.`
      );
    }
  }

  // Step 7c2: APPROVED-FUNCTION GATE. The function written for each behavior must be a member of that
  // behavior's assessment-approved set (allowedFunctions, from clinical_profile). We derive the written
  // function per behavior from the note; if any behavior asserts a function the assessment did NOT
  // approve for it (e.g. "Throwing Objects" written as Automatic when the assessment approved only
  // Escape/Tangible/Attention), regenerate ONCE naming the violation; if it still violates, surface a
  // coherence flag rather than return a note asserting an unapproved function. With no approved set
  // captured for a behavior, it is not constrained (we enforce only what the assessment specifies).
  const findFunctionViolations = (text: string): { name: string; wrote: string; approved: string[] }[] => {
    const gated = input.behaviorsObserved.filter((b) => Array.isArray(b.allowedFunctions) && b.allowedFunctions.length);
    if (!gated.length) return [];
    const segments = segmentNoteByBehavior(text, input.behaviorsObserved);
    const out: { name: string; wrote: string; approved: string[] }[] = [];
    input.behaviorsObserved.forEach((b, i) => {
      const approved = b.allowedFunctions || [];
      if (!approved.length) return;
      const wrote = deriveBehaviorFunction(segments[i], b).resolved;
      const canonical = functionToCanonical(wrote);
      if (canonical && !normalizeApprovedFunctions(approved).has(canonical)) {
        out.push({ name: b.name, wrote, approved });
      }
    });
    return out;
  };
  let functionViolations = findFunctionViolations(note);
  if (functionViolations.length > 0) {
    if (onChunk) onChunk('\n__REGEN__\n');
    const detail = functionViolations
      .map((v) => `${v.name} (written as ${v.wrote}; approved: ${v.approved.map(functionDisplayLabel).join(', ')})`)
      .join('; ');
    const functionInstruction = `\n\nBEHAVIOR-FUNCTION VIOLATION — REGENERATE: the note assigned a behavior a function the assessment did NOT approve for it — ${detail}. For EACH behavior, assign ONLY a function from its approved set, and write an antecedent consistent with that approved function. Never write a function outside a behavior's approved set.`;
    note = applyBlockedFilter(await callOpenAI(MASTER_RBT_NOTE_PROMPT + contextualFactors + functionInstruction));
    functionViolations = findFunctionViolations(note);
  }

  // Step 7c3: TEACHING-METHOD GATE (Commit 4, Part 1). A teaching procedure named in the note must be in
  // the client's approved set (interventions ∩ teaching-method vocabulary). The generator defaults to
  // "Modeling"/"DTT" as filler regardless of the plan; if the note names an unapproved method, regenerate
  // ONCE naming the violation, then flag. The fill (Part 2) copies the note's method, so this keeps the
  // copied method always approved.
  let methodViolations = findTeachingMethodViolations(note, resolvedProfile.approvedInterventions);
  if (methodViolations.length > 0) {
    if (onChunk) onChunk('\n__REGEN__\n');
    const methodClause = approvedMethodSet.length
      ? `ONLY teaching methods the plan approves: ${approvedMethodSet.join(', ')}`
      : `NO named teaching procedure — describe how the skill was practiced without naming a method`;
    const methodInstruction = `\n\nTEACHING-METHOD VIOLATION — REGENERATE: the note named teaching method(s) the assessment did NOT approve for this client — ${methodViolations.join(', ')}. When you describe how a replacement skill was practiced, name ${methodClause}. Never name a teaching procedure outside the approved list.`;
    note = applyBlockedFilter(await callOpenAI(MASTER_RBT_NOTE_PROMPT + contextualFactors + methodInstruction));
    methodViolations = findTeachingMethodViolations(note, resolvedProfile.approvedInterventions);
  }

  // Step 7d: Function↔antecedent coherence flags. Automatic reinforcement requires the ABSENCE of a
  // social antecedent; a clause asserting automatic function while describing a demand, directed
  // transition, item removal, or attention shift is contradictory. We surface these to the RBT as
  // "review before using" — we never auto-rewrite, because a wrong function needs a human decision.
  const coherenceFlags = findFunctionAntecedentContradictions(note);
  // Step 7e: Universal 97153 red-flag phrases (vague/mentalistic/generic/filler). These are the
  // Medicaid documentation red flags any auditor scans for. We SURFACE them like the coherence flags
  // for the RBT to rewrite — never auto-strip, since a vague phrase needs a human's observable detail.
  const redFlags = findRedFlagFlags(note);
  // Any approved-function violation that survived the regeneration is surfaced (not auto-corrected).
  for (const v of functionViolations) {
    coherenceFlags.push(
      `"${v.name}" was written as ${v.wrote}, which the assessment did not approve for it (approved: ${v.approved.map(functionDisplayLabel).join(', ')}) — verify before using.`,
    );
  }
  // Any teaching-method violation that survived the regeneration is surfaced (not auto-corrected).
  for (const m of methodViolations) {
    coherenceFlags.push(
      `Teaching method "${m}" was named but the assessment does not approve it for this client — verify before using.`,
    );
  }

  // Step 8: NO auto-save. Generation (and every regeneration) used to persist a row here, so a single
  // session date accumulated one row per generation — the RBT could not tell which version was used,
  // and there was no authoritative note. Persistence is now EXPLICIT-SAVE-ONLY: the note is written to
  // session_notes only when the RBT saves it (/api/session-notes on the web + note page, or
  // /api/extension/save-note from the extension), each of which already guards against exact duplicates.
  // A regeneration therefore never adds a row and never silently replaces a note the RBT already saved.

  return {
    note,
    clientId: input.clientId,
    sessionDate: input.sessionInfo.date,
    behaviorsDocumented: input.behaviorsObserved.map(b => b.name),
    replacementSkillsDocumented: input.replacementSkillsAddressed.map(s => s.name),
    generatedAt: new Date().toISOString(),
    similarityWarning,
    blockedFlagged,
    coherenceFlags,
    redFlags,
  };
}
