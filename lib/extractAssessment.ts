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
    people: string;
    tangibles: string;
    activities: string;
    social: string;
  };
  preferredActivities: string[];
  nonPreferredActivities: string[];
  caregivers: string[];
  medications: string[];
  setting_details: string;
  stos: {
    name: string;
    targetType: 'replacement' | 'maladaptive';
    baselineValue: number;
    goalValue: number;
    totalWeeks: number | null;
    targetDate: string | null;
    startDate: string | null;
  }[];
  historicalData: {
    name: string;
    targetType: 'replacement' | 'maladaptive';
    weekStart: string;
    weekEnd: string | null;
    value: number;
  }[];
  summaryTable: {
    headers: string[];
    rows: { name: string; values: string[] }[];
  } | null;
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
    // Only clean topography descriptions — never touch names
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
Before returning JSON, scan the replacementSkills array and remove exact duplicate names. If the same skill name appears in multiple sections (e.g., "Following Instructions" in both Skill Acquisition and Social Goals), include it ONLY ONCE.
Two skills are duplicates if their names are identical (case-insensitive). Keep them separate if names differ meaningfully (e.g., "Request a Break" vs "Request a Break Appropriately" are NOT duplicates — keep both).

━━━ NAME REPLACEMENT RULES ━━━
IMPORTANT: Replace the client's proper name (first name, last name) with "the client" ONLY inside topography descriptions and operational definitions.
NEVER replace names inside behavior names, intervention names, or replacement skill names.
Behavior names like "Inappropriate Social Interaction", "Off-Task Behavior", "Self-Injurious Behavior", "Request a Break" must remain exactly as written in the document.
Do not modify behavior names, intervention names, or skill names in any way. Extract them exactly as they appear in the document.

━━━ OTHER RULES ━━━
For prohibitedInterventions, always include: ["Punishment", "ResponseCost", "Restraint", "StandaloneExtinction", "TimeOut", "Overcorrection", "Aversive"] plus any others mentioned as contraindicated in the document.
For functions, use only these values: ["attention", "escape", "tangible", "automatic"].
For measurableUnit use: "frequency", "duration", or "rate".
For setting use: "home", "school", "clinic", or "community".
For preferredActivities: extract all activities listed as preferred or high-preference in reinforcement assessment or preference assessment sections.
For nonPreferredActivities: extract all activities listed as non-preferred, low-preference, or avoided.
For caregivers: extract names of caregivers, parents, or guardians mentioned in the document (used for session documentation — not saved to clinical database).

━━━ STO EXTRACTION RULES ━━━
Extract EVERY SINGLE STO for EVERY behavior and skill — including mastered STOs, in-progress STOs, and future/upcoming STOs. DO NOT SKIP ANY.
Look in sections titled: "Short-Term Objectives", "STOs", "Treatment Goals", "Goals", "Objectives", numbered goal lists, or any section listing incremental targets.
A behavior may have many STOs (e.g., STO#1 through STO#16). Extract them ALL.
For each STO extract:
- name: the exact behavior or skill name (e.g., "Request a Break", "Aggression")
- targetType: "replacement" if it is a skill to increase, "maladaptive" if it is a behavior to decrease
- baselineValue: numeric baseline (use percentage 0–100 for skills, frequency count for behaviors; parse "40%" as 40, "3x/week" as 3)
- goalValue: numeric goal using the same unit as baselineValue
- totalWeeks: number of weeks if stated (e.g., "within 16 weeks" → 16), otherwise null
- targetDate: target date as YYYY-MM-DD if a specific date is stated, otherwise null
- startDate: start date as YYYY-MM-DD if stated, otherwise null
If no STOs are present, return an empty array.

━━━ HISTORICAL DATA EXTRACTION RULES ━━━
If the document contains graphs, data tables, or historical progress data showing weekly values for any skill or behavior, extract each data point.
For each data point extract:
- name: the exact skill or behavior name
- targetType: "replacement" for skills, "maladaptive" for behaviors
- weekStart: week start date as YYYY-MM-DD if parseable; if only a relative label (e.g., "Week 1") use a placeholder like "2025-01-06"
- weekEnd: week end date as YYYY-MM-DD if stated, otherwise null
- value: numeric value (percentage 0–100 for skills, frequency count for behaviors)
If no historical data is present, return an empty array.

━━━ SUMMARY TABLE EXTRACTION RULES ━━━
If the document contains a summary data table (e.g., a table showing behavior names with columns for Baseline, and monthly averages like "July 2025", "August 2025", etc.), extract it exactly.
The summaryTable must include:
- headers: array of column headers exactly as they appear (e.g., ["Name", "Baseline", "July 2025", "August 2025"])
- rows: array of row objects, each with: name (behavior or skill name) and values (array of string values, one per non-name column)
If no summary table is present, return null.

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
    "people": "people-based reinforcers",
    "tangibles": "tangible reinforcers",
    "activities": "activity-based reinforcers",
    "social": "social reinforcers"
  },
  "preferredActivities": ["all activities listed as preferred or high-preference"],
  "nonPreferredActivities": ["all activities listed as non-preferred or avoided"],
  "caregivers": ["names of caregivers, parents, or guardians"],
  "medications": ["list of medications"],
  "setting_details": "detailed description of home/school environment and routine with client name replaced by 'the client'",
  "stos": [
    {
      "name": "exact target name as written in document",
      "targetType": "replacement|maladaptive",
      "baselineValue": 0,
      "goalValue": 0,
      "totalWeeks": null,
      "targetDate": null,
      "startDate": null
    }
  ],
  "historicalData": [
    {
      "name": "exact target name as written in document",
      "targetType": "replacement|maladaptive",
      "weekStart": "YYYY-MM-DD",
      "weekEnd": null,
      "value": 0
    }
  ],
  "summaryTable": {
    "headers": ["Name", "Baseline", "Month Year"],
    "rows": [
      { "name": "behavior or skill name", "values": ["baseline value", "monthly value"] }
    ]
  }
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

    // Deduplicate replacement skills by name (case-insensitive) as a safety net
    const seen = new Set<string>();
    parsed.replacementSkills = parsed.replacementSkills.filter(s => {
      const key = s.name.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    parsed.stos = parsed.stos ?? [];
    parsed.historicalData = parsed.historicalData ?? [];
    parsed.summaryTable = parsed.summaryTable ?? null;

    return stripIdentifiers(parsed);
  } catch (error) {
    console.error('Failed to parse assessment extraction:', error);
    throw new Error('Assessment extraction failed — could not parse AI response');
  }
}
