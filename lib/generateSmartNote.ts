import OpenAI from 'openai';
import { MASTER_RBT_NOTE_PROMPT } from '@/app/prompts/masterPrompt';
import { supabaseServer as supabase } from '@/lib/supabaseServer';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
}

export async function generateSmartNote(input: SessionInput): Promise<GeneratedNote> {
  // Step 1: Get client profile — use provided profile or fetch from Supabase
  let resolvedProfile: any;
  const hasSupabaseClient = !input.clientProfile;

  if (input.clientProfile) {
    resolvedProfile = input.clientProfile;
  } else {
    const { data: client, error } = await supabase
      .from('clients')
      .select('*')
      .eq('id', input.clientId)
      .single();

    if (error || !client) {
      throw new Error(`Client not found: ${input.clientId}`);
    }

    const raw = client.clinical_profile;
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
  const { data: topographies } = await supabase
    .from('topographies')
    .select('description, vocabulary_variants, behavior_id')
    .in('behavior_id', [
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000003',
      '00000000-0000-0000-0000-000000000004',
      '00000000-0000-0000-0000-000000000005'
    ]);

  // Step 3: Fetch replacement skill vocabulary
  const { data: replacementSkills } = await supabase
    .from('replacement_skills')
    .select('skill_description, vocabulary_variants, function_targeted');

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
        ?.filter(t => t.description.toLowerCase().includes(b.name.toLowerCase()))
        ?.map(t => t.vocabulary_variants)
        ?.flat()
        ?.slice(0, 4) || []
    })),
    replacementSkillsAddressed: input.replacementSkillsAddressed.map(s => ({
      ...s,
      vocabularyVariants: replacementSkills
        ?.find(r => r.skill_description.toLowerCase().includes(s.name.toLowerCase().split(' ')[0]))
        ?.vocabulary_variants || []
    })),
    activitiesUsed: input.activitiesUsed,
    reinforcersUsed: input.reinforcersUsed,
    clinicalEvents: input.clinicalEvents || '',
    knowledgeBase: {
      topographyVariants: topographies?.map(t => ({
        description: t.description,
        variants: t.vocabulary_variants
      })) || [],
      replacementSkillVariants: replacementSkills?.map(r => ({
        skill: r.skill_description,
        variants: r.vocabulary_variants,
        function: r.function_targeted
      })) || []
    }
  };

  // Step 5: Generate the note using the master prompt
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.4,
    max_tokens: 1500,
    messages: [
      {
        role: 'system',
        content: MASTER_RBT_NOTE_PROMPT
      },
      {
        role: 'user',
        content: `Generate a clinical ABA session note using this session data:\n\n${JSON.stringify(sessionContext, null, 2)}\n\nRemember: ONE continuous paragraph, EXACTLY 5 ABCs, no mentalistic language, no prohibited interventions, all activities in parentheses format, every behavior must have an intervention.`
      }
    ]
  });

  const note = response.choices[0].message.content || '';

  // Step 6: Save to Supabase (only when client exists in Supabase)
  if (hasSupabaseClient) {
    const { error: saveError } = await supabase
      .from('session_notes')
      .insert({
        client_id: input.clientId,
        session_date: input.sessionInfo.date,
        raw_session_data: sessionContext,
        generated_note: note,
      });

    if (saveError) {
      console.error('Failed to save session note:', saveError);
    }
  }

  return {
    note,
    clientId: input.clientId,
    sessionDate: input.sessionInfo.date,
    behaviorsDocumented: input.behaviorsObserved.map(b => b.name),
    replacementSkillsDocumented: input.replacementSkillsAddressed.map(s => s.name),
    generatedAt: new Date().toISOString()
  };
}
