import OpenAI from 'openai';
import { MASTER_RBT_NOTE_PROMPT } from '@/app/prompts/masterPrompt';
import { prisma } from '@/lib/prisma';

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
    rbtName?: string;
  };
  clientId: string;
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

  if (blocks.length === 0) return '';

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

  // Step 2: Fetch relevant topography variants from knowledge base
  const topographies = await prisma.topographies.findMany({
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
  });

  // Step 3: Fetch replacement skill vocabulary
  const replacementSkills = await prisma.replacement_skills.findMany({
    select: { skill_description: true, vocabulary_variants: true, function_targeted: true },
  });

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

  // Step 5: Fetch full note history for this client to check similarity later
  const previousNotes = await prisma.session_notes.findMany({
    where: { client_id: input.clientId },
    select: { note_text: true },
    orderBy: { created_at: 'desc' },
  });

  const previousTexts = previousNotes
    .map((r) => r.note_text as string)
    .filter(Boolean);

  // Step 6: Generate the note using the master prompt + contextual clinical factors
  const contextualFactors = buildContextualFactors(input);
  const userPrompt = `Generate a clinical ABA session note using this session data:\n\n${JSON.stringify(sessionContext, null, 2)}\n\nRemember: ONE continuous paragraph, EXACTLY 5 ABCs, no mentalistic language, no prohibited interventions, all activities in parentheses format, every behavior must have an intervention.`;

  async function callOpenAI(systemContent: string): Promise<string> {
    if (onChunk) {
      const stream = await openai.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0.4,
        max_tokens: 1500,
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
      temperature: 0.4,
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
