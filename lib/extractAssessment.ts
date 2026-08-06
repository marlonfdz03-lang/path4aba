import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY || 'azure-openai',
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/gpt-4o`,
  defaultQuery: { 'api-version': '2025-01-01-preview' },
  defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY },
});

export interface ExtractedAssessment {
  clientCode: string;
  diagnosis: string[];
  age: number | null;
  setting: string;
  maladaptiveBehaviors: {
    name: string;
    topography: string;
    function: string[];
    baselineFrequency: string;
    intensity: number;
    measurableUnit: string;
  }[];
  masteredBehaviors: string[];
  newBehaviors: string[];
  approvedInterventions: string[];
  prohibitedInterventions: string[];
  replacementSkills: {
    name: string;
    targetFunction: string;
    currentAccuracy: string;
    status: string;
  }[];
  reinforcers: {
    // Each is an ARRAY of discrete items (the parser also tolerates a legacy prose string).
    people: string | string[];
    tangibles: string | string[];
    activities: string | string[];
    social: string | string[];
  };
  preferredActivities: string[];
  nonPreferredActivities: string[];
  caregivers: string[];
  medications: string[];
  setting_details: string;
  parentTrainingGoals: string[];
}

function stripIdentifiers(data: ExtractedAssessment): ExtractedAssessment {
  const fullName = /\b[A-Z][a-z]{1,}\s[A-Z][a-z]{1,}\b(?:'s)?/g;
  const possessiveName = /\b[A-Z][a-z]{2,}'s\b/g;
  const caregiverTerms = /\b(mom|dad|mother|father|grandmother|grandfather|grandma|grandpa|guardian|stepmother|stepfather)\b/gi;

  function clean(text: string): string {
    return text
      .replace(fullName, m => m.endsWith("'s") ? "the client's" : "the client")
      .replace(possessiveName, "the client's")
      .replace(caregiverTerms, "caregiver");
  }

  return {
    ...data,
    maladaptiveBehaviors: data.maladaptiveBehaviors.map(b => ({
      ...b,
      topography: clean(b.topography),
    })),
    setting_details: clean(data.setting_details),
  };
}

export async function extractAssessment(text: string): Promise<ExtractedAssessment> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0,
    max_tokens: 8000,
    messages: [
      {
        role: 'system',
        content: `You are an ABA clinical data extraction specialist. Extract structured clinical information from ABA assessment documents. Return ONLY valid JSON, no markdown, no explanation, no code blocks.

Extract every piece of clinical information available. Be thorough and precise. Do not skip any items.

━━━ BEHAVIOR EXTRACTION RULES ━━━
Extract EVERY SINGLE behavior listed under ANY of these sections — DO NOT STOP EARLY, DO NOT LIMIT TO 8 OR 10:
- "Behavior Targeted for Reduction"
- "Maladaptive Behaviors"
- "Target Behaviors"
- "Behaviors to Reduce"
- Any section describing behaviors the client should decrease or stop

There is NO limit on how many behaviors to extract. If there are 20, extract all 20. If there are 30, extract all 30.

━━━ REPLACEMENT SKILL EXTRACTION RULES ━━━
Extract EVERY SINGLE skill listed under ANY of these sections — DO NOT STOP EARLY, DO NOT LIMIT TO 8 OR 10:
- "Behaviors to Increase"
- "Replacement Programs"
- "Skill Acquisition"
- "Communication Goals"
- "Social Goals"
- "Behavior Replacement Goals"
- "Replacement Skills"
- "Skills to Increase"
- Any section describing skills or behaviors the client should learn or increase

There is NO limit on how many skills to extract. If there are 25, extract all 25.

DEDUPLICATION RULE — CRITICAL:
Put ALL replacement skills into ONE replacementSkills array. Do NOT create separate arrays for social skills, communication skills, etc.
Before returning JSON, scan the replacementSkills array and remove exact duplicate names. If the same skill name appears in multiple sections, include it ONLY ONCE.
Two skills are duplicates if their names are identical (case-insensitive).

━━━ NAME REPLACEMENT RULES ━━━
IMPORTANT: Replace the client's proper name (first name, last name) with "the client" ONLY inside topography descriptions and operational definitions.
NEVER replace names inside behavior names, intervention names, or replacement skill names.
Behavior names like "Inappropriate Social Interaction", "Off-Task Behavior", "Self-Injurious Behavior", "Request a Break" must remain exactly as written in the document.
Do not modify behavior names, intervention names, or skill names in any way. Extract them exactly as they appear in the document.

━━━ OTHER RULES ━━━
For prohibitedInterventions, always include: ["Punishment", "ResponseCost", "Restraint", "StandaloneExtinction", "TimeOut", "Overcorrection", "Aversive"] plus any others mentioned as contraindicated in the document.
For functions, use only these values: ["attention", "escape", "tangible", "automatic"].
A behavior can have multiple functions — return ALL that apply based on the description.
IMPORTANT: If the function is not explicitly stated in the document, INFER it from the behavioral description:
- If the behavior occurs when demands are presented, tasks are requested, or activities are interrupted → include "escape"
- If the behavior occurs when attention is removed, adult is busy, or to get adult/peer reaction → include "attention"
- If the behavior occurs when a preferred item is denied or removed → include "tangible"
- If the behavior occurs without clear social antecedent, during alone time, or appears self-stimulatory → include "automatic"
Never return an empty array for function — always infer at least one based on the description.
For targetFunction on replacement skills: use the PRIMARY function of the behavior the skill is designed to replace. If multiple functions apply, pick the most clinically relevant one.
For measurableUnit use: "frequency", "duration", or "rate".
For setting use: "home", "school", "clinic", or "community".
For preferredActivities: extract all activities listed as preferred or high-preference in reinforcement assessment or preference assessment sections.
For nonPreferredActivities: extract all activities listed as non-preferred, low-preference, or avoided.
For caregivers: extract names of caregivers, parents, or guardians mentioned in the document.

INTERVENTION EXTRACTION — CRITICAL:
Extract every ABA intervention, teaching procedure, behavior reduction procedure, antecedent strategy, consequence strategy, prompting procedure, reinforcement procedure, or clinical protocol explicitly described or mentioned anywhere in this assessment. An intervention does not need to match a predefined list — if a BCBA describes a clinical procedure, extract it.

PRIORITY 1 — Dedicated sections:
If the document contains a section titled "Intervention Procedures", "Treatment Procedures", "Behavior Intervention Plan", "Protocol", or similar — extract EVERY intervention listed there first.

PRIORITY 2 — Full document scan:
Search every remaining section of the document for additional interventions not already captured, including:
- Medical Necessity narrative
- Behavior Reduction Plan
- Replacement Programs sections
- Caregiver Training sections
- Treatment Recommendations
- Protocol Modifications
- Changes Made to Behavioral Program
- Any narrative paragraph that describes a clinical procedure

CRITICAL RULE: If an intervention is described inside a narrative paragraph instead of a bullet list or table, it MUST still be extracted. Do not require interventions to appear under a heading such as "Intervention Procedures."

PRIORITY 3 — Merge exact duplicates only:
Remove only exact duplicate names (case-insensitive). Do NOT merge or normalize similar-but-distinct procedures — "Prompting", "Prompt Hierarchy", and "Prompt Fading" may be three separate procedures and should remain separate.

RETURN ALL interventions found. Do NOT limit to any fixed number. If the assessment describes 20 procedures, return 20. Preserve the exact wording used in the assessment whenever possible. Do not paraphrase, rename, simplify, or combine intervention names unless they are exact duplicates differing only by capitalization or spacing.

Examples of interventions to look for (this list is NOT exhaustive — extract any clinical procedure found):
DRA, DRI, DRO, DRL, FCT, Prompting, Prompt Fading, Prompt Hierarchy, Errorless Teaching,
Behavior Momentum, High Probability Request Sequence, Activity Schedule, Visual Schedule,
Visual Supports, Token Economy, Premack Principle, Planned Ignoring, Extinction,
Escape Extinction, Attention Extinction, Redirection, Response Block, Response Interruption,
Response Delay, Environmental Manipulation, Antecedent Manipulation, Antecedent Strategies,
Choice Making, Incidental Teaching, Natural Environment Teaching, NET, DTT, Modeling,
Differential Reinforcement, Hand Over Hand, Chaining, Task Analysis, Reinforcement Systems,
Stimulus Fading, NCR, Noncontingent Reinforcement, Behavioral Skills Training, BST,
Structured Antecedent Strategies, Systematic Prompting, Reinforcement Schedules,
Guided Practice, Caregiver Training Procedures

Return this exact JSON structure:
{
  "clientCode": "generated internal code like initials-DOB-001",
  "diagnosis": ["array of diagnoses with ICD codes if present"],
  "age": number or null,
  "setting": "home|school|clinic|community",
  "maladaptiveBehaviors": [
    {
      "name": "exact behavior name as written in document",
      "topography": "observable definition from document with client name replaced by 'the client'",
      "function": ["attention|escape|tangible|automatic"],
      "baselineFrequency": "number/week as string",
      "intensity": 1-5,
      "measurableUnit": "frequency|duration|rate"
    }
  ],
  "masteredBehaviors": ["list of mastered behaviors"],
  "newBehaviors": ["list of newly identified behaviors"],
  "approvedInterventions": ["exact intervention names as written in document"],
  "prohibitedInterventions": ["Punishment", "ResponseCost", "Restraint", "StandaloneExtinction", "TimeOut", "Overcorrection", "Aversive"],
  "replacementSkills": [
    {
      "name": "exact skill name as written in document",
      "targetFunction": "attention|escape|tangible|automatic",
      "currentAccuracy": "percentage as string if available",
      "status": "acquisition|maintenance|mastered|new"
    }
  ],
  "reinforcers": {
    "people": ["array of discrete people-based reinforcers — ONE item per entry"],
    "tangibles": ["array of discrete tangible reinforcers — ONE item per entry, e.g. \"strawberries\", \"tablet\". NO prose, NO \"such as ...\" lists, NO leading \"and\"/\"or\""],
    "activities": ["array of discrete activity reinforcers — ONE item per entry"],
    "social": ["array of discrete social reinforcers — ONE item per entry, e.g. \"verbal praise\", \"high five\". Strip quotes"]
  },
  "preferredActivities": ["all activities listed as preferred or high-preference"],
  "nonPreferredActivities": ["all activities listed as non-preferred or avoided"],
  "caregivers": ["names of caregivers, parents, or guardians"],
  "medications": ["list of medications"],
  "setting_details": "detailed description of home/school environment and routine with client name replaced by 'the client'",
  "parentTrainingGoals": ["Parent or caregiver training goals listed in the assessment. Look for sections labeled: Parent Training Goals, Caregiver Training Objectives, Family Training Goals, Parent Education Goals, Caregiver Skill Building Goals, Caregiver Objectives, Caregiver Training Goals."]
}`
      },
      {
        role: 'user',
        content: `Extract all clinical information from this ABA assessment document:\n\n${text}`
      }
    ]
  });

  const content = response.choices[0].message.content || '{}';

  try {
    const clean = content.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean) as ExtractedAssessment;

    // Deduplicate replacement skills by name (case-insensitive)
    const seen = new Set<string>();
    parsed.replacementSkills = parsed.replacementSkills.filter(s => {
      const key = s.name.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return stripIdentifiers(parsed);
  } catch (error) {
    console.error('Failed to parse assessment extraction:', error);
    throw new Error('Assessment extraction failed — could not parse AI response');
  }
}
