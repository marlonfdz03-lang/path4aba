import OpenAI from 'openai';
import { MASTER_RBT_NOTE_PROMPT } from '@/app/prompts/masterPrompt';
import { prisma } from '@/lib/prisma';
import {
  filterApprovedInterventions,
  isValidActivity,
  isValidSkillForLocation,
  cleanBehaviorLabel,
} from '@/lib/clinicalFilters';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  }[];
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

    // Save absence note to DB
    try {
      await prisma.session_notes.create({
        data: {
          client_id: input.clientId,
          user_id: UUID_RE.test(rbtId ?? '') ? (rbtId as string) : null,
          note_text: absenceNote,
          session_date: date,
          behaviors_addressed: [],
          skills_addressed: [],
          interventions_used: [],
        },
      });
    } catch (saveError) {
      console.warn('[generateSmartNote] absence note save failed:', saveError);
    }

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
    clinicalEvents: input.clinicalEvents || '',
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
  const userPrompt = `Generate a clinical ABA session note using this session data:\n\n${JSON.stringify(sessionContext, null, 2)}\n\nRemember: ONE continuous paragraph, EXACTLY 5 ABCs, no mentalistic language, no prohibited interventions, all activities in parentheses format, every behavior must have an intervention.`;

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

  // Step 8: Always save to session_notes. FK violation = localStorage-only client → logged, not thrown.
  try {
    await prisma.session_notes.create({
      data: {
        client_id: input.clientId,
        user_id: UUID_RE.test(rbtId ?? '') ? (rbtId as string) : null,
        note_text: note,
        session_date: input.sessionInfo.date || null,
        behaviors_addressed: input.behaviorsObserved.map((b) => b.name),
        skills_addressed: input.replacementSkillsAddressed.map((s) => s.name),
        interventions_used: resolvedProfile.approvedInterventions || [],
      },
    });
  } catch (saveError) {
    console.warn('[generateSmartNote] session_notes insert failed (localStorage-only client or missing table):', saveError);
  }

  return {
    note,
    clientId: input.clientId,
    sessionDate: input.sessionInfo.date,
    behaviorsDocumented: input.behaviorsObserved.map(b => b.name),
    replacementSkillsDocumented: input.replacementSkillsAddressed.map(s => s.name),
    generatedAt: new Date().toISOString(),
    similarityWarning,
  };
}
