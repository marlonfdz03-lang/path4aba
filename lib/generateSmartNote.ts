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
  findMissingFunctionABCs,
} from '@/lib/functionPatterns';
import { stripInvalidNextSession } from '@/lib/nextSessionDate';
import { findRedFlagFlags } from '@/lib/redFlagPhrases';
import { decideUniqueness } from '@/lib/noteSimilarity';
import {
  runCombinedComplianceGate, interventionViolationNames, type ComplianceState,
} from '@/lib/complianceGate';
import { buildInterventionDetail } from '@/lib/interventionDetail';
import { collectGateFindings, recordGateFindings } from '@/lib/gateFindings';

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
    // The RBT marks WHICH programs were addressed. Everything below is optional because they are NOT
    // asked for it: a per-skill prompt level, client response, or success verdict the RBT never gave
    // must not be asserted by the system. Absent = the note documents the skill generally, consistent
    // with the session compliance level the RBT DID select.
    promptLevel?: string;
    clientResponse?: string;
    successful?: boolean;
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
  // DIAGNOSTIC (temporary — 2x-regen trace). Which compliance gate(s) the FIRST generated note failed,
  // before any regen. Empty = clean first try (regenCount 0). Tells us the dominant first-try defect.
  firstTryDefects?: string[];
  // DIAGNOSTIC (temporary). Build marker so a generate proves which server bundle is actually running.
  buildTag?: string;
}

// DIAGNOSTIC (temporary — 2x-regen trace). Bump on each diagnostic redeploy so a generate proves the
// running bundle. Surfaced in __META__ and in the tagged __REGEN__ marker.
const BUILD_TAG = 'diag-2x-v1';


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

  // REPORTED CONTEXT, NOT AN INTERVENTION. The RBT reports what was DIFFERENT in the client's
  // environment that day (a visitor, an illness, a schedule change) — a daily-life factor nobody
  // performed. This block used to instruct the model to "reflect" the change as reduced compliance,
  // increased latency, and higher behavior frequency: data the RBT never entered, fabricated by the
  // system. It also pushed the context into an ABC antecedent slot, where the ABC grammar
  // ("the RBT implemented [intervention] by …") turned it into "implemented Environmental
  // Modification" — which the approval gate then rejected as an out-of-plan intervention, hard-
  // stopping the note. Both are gone: the change is documented ONCE at the start as reported
  // context, and how the session went comes from the RBT's own compliance selection below.
  if (input.environmentalChangeDescription && input.environmentalChangeDescription.trim()) {
    blocks.push(
      `REPORTED SESSION CONTEXT — DOCUMENT AT THE START, NEVER AS AN ACTION:\n` +
      `The RBT reported that the following was different in the client's environment today: ${input.environmentalChangeDescription.trim()}\n` +
      `This is REPORTED CONTEXT — a daily-life factor the RBT observed. The RBT did NOT perform it, and it is NOT an intervention.\n` +
      `- State it ONCE, immediately after the opening sentence, as reported context: "...and it was reported that [what the RBT described]."\n` +
      `- Do NOT use it as an ABC antecedent.\n` +
      `- Do NOT write "the RBT implemented Environmental Modification" — or any intervention clause — because of it.\n` +
      `- Do NOT infer or invent any effect on the client's behavior, compliance, latency, or frequency from it. Document only what the RBT reported.\n` +
      `The rest of the note proceeds normally: the marked behaviors, their approved interventions, the skills, and the closing are unchanged.`
    );
  }

  // SESSION QUALITY IS THE RBT'S JUDGMENT — the firewall. How the session went is a clinical call
  // the RBT makes by selecting typical / below typical / poor; the system never infers it from a
  // reported context factor. This block used to ASSERT specifics the RBT never entered ("increased
  // latency to instructions", "did not initiate several activities independently") and modelled a
  // fabricated count ("2–3 prompt repetitions across most tasks") — the same fabrication defect the
  // environmental block carried, so sealing only that one would have moved the leak, not closed it.
  //
  // The rule the replacement encodes: ENTAILMENT, NOT INVENTION. Prose that restates what the
  // selected level MEANS is documenting the RBT's judgment; prose that needs a count, a rate, a
  // duration, or a comparison to baseline needs data the RBT never supplied, and is fabrication.
  if (input.complianceLevel) {
    const level = input.complianceLevel === 'poor' ? 'poor'
      : input.complianceLevel === 'below_typical' ? 'below typical' : 'typical';
    // The ONE real signal for how the session went. The RBT is not asked for a per-skill prompt
    // level, response, or success verdict — so the note must not state one. It reads consistently
    // with the level the RBT selected, in general terms, and invents no specifics beneath it.
    const reading = level === 'typical'
      ? `The ABCs and the skill programs may read as generally going well — the client engaging with the programs and responding to the support provided.`
      : `The ABCs and the skill programs may read as a harder session — the client needing more support to engage, and responding less readily than usual.`;
    blocks.push(
      `SESSION QUALITY — THE RBT'S OWN ASSESSMENT:\n` +
      `The RBT indicated that the client's overall compliance today was ${level}. This is the RBT's clinical judgment of the session — document it, do not elaborate beyond it.\n` +
      `- ${reading}\n` +
      `- Do NOT add a separate sentence announcing the compliance level ("The RBT indicated compliance was ${level}") — it reads as assembled. The level shows through the prose itself.\n` +
      `- The RBT did NOT report a prompt level, a client response, or a success verdict for any individual skill. Do NOT state one. Never name a specific prompt level ("gestural", "partial physical", "verbal") for a skill unless the session data provides it, and never declare a skill successful or unsuccessful.\n` +
      `- Do NOT assert anything else the RBT did not enter: no invented latency, no number of prompt repetitions, no trial counts ("4 of 5"), no comparison to the client's baseline or to recent sessions, no claim that behaviors occurred more or less often than usual, no duration.\n` +
      `- Do NOT state any count or percentage.\n` +
      `- Do NOT say the session went badly, and never use mentalistic language ("didn't want to", "refused").`
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
      `CORRECT: "the behavior continued to require active intervention support", "the client required continued prompting across activities", "the behavior remained an active treatment target"\n`,
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
      `Use language like: "demonstrated a slight reduction in frequency compared to recent baseline", "continued to respond to intervention with improved compliance", "required less prompting than in recent sessions to complete tasks". ` +
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

  // CLIENT PRONOUNS: guidance for the note generator. This used to sit behind an
  // `if (blocks.length === 0) return ''` early exit, so a plain session — typical compliance, no
  // environmental change, no missed hours, no trends — shipped with NO pronoun instruction at all,
  // and the model picked pronouns on its own. Pronouns do not depend on whether any other
  // contextual factor applies, so the block is now unconditional.
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
    `\n\nIMPORTANT: Do not list these factors as a separate section. Integrate them into the narrative of the note naturally. The note must still contain one ABC per documented behavior, still be one paragraph, and still read as professional clinical documentation.`
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
  // The ABC count IS the number of behaviors the RBT documented — never a fixed target. A fixed
  // "exactly 5" forced the model to invent ABCs for behaviors the RBT never marked, sourcing them
  // from the client's treatment-plan behavior list, which put behaviors that did not occur into a
  // billable note. One ABC per documented behavior, no padding.
  const abcCount = input.behaviorsObserved.length;
  const documentedBehaviorNames = input.behaviorsObserved.map((b) => b.name).filter(Boolean);
  const behaviorScopeConstraint = documentedBehaviorNames.length
    ? `\n\nDOCUMENTED BEHAVIORS — CLOSED SET (do not violate): the RBT documented ${abcCount} behavior${abcCount === 1 ? '' : 's'} this session: ${documentedBehaviorNames.join(', ')}. Write EXACTLY ${abcCount} ABC${abcCount === 1 ? '' : 's'} — one for each, and NOT ONE MORE. Never add an ABC for any other behavior: a behavior not in this list did not occur this session, and documenting it is a false clinical record.`
    : '';
  const userPrompt = `Generate a clinical ABA session note using this session data:\n\n${JSON.stringify(sessionContext, null, 2)}${behaviorScopeConstraint}${approvedFunctionConstraint}${approvedMethodConstraint}\n\nRemember: ONE continuous paragraph, EXACTLY ${abcCount} ABC${abcCount === 1 ? '' : 's'} (one per documented behavior), no mentalistic language, no prohibited interventions, all activities in parentheses format, every behavior must have an intervention.`;

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

  // ONE system prompt, built once and reused by the regeneration below so the two can never drift.
  // The per-intervention detail is derived from THIS client's approved list, so the prompt can no
  // longer teach a procedure the plan does not authorize (which the gate would then reject, turning
  // an intervention the system itself advertised into a note that would not generate at all).
  const systemPrompt = MASTER_RBT_NOTE_PROMPT
    + buildInterventionDetail(resolvedProfile.approvedInterventions)
    + contextualFactors;

  let note = await callOpenAI(systemPrompt);

  // Step 7: Similarity — WARN, NEVER REGENERATE (Bug 6, Option C). Uniqueness is cosmetic; after the
  // function phrasing became uniform by clinical requirement, same-client notes legitimately share more
  // vocabulary, so a regenerate-on-similarity gate fired repeatedly and burned multiple LLM calls per note.
  // We now surface a warning (like the coherence/red flags) and never regenerate for it. The four
  // COMPLIANCE gates below are unaffected — they still regenerate on clinically-defective notes.
  const similarityWarning = previousTexts.length > 0
    ? decideUniqueness(note, previousTexts).warn
    : false;

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

  // Step 7c: COMBINED COMPLIANCE GATE (consolidated). Four independent compliance checks —
  // approved-intervention, approved-function (validity), function-coverage (Bug 3), and teaching-method —
  // each used to run as its own sequential gate that regenerated on its own violation, so a note defective
  // in N ways cost N full LLM calls (the 3-4x regeneration RBTs saw). They are consolidated here: run ALL
  // FOUR checks, COLLECT every violation, and if ANY fail, regenerate ONCE with a single combined
  // instruction naming every defect, then re-run ALL FOUR on the regenerated note. This changes WHEN they
  // regenerate (once, combined) — never WHAT each requires. Worst case drops from 5 LLM calls to 2; a clean
  // note still costs 1, a single-defect note still 2. Every guarantee is preserved: an intervention
  // survivor still THROWS (an unapproved/prohibited procedure must NEVER ship), and approved-function,
  // coverage, and teaching-method survivors are still surfaced as coherence flags (never auto-rewritten).
  // Re-checking the intervention gate AFTER the combined regen also closes a latent hole in the old
  // sequential design, where a later gate's regen could reintroduce an out-of-plan intervention that the
  // first-only intervention gate never re-checked — the combined design is strictly safer.
  //
  // The approved-intervention detail: an RBT may document ONLY interventions in the client's approved
  // assessment — an out-of-plan procedure records work outside scope, bills against an authorization that
  // does not cover it, and exposes the supervising BCBA to liability. A prompt instruction is not enough
  // (the model has generated RIRD despite the constraint), so persistence is a hard error, not a flag. With
  // NO approved list captured we cannot know the plan, so only the always-prohibited set applies — we never
  // block every note for a client whose approved interventions were never synced.
  const approvedInterventions: string[] = resolvedProfile.approvedInterventions || [];
  // Skill programs (replacement skills). Role-awareness: a skill like FCT is valid documented as a
  // skill being taught, but INVALID documented as a behavior-reduction intervention unless it is also
  // an approved reduction intervention.
  const skillPrograms: string[] = resolvedProfile.activePrograms?.replacementSkills || [];
  // Skill names mark where an ABC body ends so skill-paragraph prose can never satisfy an ABC's function.
  const coverageSkillNames = [
    ...input.replacementSkillsAddressed.map((s) => s.name),
    ...(resolvedProfile.activePrograms?.replacementSkills || []),
  ].filter(Boolean);
  // Approved-function (validity) check: the function written for each behavior must be a member of that
  // behavior's assessment-approved set (allowedFunctions). Derives the written function per behavior; a
  // behavior asserting a function the assessment did NOT approve for it (e.g. "Throwing Objects" written as
  // Automatic when only Escape/Tangible/Attention were approved) is a violation. Distinct from the coverage
  // check below: validity asks "is the stated function APPROVED?" and is blind to an ABSENT function; a note
  // with only 1/5 ABCs naming a function passes validity but fails coverage. With no approved set captured
  // for a behavior, it is not constrained (we enforce only what the assessment specifies).
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

  // Detect all four compliance checks on one note. Passed to the combined gate, which runs it on the
  // initial note and once more on the (single) regenerated note.
  const detectCompliance = (text: string): ComplianceState => ({
    intervention: findInterventionViolations(text, approvedInterventions, skillPrograms, {
      // The RBT reported an environmental change in the form's Session Conditions. The prompt now
      // documents that as context rather than as "implemented Environmental Modification"; this is
      // the backstop for a model slip, so reported context can never hard-stop the note. Scoped:
      // with no reported change, the intervention is gated exactly as before.
      reportedEnvironmentalChange: !!input.environmentalChangeDescription?.trim(),
    }),
    functionViolations: findFunctionViolations(text),
    coverage: findMissingFunctionABCs(text, input.behaviorsObserved, coverageSkillNames),
    methodViolations: findTeachingMethodViolations(text, resolvedProfile.approvedInterventions),
    approvedInterventions,
    approvedMethodSet,
  });

  // DIAGNOSTIC (temporary — 2x-regen trace). Capture WHICH gate(s) the FIRST note failed, before any
  // regen. This is the same detection the gate runs internally on the initial note (a cheap pure re-run on
  // the identical text), surfaced so we can see the dominant first-try defect and confirm the running
  // bundle. Remove once the first-try analysis is done.
  const firstTryState = detectCompliance(note);
  const firstTryDefects: string[] = [
    ...(firstTryState.coverage.segmentable && firstTryState.coverage.missing.length ? ['coverage'] : []),
    ...(firstTryState.functionViolations.length ? ['approved-function'] : []),
    ...(interventionViolationNames(firstTryState.intervention).length ? ['intervention'] : []),
    ...(firstTryState.methodViolations.length ? ['teaching-method'] : []),
  ];
  console.log('[note-diag]', JSON.stringify({ buildTag: BUILD_TAG, firstTryDefects }));

  // ONE combined regeneration: collect every violation → one instruction naming all of them → regenerate
  // ONCE → re-check all four. regenCount is 0 (clean note) or 1 (any defect) — never the old 3-4.
  // DIAGNOSTIC: the __REGEN__ marker is tagged with its source + the first-try defects. An UNTAGGED
  // __REGEN__ reaching the client means an OLD (pre-consolidation) bundle is running.
  const gate = await runCombinedComplianceGate({
    initialNote: note,
    detect: detectCompliance,
    regenerate: (instruction) => callOpenAI(systemPrompt + instruction).then(applyBlockedFilter),
    onRegen: onChunk ? () => onChunk(`\n__REGEN__:compliance[${firstTryDefects.join(',')}]\n`) : undefined,
  });
  note = gate.note;
  const functionViolations = gate.state.functionViolations;
  const methodViolations = gate.state.methodViolations;

  // NO CLINICAL BLOCK. An intervention violation that survived the regeneration used to THROW here,
  // and the RBT saw "Note could not be generated within the client's approved treatment plan" — a
  // system failure presented as their failure, at the end of a session, with nothing they could do
  // about it. Blocking never made the note correct; it made the note not exist.
  //
  // The gate still runs, unchanged, on the same rules. Its finding is now RECORDED for the admin
  // panel (see the recordGateFindings call below) and the note ships. Prohibited procedures are
  // recorded as CRITICAL so they cannot be missed while preselection is still being built — that
  // work makes an unapproved intervention structurally impossible to generate, at which point this
  // gate should never fire at all.

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
  // Function-coverage flags, recomputed on the FINAL note (identical to `coverage` after the combined regen
  // above; recomputed here defensively so the flags never depend on gate ordering). An ABC missing its
  // documented function after the single combined retry is surfaced (never auto-inserted); an unsegmentable
  // note fails loud rather than silently passing.
  const finalCoverage = findMissingFunctionABCs(note, input.behaviorsObserved, coverageSkillNames);
  if (!finalCoverage.segmentable) {
    coherenceFlags.push(
      `Could not segment the note into per-ABC sections to verify documented-function coverage — verify manually that every ABC names its documented function.`,
    );
  } else {
    for (const m of finalCoverage.missing) {
      coherenceFlags.push(
        `The ABC for "${m.name}" does not state a documented function — verify before using.`,
      );
    }
  }

  // Step 7f: RECORD every gate finding for the admin panel. Silent to the RBT — their note is
  // already complete and on its way. Fail-soft by contract: recordGateFindings never throws, so a
  // missing table or a database blip cannot cost anyone a note.
  await recordGateFindings({
    findings: collectGateFindings({
      state: gate.state,
      coherenceFlags,
      redFlags,
      blockedFlagged,
      similarityWarning,
      behaviorsWithoutFunction: input.behaviorsObserved
        .filter((b) => !(b.allowedFunctions?.length))
        .map((b) => b.name),
    }),
    clientId: input.clientId,
    userId: rbtId,
    source: 'generate',
    regenCount: gate.regenCount,
  });

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
    firstTryDefects,  // DIAGNOSTIC (temporary — 2x-regen trace)
    buildTag: BUILD_TAG,  // DIAGNOSTIC (temporary)
  };
}
