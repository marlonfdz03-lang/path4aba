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
  // Location-aware activities. homeActivities/schoolActivities hold ONLY activities the assessment
  // EXPLICITLY ties to that setting (split source). preferredActivities holds the flat/untagged remainder.
  // Placement is the split-vs-flat signal the profile builder reads (buildActivityLists uses the tagged
  // fields and discards the flat one). The extractor NEVER infers a setting — unsure → preferredActivities.
  homeActivities: string[];
  schoolActivities: string[];
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
    // Fixed seed + temperature 0 = best-effort reproducibility: the same PDF extracts the same set across
    // runs (fixes the 19-vs-13 reinforcer swing). Seed is best-effort on Azure (a system_fingerprint change
    // can still shift output), so the REINFORCER EXTRACTION RULES block below is what makes it COMPLETE;
    // the seed makes a complete extraction repeatable on top.
    seed: 42,
    // 16000 (GPT-4o max output is 16384) so a large assessment (many behaviors/skills/interventions) never
    // truncates the tail of the JSON — reinforcers/activities/parent-goals sit near the end and would be the
    // first lost. Truncation is caught explicitly below (finish_reason === 'length') rather than surfacing as
    // an opaque JSON parse error.
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
━━━ ACTIVITY EXTRACTION RULES (LOCATION-AWARE) ━━━
Read the WHOLE document for activities the client engages in or prefers — in tables, bullet lists, or narrative prose, under any section name. Do not restrict to a "preference assessment" heading.

SPLIT vs FLAT — this distinction is REQUIRED:
- If the assessment EXPLICITLY ties an activity to a setting — a Home / Home-Routine / Daily-Living section, a School / Classroom section, or an activity plainly labeled home vs school — put it in homeActivities or schoolActivities accordingly.
- If an activity is listed WITHOUT a clear home/school context (one undifferentiated preference list, or activities named with no setting), put it in preferredActivities.

FIREWALL — NEVER INFER THE SETTING:
Place an activity in homeActivities or schoolActivities ONLY when the assessment itself assigns that setting. NEVER guess. If you are unsure whether an activity is home or school, it goes in preferredActivities — not in both, not in a guessed one. Capture only activities the assessment names; never invent activities.

For nonPreferredActivities: extract all activities listed as non-preferred, low-preference, or avoided (anywhere in the document).
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

━━━ REINFORCER EXTRACTION RULES ━━━
Extract EVERY reinforcer and preferred item named ANYWHERE in the assessment — DO NOT STOP EARLY, DO NOT LIMIT, DO NOT summarize, sample, or select a representative subset. If the assessment names 20 reinforcers, return all 20.

WHERE TO LOOK — understand the document and scan ALL of it, not one fixed section:
- Reinforcement / preference assessment results (MSWO, paired-stimulus, free-operant, forced-choice) — capture every item listed
- Any section titled "Reinforcers", "Preferred Items", "Motivating Operations", "Likes / Interests", or similar
- NARRATIVE PROSE anywhere in the document — "enjoys ...", "responds well to ...", "is motivated by ...", "likes ...", and caregiver- or teacher-reported preferences
- Reinforcers embedded inside intervention or reinforcement-schedule descriptions
An item named in a paragraph counts exactly as much as one in a table or bullet list — extract it either way. Do NOT require a heading; different assessments place reinforcers differently, so read the whole document and pull them from wherever they appear.

GRANULARITY — ONE DISCRETE ITEM PER ENTRY:
- When several items appear under one category (e.g. social: smiles, thumbs up, high five, positive tone of voice), capture EACH as its own entry. NEVER collapse a group into a single summary entry.
- Sort each item into the best-fit bucket (people / tangibles / activities / social). If the bucket is ambiguous, STILL capture the item in the closest bucket — never drop a named reinforcer because its category is unclear.
- Format (unchanged): one item per array entry, no prose sentences, no "such as ..." lists, no leading "and"/"or", strip surrounding quotes.

FIREWALL — CAPTURE ONLY WHAT IS NAMED:
Exhaustive means miss NONE that the assessment actually names. It does NOT mean add any. NEVER invent, infer, generalize, or pad reinforcers that are not written in the document. If the assessment names three, return exactly those three — no "typical" additions, no filler, no assumed favorites.

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
  "homeActivities": ["activities the assessment EXPLICITLY ties to home/daily-living — empty if none are setting-tagged; never guess"],
  "schoolActivities": ["activities the assessment EXPLICITLY ties to school/classroom — empty if none are setting-tagged; never guess"],
  "preferredActivities": ["flat/untagged preferred activities with no clear home vs school context"],
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

  // TRUNCATION GUARD: if the model hit the output cap, the JSON is cut off mid-structure and the tail
  // fields (reinforcers/activities/parent-goals) are lost. Fail LOUD with a clear message rather than
  // letting it surface as an opaque "could not parse" error — nothing partial is written either way, but
  // this tells the caller the real cause (assessment too large for one pass).
  if (response.choices[0].finish_reason === 'length') {
    throw new Error('Assessment extraction was truncated (document too large for a single extraction pass) — the result was incomplete and was not applied.');
  }

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
