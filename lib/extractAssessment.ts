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

const MONTH_TO_NUM: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12',
}

// Convert a summaryTable (Name + monthly-average columns) into historicalData points.
// This is deterministic and runs after AI extraction so it can't be truncated.
// Defaults to 'maladaptive' — summary tables in ABA assessments are almost always behavior tables.
// Only classifies as 'replacement' if the name explicitly matches a known replacement skill.
function summaryTableToHistoricalData(
  table: NonNullable<ExtractedAssessment['summaryTable']>,
  replacementNames: Set<string>,
): ExtractedAssessment['historicalData'] {
  // headers[0] = "Name"; headers[1..] map 1:1 to row.values[0..]
  const dateColumns: { valueIndex: number; weekStart: string }[] = []
  for (let h = 1; h < table.headers.length; h++) {
    const match = table.headers[h].match(/^([A-Za-z]+)\s+(\d{4})$/)
    if (match) {
      const mon = MONTH_TO_NUM[match[1].toLowerCase()]
      if (mon) dateColumns.push({ valueIndex: h - 1, weekStart: `${match[2]}-${mon}-01` })
    }
  }
  if (dateColumns.length === 0) return []

  const points: ExtractedAssessment['historicalData'] = []
  for (const row of table.rows) {
    if (!row.name?.trim()) continue
    // Default maladaptive — only override if name matches a known replacement skill
    const targetType: 'maladaptive' | 'replacement' =
      replacementNames.has(row.name.trim().toLowerCase()) ? 'replacement' : 'maladaptive'

    for (const col of dateColumns) {
      const raw = row.values[col.valueIndex]
      if (!raw || raw === '-' || raw.toLowerCase() === 'n/a') continue
      const value = parseFloat(raw.replace(/[^\d.]/g, ''))
      if (isNaN(value)) continue
      points.push({ name: row.name.trim(), targetType, weekStart: col.weekStart, weekEnd: null, value })
    }
  }
  return points
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
    max_tokens: 16000,
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
A behavior may have many STOs (e.g., STO#1 through STO#19). Extract them ALL as SEPARATE records.

CRITICAL — EACH STO IS ONE STEP, NOT THE FULL JOURNEY:
Each STO describes a single incremental step: a starting value and an ending value for that step only.
DO NOT collapse all STOs into one record.
DO NOT use the original baseline as baselineValue for every STO.
DO NOT use 0 or the final LTO as goalValue for every STO.

CONCRETE EXAMPLE FOR ONE BEHAVIOR — you MUST follow this pattern:
If "Tantrums" has STOs in the document:
  STO#1: reduce from 85 to 80 occurrences per week
  STO#2: reduce from 80 to 75 occurrences per week
  STO#3: reduce from 75 to 70 occurrences per week
  ...continuing through...
  STO#19: reduce from 5 to 0 occurrences per week
You must produce 19 SEPARATE records for Tantrums alone:
  { "name": "Tantrums", "baselineValue": 85, "goalValue": 80 }
  { "name": "Tantrums", "baselineValue": 80, "goalValue": 75 }
  { "name": "Tantrums", "baselineValue": 75, "goalValue": 70 }
  ... (one record per STO step, all the way through STO#19)
  { "name": "Tantrums", "baselineValue": 5, "goalValue": 0 }
You must NEVER produce: { "name": "Tantrums", "baselineValue": 85, "goalValue": 0 }

MULTI-BEHAVIOR RULE — ABSOLUTELY CRITICAL:
EVERY behavior and EVERY skill listed in the document has its OWN INDEPENDENT STO sequence.
You must scan the ENTIRE document and extract ALL STO sequences for ALL behaviors and skills.
Do NOT stop after finding STOs for one behavior. Continue until every behavior and skill has been processed.

MULTI-BEHAVIOR EXAMPLE:
If the document has "Tantrums" (19 STOs: 85→80→75→...→5→0)
AND "Physical Aggression" (8 STOs: 54→46→38→30→22→14→8→0)
AND "Request a Break" replacement skill (6 STOs: 20%→35%→50%→65%→80%→90%)
You must produce 19 + 8 + 6 = 33 TOTAL records in the stos array.

SELF-CHECK BEFORE RETURNING: Count your stos array entries. If a document lists N behaviors each with M STOs, your array must have N×M (approximately) entries. If your count seems low, re-read the document for STOs you may have missed.

For each STO record extract:
- name: the exact behavior or skill name (e.g., "Request a Break", "Tantrums")
- targetType: "replacement" if it is a skill to increase, "maladaptive" if it is a behavior to decrease
- baselineValue: THE STARTING VALUE OF THIS SPECIFIC STEP (e.g., for STO#2 "80 → 75", baselineValue = 80)
- goalValue: THE ENDING VALUE OF THIS SPECIFIC STEP (e.g., for STO#2 "80 → 75", goalValue = 75)
- totalWeeks: number of weeks for this step if stated, otherwise null
- targetDate: target date as YYYY-MM-DD if stated for this step, otherwise null
- startDate: start date as YYYY-MM-DD if stated for this step, otherwise null
If no STOs are present, return an empty array.

━━━ HISTORICAL DATA EXTRACTION RULES ━━━
If the document contains graphs, data tables, or historical progress data showing weekly or monthly values for any skill or behavior, extract each data point.
THIS INCLUDES the Summary Table (see below) — extract monthly averages from it as historical data points.
For each data point extract:
- name: the exact skill or behavior name
- targetType: "replacement" for skills, "maladaptive" for behaviors
- weekStart: week start date as YYYY-MM-DD if parseable; for a month column like "July 2025" use "2025-07-01"; if only a relative label (e.g., "Week 1") use a placeholder like "2025-01-06"
- weekEnd: week end date as YYYY-MM-DD if stated, otherwise null
- value: numeric value (percentage 0–100 for skills, frequency count for behaviors)
If no historical data is present, return an empty array.

━━━ SUMMARY TABLE EXTRACTION RULES ━━━
If the document contains a summary data table (e.g., a table showing behavior names with columns for Baseline, and monthly averages like "July 2025", "August 2025", etc.), extract it completely.
The summaryTable must include:
- headers: array of column headers exactly as they appear (e.g., ["Name", "Baseline", "July 2025", "August 2025"])
- rows: array of ALL row objects — DO NOT SKIP ANY ROWS. If the table has 8 behaviors, rows must have 8 entries.
  Each row has: name (behavior or skill name) and values (array of string values, one per non-name column, in column order)

EXAMPLE: A table with 3 behaviors across 3 months must produce:
{
  "headers": ["Name", "Baseline", "July 2025", "August 2025"],
  "rows": [
    { "name": "Tantrums", "values": ["85", "72", "68"] },
    { "name": "Physical Aggression", "values": ["54", "48", "41"] },
    { "name": "Disruptive Behavior", "values": ["32", "28", "25"] }
  ]
}
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

    // Convert summaryTable monthly columns → historicalData points (deterministic, never truncated).
    // This supplements anything GPT-4o already put in historicalData from text or charts.
    if (parsed.summaryTable) {
      const replacementNames = new Set(
        parsed.replacementSkills.map(s => s.name.toLowerCase().trim())
      );
      const tablePoints = summaryTableToHistoricalData(parsed.summaryTable, replacementNames);

      // Deduplicate against existing historicalData by (name, weekStart)
      const existing = new Set(
        parsed.historicalData.map(p => `${p.name.toLowerCase()}|${p.weekStart}`)
      );
      const newPoints = tablePoints.filter(
        p => !existing.has(`${p.name.toLowerCase()}|${p.weekStart}`)
      );
      parsed.historicalData = [...parsed.historicalData, ...newPoints];
    }

    return stripIdentifiers(parsed);
  } catch (error) {
    console.error('Failed to parse assessment extraction:', error);
    throw new Error('Assessment extraction failed — could not parse AI response');
  }
}
