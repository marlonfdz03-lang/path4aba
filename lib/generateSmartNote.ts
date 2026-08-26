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
  runCombinedComplianceGate, summarizeSurvivingViolations, type ComplianceState,
} from '@/lib/complianceGate';
import { buildInterventionDetail } from '@/lib/interventionDetail';
import { preselect, buildFixedAssignmentsBlock, type PreselectResult } from '@/lib/preselect';
import { readGenerationHistory } from '@/lib/rotationHistory';
import { assignTiers, tierCounts } from '@/lib/complianceTiers';
import { collectGateFindings, recordGateFindings } from '@/lib/gateFindings';
import { emitAdminAlert } from '@/lib/adminAlerts';

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
    // The FULL assessment topography set for this behavior (the locked set the preselector rotates over).
    // `topography` above is a stable fallback; the preselected one is what the note narrates.
    topographies?: string[];
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
    // Optional: the profile does not record activity preference, so the builder omits it. A legacy
    // FAT payload may still send it; the note never asserts preference on its own.
    preferred?: boolean;
  }[];
  reinforcersUsed: {
    type: 'edible' | 'non-edible' | 'social';
    item: string;
    deliveredWhen: string;
  }[];
  clinicalEvents?: string;
  complianceLevel?: 'typical' | 'below_typical' | 'poor';
  environmentalChangeDescription?: string;
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
  // The preselector's per-note assignments (Commit 4) — returned so the save path can persist it as
  // session_notes.generation_context, which the shared rotation/continuity reader consumes next time.
  // null when preselection was skipped (best-effort fallback). See preselect.ts.
  generationContext?: PreselectResult | null;
}


function buildContextualFactors(input: SessionInput): string {
  const blocks: string[] = [];

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

  // SESSION QUALITY is now the compliance CONTROLLER (Commit 5): the RBT's typical/below/poor selection is
  // turned into a deterministic outcome TIER per ABC and per skill (assignTiers), handed to GPT inside the
  // FIXED ASSIGNMENTS block, and explained by the static SESSION QUALITY section in the master prompt. There
  // is no per-note prose block here any more — the tier IS the signal, and the entailment/no-quantification
  // rule lives with that static section.

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
  // How much the location filters removed. Both drops are SILENT to the RBT — an activity or skill
  // that does not fit the session's location simply disappears from the note — so the counts are
  // captured here and reported on the outcome record. A client whose skills are consistently dropped
  // is a setting/profile mismatch, invisible until now.
  let activitiesDropped = 0;
  let skillsDropped = 0;
  if (input.activitiesUsed?.length) {
    const beforeActivities = input.activitiesUsed.length;
    input.activitiesUsed = input.activitiesUsed.filter(a =>
      isValidActivity(a.name, input.sessionInfo.location)
    );
    activitiesDropped = beforeActivities - input.activitiesUsed.length;
  }
  if (input.behaviorsObserved?.length) {
    input.behaviorsObserved = input.behaviorsObserved.map(b => ({
      ...b,
      name: cleanBehaviorLabel(b.name),
    }));
  }
  if (resolvedProfile.activePrograms?.replacementSkills?.length) {
    const beforeSkills = resolvedProfile.activePrograms.replacementSkills.length;
    resolvedProfile.activePrograms.replacementSkills =
      resolvedProfile.activePrograms.replacementSkills.filter((s: string) =>
        isValidSkillForLocation(s, input.sessionInfo.location)
      );
    skillsDropped = beforeSkills - resolvedProfile.activePrograms.replacementSkills.length;
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

  // PRESELECTION (Commit 4). Choose every axis FROM its locked set, rotating LRU over the last 3 saved
  // notes, and hand GPT fixed assignments to NARRATE — so it can no longer invent an unapproved function /
  // intervention / method and be rejected after. Every value is a member of its locked set by construction
  // (see preselect.ts + its invariant tests), which makes the class-A gates unable to fire. The activity
  // locked set is input.activitiesUsed (already setting-filtered by the builder); the same list is passed
  // for home and school so the location branch inside preselect is a no-op here.
  const activityNames = (input.activitiesUsed ?? []).map((a) => a.name).filter(Boolean);
  let generationContext: PreselectResult | null = null;
  let fixedAssignmentsBlock = '';
  // Compliance controller: deterministic outcome tier per ABC and per skill from the RBT's level. Below
  // typical / poor never make every item fail; typical never all-perfect — guaranteed by assignTiers.
  //
  // Computed OUTSIDE the try below (it used to sit inside). assignTiers is pure arithmetic over a length
  // — no I/O, nothing that can throw — so this cannot change which path runs, and it means the tier
  // distribution is still reportable on the outcome record when the preselect I/O fails.
  const behaviorTiers = assignTiers(input.complianceLevel, input.behaviorsObserved.length);
  const skillTiers = assignTiers(input.complianceLevel, input.replacementSkillsAddressed.length);
  try {
    const history = await readGenerationHistory(prisma, input.clientId, { window: 3 });
    generationContext = preselect({
      behaviors: input.behaviorsObserved.map((b) => ({
        name: b.name,
        allowedFunctions: b.allowedFunctions ?? [],
        topographies: b.topographies ?? (b.topography ? [b.topography] : []),
      })),
      skills: input.replacementSkillsAddressed.map((s) => ({ name: s.name })),
      approvedInterventions: resolvedProfile.approvedInterventions ?? [],
      approvedMethods: approvedMethodSet,
      location: input.sessionInfo.location,
      homeActivities: activityNames,
      schoolActivities: activityNames,
      complianceLevel: input.complianceLevel,
      behaviorTiers,
      skillTiers,
      history,
    });
    fixedAssignmentsBlock = buildFixedAssignmentsBlock(generationContext);
  } catch (e: any) {
    // Preselection is best-effort: if history read or selection fails, fall back to the pre-preselection
    // path (GPT chooses, the gates still enforce). A rotation hiccup must never cost a note.
    // FALLBACK BEHAVIOR IS UNCHANGED — the two assignments below are exactly what this catch always did.
    generationContext = null;
    fixedAssignmentsBlock = '';
    // The error used to be discarded by a bare `catch {}`, which is why notes exist with a NULL
    // generation_context and no record of why. Observability only: the alert never alters the fallback.
    await emitAdminAlert({
      source: 'note',
      type: 'note.preselect_failed',
      severity: 'warning',
      actorUserId: rbtId,
      clientId: input.clientId,
      payload: {
        message: e?.message || String(e),
        name: e?.name || null,
        stack: e?.stack || null,
        // The two locked sets preselection needs. Empty ones are the likeliest cause of a selection
        // failure (as opposed to the history read failing), so they separate a config gap from a DB blip.
        approvedInterventionsEmpty: !(resolvedProfile.approvedInterventions ?? []).length,
        approvedMethodSetEmpty: !approvedMethodSet.length,
      },
    });
  }
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
    + contextualFactors
    + fixedAssignmentsBlock;

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
  let authorizedNames: string[] = [];
  // SHARED blocked-terms table (global, protects every client). Fail-soft: if the table isn't present yet
  // (migration scripts/blocked-narrative-terms-table.sql not run), fall back to the per-client list below.
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>('SELECT term, substitute FROM blocked_narrative_terms');
    if (Array.isArray(rows) && rows.length) learnedBlockedTerms = rows.map((r) => ({ term: String(r.term), substitute: r.substitute ?? null })).filter((t) => t.term);
  } catch { /* table not present yet → per-client fallback */ }
  try {
    const c = await prisma.clients.findUnique({ where: { id: input.clientId }, select: { clinical_profile: true } });
    const cp = (c?.clinical_profile as any) || {};
    const bt = cp?.blockedNarrativeTerms;
    if (!learnedBlockedTerms.length && Array.isArray(bt)) {
      learnedBlockedTerms = bt
        .map((t: any) => (typeof t === 'string' ? { term: t, substitute: null } : { term: t?.term, substitute: t?.substitute ?? null }))
        .filter((t: BlockedTerm) => t.term);
    }
    // PLAN-CONTENT PROTECTION: authorized names a blocked term may legitimately sit inside (a "Calm-Down
    // Routine" program, a "sensory bin" reinforcer). filterBlockedNarrative leaves these spans untouched.
    const reinf = cp.reinforcers;
    authorizedNames = [
      ...((cp.interventions || []) as any[]).map((x) => x?.name || x),
      ...((cp.replacementBehaviors || []) as any[]).map((x) => x?.name || x),
      ...((cp.skillAcquisition || []) as any[]).map((x) => x?.name || x),
      ...((cp.maladaptiveBehaviors || []) as any[]).flatMap((b) => [b?.name, ...((b?.topographies || []) as any[])]),
      ...(Array.isArray(reinf) ? reinf : reinf && typeof reinf === 'object' ? Object.values(reinf).flat() : []),
    ].map((n) => String(n || '')).filter((n) => n.trim().length >= 3);
  } catch { /* learned terms + protection are best-effort; the seeded list still applies */ }
  let blockedFlagged: string[] = [];
  const applyBlockedFilter = (text: string): string => {
    const result = filterBlockedNarrative(text, learnedBlockedTerms, authorizedNames);
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

  // ONE combined regeneration: collect every violation → one instruction naming all of them → regenerate
  // ONCE → re-check all four. regenCount is 0 (clean note) or 1 (any defect) — never the old 3-4. The
  // __REGEN__ marker signals the client to hold + calmly finalize the streamed note (presentation only).
  const gate = await runCombinedComplianceGate({
    initialNote: note,
    detect: detectCompliance,
    regenerate: (instruction) => callOpenAI(systemPrompt + instruction).then(applyBlockedFilter),
    onRegen: onChunk ? () => onChunk('\n__REGEN__\n') : undefined,
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
  // C6 DATA INTEGRITY: a behavior with NO documented function in the assessment cannot have a function
  // written for it or gated — surface it for assessment review rather than guessing one or silently
  // omitting the behavior. The note still generates for every other behavior. This should not happen
  // (locally 0/87 behaviors have empty functions); if it fires it points at extraction, which is where
  // the fix belongs — the assessment-refresh proof harness catches the same defect at upload.
  for (const b of input.behaviorsObserved) {
    if (!(b.allowedFunctions?.length)) {
      coherenceFlags.push(
        `"${b.name}" has no documented function in the assessment — verify the assessment.`,
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

  // Step 8b: THE OUTCOME RECORD. Exactly ONE row per note that reached the RBT, carrying the whole
  // result in its payload — deliberately not one event per signal. This fires on every single note, so
  // volume is the design constraint: N rows per note would make the feed unreadable and the table grow
  // N times faster for no extra information.
  //
  // This is what makes pass rates and regeneration volume computable. gate_findings answers "which gate
  // fired" and is defect-only — it records NOTHING for a clean note — so the denominator of any rate
  // (how many notes were generated at all) did not exist anywhere until this event. The two coexist:
  // gate_findings keeps the per-finding clinical detail, this keeps the per-note outcome.
  //
  // Severity is ALWAYS 'info', including when gateClean is false: a note that shipped after its one
  // regeneration is a normal outcome, not an incident. The payload carries the detail; severity carries
  // the urgency, and inflating it here would drown the criticals that mean a user lost their note.
  const { clean: gateClean, violations: survivingViolations } = summarizeSurvivingViolations(gate.state);
  await emitAdminAlert({
    source: 'note',
    type: 'note.generated',
    severity: 'info',
    actorUserId: rbtId,
    clientId: input.clientId,
    payload: {
      complianceLevel: input.complianceLevel ?? null,
      // Counts per tier, not the full arrays — the distribution is what a rate is computed from, and
      // the per-item ordering is already reproducible from complianceLevel + the item counts.
      behaviorTiers: tierCounts(behaviorTiers),
      skillTiers: tierCounts(skillTiers),
      behaviorCount: input.behaviorsObserved.length,
      skillCount: input.replacementSkillsAddressed.length,
      regenCount: gate.regenCount,
      gateClean,
      // Present ONLY when something survived, so a clean note's payload stays small and "has the key"
      // is itself the signal. See summarizeSurvivingViolations for why unsegmentable is not clean.
      ...(gateClean ? {} : { survivingViolations }),
      similarityWarning,
      coherenceFlagCount: coherenceFlags.length,
      redFlagCount: redFlags.length,
      // Silent location-filter drops, captured at the top of this function.
      activitiesDropped,
      skillsDropped,
      // false = this note will save with a NULL generation_context (preselection fell back); the
      // matching 'note.preselect_failed' alert carries the reason.
      hasGenerationContext: generationContext !== null,
    },
  });

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
    generationContext,
  };
}
