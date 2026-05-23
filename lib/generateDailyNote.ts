import { promptLevels } from "./clinicalData";

function pickRandom<T>(array: T[] = [], count: number): T[] {
  return [...array]
    .sort(() => 0.5 - Math.random())
    .slice(0, count);
}

function pickOne<T>(array: T[] = [], fallback: T): T {
  if (!array?.length) return fallback;

  return (
    array[Math.floor(Math.random() * array.length)] ||
    fallback
  );
}

function countWords(text: string) {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function getName(item: any, fallback = "") {
  if (typeof item === "string") return item;

  return item?.name || fallback;
}

const prohibitedInterventions = [
  "response blocking",
  "response block",
  "punishment",
  "restraint",
  "physical restraint",
  "response cost",
  "overcorrection",
  "aversive",
];

const prohibitedScopeTerms = [
  "speech therapy",
  "speech/language therapy",
  "speech-language therapy",
  "occupational therapy",
  "ot",
  "physical therapy",
  "pt",
  "counseling",
  "tutoring",
  "homework",
  "academic tutoring",
  "feeding therapy",
  "speech services",
  "educational tutoring",
  "teacher assistant",
  "academic support",
];

const invalidPatterns = [
  "following during",
  "following after",
  "after during",
  "during participating",
  "while engaged in treatment activities, during",
  "by occurs",
  "by engages",
  "by turns",
  "during increasing attention",
  "during following",
  "following waiting",
];

const invalidActivities = [
  "summer program",
  "learning/academics",
  "speech/language therapy",
  "speech therapy",
  "occupational therapy",
  "homework",
  "increasing attention and time on task",
  "engaging appropriately with peers and teachers",
  "attending kindergarten and upcoming first grade",
];

const homeOnlyPrograms = [
  "daily living",
  "toothbrushing",
  "meal routine",
  "hygiene",
  "chores",
  "shower",
  "bedtime",
  "couch",
];

function containsAny(text: string, blocked: string[]) {
  const lower = text.toLowerCase();

  return blocked.some((term) =>
    lower.includes(term)
  );
}

function containsProhibitedScope(text: string) {
  return containsAny(text, prohibitedScopeTerms);
}

function isAllowedIntervention(item: any) {
  const name = getName(item, "")
    .toLowerCase()
    .trim();

  if (!name) return false;

  if (
    containsAny(name, prohibitedInterventions)
  ) {
    return false;
  }

  if (
    containsAny(name, prohibitedScopeTerms)
  ) {
    return false;
  }

  if (
    name.includes(
      "escape independent response delivery"
    )
  ) {
    return false;
  }

  if (
    name.includes(
      "attention independent response delivery"
    )
  ) {
    return false;
  }

  return true;
}

function normalizeInterventionName(
  text: string
) {
  const lower = text.toLowerCase();

  if (lower.includes("planned ignore")) {
    return "Planned Ignoring";
  }

  if (lower.includes("activity schedule")) {
    return "Visual Activity Schedule";
  }

  if (
    lower.includes("response block") ||
    lower.includes("response blocking")
  ) {
    return "";
  }

  if (
    lower.includes(
      "escape independent response delivery"
    )
  ) {
    return "";
  }

  if (
    lower.includes(
      "attention independent response delivery"
    )
  ) {
    return "";
  }

  return text;
}

function cleanActivity(
  activity: string,
  location: string
) {
  const lower = activity.toLowerCase();

  if (
    containsAny(lower, invalidActivities)
  ) {
    return location === "school"
      ? "classroom activity"
      : "structured play activity";
  }

  if (
    location === "school" &&
    containsAny(lower, homeOnlyPrograms)
  ) {
    return "classroom transition";
  }

  if (
    location === "school" &&
    lower.includes("structured play")
  ) {
    return "classroom play activity";
  }

  return activity;
}

function cleanAntecedent(
  antecedent: string
) {
  return antecedent
    .replace(/following during/gi, "during")
    .replace(/following waiting/gi, "while waiting")
    .replace(/following after/gi, "after")
    .replace(/after during/gi, "during")
    .replace(
      /during following/gi,
      "while following"
    )
    .replace(
      /during participating/gi,
      "while participating"
    )
    .replace(
      /presentation of classroom routines/gi,
      "during classroom routines"
    )
    .replace(
      /presentation of academic demands/gi,
      "presentation of classroom demands"
    )
    .replace(/\s+/g, " ")
    .trim();
}

function cleanBehaviorLabel(text: string) {
  const lower = text.toLowerCase();

  if (lower.includes("rude")) {
    return "inappropriate social interaction";
  }

  if (
    lower.includes("noncompliance") ||
    lower.includes("non-compliance")
  ) {
    return "refusal to follow directions";
  }

  if (lower.includes("defiant")) {
    return "turning away from instructions";
  }

  return text;
}

function cleanTopography(
  text: string,
  location: string,
  behaviorName: string
) {
  let cleaned = text
    .replace(
      /being rude to others when things do not go his way/gi,
      "using a loud voice toward peers"
    )
    .replace(
      /turns his head/gi,
      "turning his head away from presented items"
    )
    .replace(
      /throwing any item against any hard surface/gi,
      "throwing nearby materials"
    )
    .replace(
      /occurs when ignored by adults/gi,
      "crying or vocalizing when attention is unavailable"
    )
    .replace(
      /by occurs/gi,
      "by engaging in"
    )
    .replace(
      /by engages/gi,
      "by engaging in"
    )
    .replace(
      /by turns/gi,
      "by turning"
    )
    .replace(/\s+/g, " ")
    .trim();

  if (
    location === "school" &&
    behaviorName
      .toLowerCase()
      .includes("property")
  ) {
    cleaned = cleaned.replace(
      /nearby materials/gi,
      "classroom materials"
    );
  }

  return cleaned;
}

function naturalizeProgram(
  text: string,
  location: string
) {
  const lower = text.toLowerCase();

  if (
    location === "school" &&
    lower.includes("daily living")
  ) {
    return "following classroom routines";
  }

  if (
    lower.includes("share a preferred toy")
  ) {
    return "sharing preferred items appropriately";
  }

  if (
    lower.includes("request help appropriately")
  ) {
    return "requesting help appropriately";
  }

  if (
    lower.includes("request a break")
  ) {
    return "requesting a break appropriately";
  }

  if (
    lower.includes("accept alternative")
  ) {
    return "accepting alternative items or activities";
  }

  if (lower.includes("transition")) {
    return "transitioning appropriately";
  }

  if (
    lower.includes("increasing attention") ||
    lower.includes("time on task")
  ) {
    return "remaining on task";
  }

  return text;
}

const schoolActivities = [
  "classroom activity",
  "small group instruction",
  "group activity",
  "independent work",
  "classroom transition",
  "peer interaction activity",
  "classroom routine",
  "remaining seated during instruction",
  "following classroom directions",
  "waiting appropriately",
];

const homeActivities = [
  "structured play activity",
  "coloring activity",
  "puzzle activity",
  "clean-up routine",
  "meal routine",
  "matching activity",
  "Play-Doh activity",
  "toy play activity",
  "sensory play activity",
];

const schoolAntecedents = [
  "after teacher instruction",
  "during transition to a classroom activity",
  "during group activity",
  "during independent work",
  "during peer interaction",
  "during transition periods",
  "while waiting during group activity",
];

const homeAntecedents = [
  "presentation of a non-preferred task",
  "transition away from a preferred activity",
  "denied access to a preferred item",
  "request to complete a routine",
  "presentation of multiple-step directions",
  "delay to reinforcement",
];

const responseOutcomes = [
  "The client resumed participation with support.",
  "The client completed portions of the activity.",
  "The client remained engaged following reinforcement.",
  "The client transitioned with support.",
  "The client responded appropriately after prompting.",
  "The client returned to the expected activity.",
  "The client participated in the next response opportunity.",
];

const schoolReinforcers = [
  "token delivery",
  "stickers",
  "small edible items",
  "brief iPad access",
  "behavior-specific praise",
  "sensory toys",
  "short video clips",
  "fidget toys",
  "token system",
];

const homeReinforcers = [
  "playtime",
  "bubbles",
  "squishy balls",
  "sensory toys",
  "preferred toys",
  "iPad time",
  "candies",
  "gummies",
  "chips",
  "music",
  "Play-Doh",
  "kinetic sand",
  "fidget toys",
];

const transitionStartersSchool = [
  "Later during the session",
  "During a classroom transition",
  "While participating in group activities",
  "During independent work",
  "During peer interaction opportunities",
  "While completing classroom routines",
];

const transitionStartersHome = [
  "Later during the session",
  "During structured play",
  "During a home routine",
  "During transitions between activities",
  "While completing a table activity",
];

function describeIntervention(
  interventionInput: string,
  replacement: string,
  behaviorName: string
) {
  const intervention =
    normalizeInterventionName(
      interventionInput
    );

  const name =
    intervention.toLowerCase();

  if (!intervention) {
    return "the RBT used an approved replacement-based intervention";
  }

  if (name.includes("dra")) {
    return `the RBT implemented DRA by reinforcing appropriate task participation and compliance with directions`;
  }

  if (name.includes("dro")) {
    return `the RBT implemented DRO by delivering reinforcement during intervals without the target behavior`;
  }

  if (name.includes("dri")) {
    return `the RBT implemented DRI by reinforcing a response incompatible with ${behaviorName.toLowerCase()}`;
  }

  if (
    name.includes("fct") ||
    name.includes(
      "functional communication"
    )
  ) {
    return `the RBT prompted functional communication as an alternative response`;
  }

  if (
    name.includes("prompt fading")
  ) {
    return `the RBT used prompt fading to support more independent responding`;
  }

  if (
    name.includes("planned ignoring")
  ) {
    return `the RBT used Planned Ignoring while reinforcing appropriate alternative behavior`;
  }

  if (name.includes("premack")) {
    return `the RBT used the Premack Principle by providing access to a preferred activity after participation`;
  }

  if (name.includes("token")) {
    return `the RBT delivered tokens contingent on task engagement and appropriate responding`;
  }

  if (name.includes("visual")) {
    return `the RBT used a visual activity schedule to support participation and transitions`;
  }

  if (
    name.includes("behavior momentum")
  ) {
    return `the RBT presented several high-probability requests before introducing the task demand`;
  }

  if (name.includes("errorless")) {
    return `the RBT used errorless teaching to support correct responding during skill-acquisition opportunities`;
  }

  return `the RBT implemented ${intervention} as approved in the ABA treatment plan`;
}

function getBehaviorTopography(
  behavior: any,
  location: string,
  behaviorName: string
) {
  const topography = pickOne(
    behavior?.topographies || [],
    "observable behavior documented during the session"
  );

  return cleanTopography(
    topography,
    location,
    behaviorName
  );
}

function createEpisode(
  behavior: any,
  intervention: string,
  replacement: string,
  skill: string,
  activity: string,
  antecedent: string,
  transition: string,
  location: string
) {
  const behaviorName =
    cleanBehaviorLabel(
      behavior?.name ||
        "target behavior"
    );

  const topography =
    getBehaviorTopography(
      behavior,
      location,
      behaviorName
    );

  const cleanedActivity =
    cleanActivity(
      activity,
      location
    );

  const cleanedAntecedent =
    cleanAntecedent(
      antecedent
    );

  const outcome = pickOne(
    responseOutcomes,
    responseOutcomes[0]
  );

  const interventionText =
    describeIntervention(
      intervention,
      replacement,
      behaviorName
    );

  const structures = [
    `${transition}, during ${cleanedActivity}, the client engaged in ${behaviorName.toLowerCase()} by ${topography} after ${cleanedAntecedent}. ${interventionText}. ${outcome} The session then targeted ${skill} through teaching opportunities, prompting, and reinforcement.`,

    `${transition}, the client engaged in ${behaviorName.toLowerCase()} by ${topography} during ${cleanedActivity}. This occurred after ${cleanedAntecedent}. ${interventionText}. ${outcome} The RBT then continued programming for ${skill}.`,

    `${transition}, while participating in ${cleanedActivity}, the client engaged in ${behaviorName.toLowerCase()} by ${topography}. ${interventionText}. ${outcome} The activity was then used to practice ${skill}.`,
  ];

  return pickOne(
    structures,
    structures[0]
  );
}

function formatLocation(
  location: string
) {
  if (location === "school") {
    return "school-based ABA session";
  }

  if (location === "clinic") {
    return "clinic-based ABA session";
  }

  return "home-based ABA session";
}

function finalClean(note: string) {
  return note
    .replace(
      /during ([^,.]+), during/gi,
      "during"
    )
    .replace(
      /during following/gi,
      "while following"
    )
    .replace(
      /following during/gi,
      "during"
    )
    .replace(
      /following waiting during/gi,
      "while waiting during"
    )
    .replace(
      /following after/gi,
      "after"
    )
    .replace(
      /after during/gi,
      "during"
    )
    .replace(
      /during participating in/gi,
      "while participating in"
    )
    .replace(
      /while engaged in treatment activities, during/gi,
      "during"
    )
    .replace(
      /by occurs/gi,
      "by engaging in"
    )
    .replace(
      /by engages/gi,
      "by engaging in"
    )
    .replace(
      /by turns/gi,
      "by turning"
    )
    .replace(
      /during attending Kindergarten and upcoming first grade/gi,
      "during classroom activities"
    )
    .replace(
      /during increasing attention and time on task/gi,
      "during classroom activities"
    )
    .replace(
      /during engaging appropriately with peers and teachers/gi,
      "during peer interaction activities"
    )
    .replace(
      /engaging appropriately with peers and teachers/gi,
      "peer interaction activity"
    )
    .replace(
      /Summer program/gi,
      "classroom activity"
    )
    .replace(
      /Learning\/Academics/gi,
      "independent work"
    )
    .replace(
      /transitioning to different academic tasks/gi,
      "classroom transitions"
    )
    .replace(
      /Activity Schedule according to the approved ABA treatment plan/gi,
      "the RBT used a visual activity schedule to support participation and transitions"
    )
    .replace(
      /Behavior Momentum/gi,
      "behavioral momentum"
    )
    .replace(
      /the RBT implemented behavioral momentum according to the approved ABA treatment plan/gi,
      "the RBT presented several high-probability requests before introducing the task demand"
    )
    .replace(
      /through ABA teaching opportunities, prompting procedures, and reinforcement for appropriate responding/gi,
      "through teaching opportunities, prompting, and reinforcement"
    )
    .replace(
      /The client responded to intervention with varying levels of prompting and reinforcement across treatment activities, and /gi,
      ""
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

export function generateDailyNote(
  profile: any,
  sessionInfo: any = {}
) {
  const location =
    sessionInfo.location ||
    "home";

  const presentPerson =
    sessionInfo.presentPerson ||
    (location === "school"
      ? "teacher"
      : "caregiver");

  const timeIn =
    sessionInfo.timeIn ||
    "time in not provided";

  const timeOut =
    sessionInfo.timeOut ||
    "time out not provided";

  const medication =
    sessionInfo.medication ||
    "No medication changes were reported";

  const environmentalChanges =
    sessionInfo.environmentalChanges ===
    "yes"
      ? sessionInfo.environmentalChangeDescription ||
        "An environmental change was reported during the session"
      : "No environmental changes were reported during the session";

  const approvedInterventions = (
    profile?.interventions || []
  )
    .filter(isAllowedIntervention)
    .map((item: any) => ({
      ...item,
      name:
        normalizeInterventionName(
          getName(item, "")
        ),
    }))
    .filter(
      (item: any) => item.name
    );

  const activeBehaviors =
    profile?.maladaptiveBehaviors ||
    [];

  const activeSkills =
    profile?.skillAcquisition ||
    [];

  const activeReplacements =
    profile?.replacementBehaviors ||
    [];

  const filteredSkills =
    activeSkills
      .map((skill: any) => ({
        ...skill,
        name:
          naturalizeProgram(
            getName(skill, ""),
            location
          ),
      }))
      .filter(
        (skill: any) =>
          skill.name &&
          !(
            location ===
              "school" &&
            containsAny(
              skill.name,
              homeOnlyPrograms
            )
          )
      );

  const filteredReplacements =
    activeReplacements
      .map(
        (replacement: any) => ({
          ...replacement,
          name:
            naturalizeProgram(
              getName(
                replacement,
                ""
              ),
              location
            ),
        })
      )
      .filter(
        (replacement: any) =>
          replacement.name &&
          !(
            location ===
              "school" &&
            containsAny(
              replacement.name,
              homeOnlyPrograms
            )
          )
      );

  const rawActivities =
    location === "school"
      ? profile
          ?.schoolActivities
          ?.length
        ? profile.schoolActivities
        : schoolActivities
      : profile
          ?.homeActivities
          ?.length
      ? profile.homeActivities
      : homeActivities;

  const activities =
    rawActivities
      .map((activity: string) =>
        cleanActivity(
          activity,
          location
        )
      )
      .filter(
        (activity: string) =>
          !containsProhibitedScope(
            activity
          )
      );

  const antecedents =
    location === "school"
      ? schoolAntecedents
      : homeAntecedents;

  const reinforcerPool =
    location === "school"
      ? schoolReinforcers
      : homeReinforcers;

  const transitionStarters =
    location === "school"
      ? transitionStartersSchool
      : transitionStartersHome;

  const selectedBehaviors =
    pickRandom(
      activeBehaviors,
      5
    );

  const selectedInterventions =
    pickRandom(
      approvedInterventions,
      5
    );

  const selectedSkills =
    pickRandom(
      filteredSkills,
      2
    );

  const selectedReplacements =
    pickRandom(
      filteredReplacements,
      2
    );

  const selectedReinforcers =
    pickRandom(
      reinforcerPool,
      3
    );

  const promptOptions = [
    "verbal prompts",
    "gestural prompts",
    "visual prompts",
    "model prompts",
    "least-to-most prompting",
  ];

  const promptLevel = pickOne(
    promptOptions,
    pickOne(
      promptLevels,
      "verbal prompts"
    )
  );

  const episodes =
    selectedBehaviors.map(
      (
        behavior: any,
        index: number
      ) => {
        const intervention =
          getName(
            selectedInterventions[
              index %
                selectedInterventions.length
            ],
            "approved ABA intervention"
          );

        const replacement =
          naturalizeProgram(
            getName(
              selectedReplacements[
                index %
                  selectedReplacements.length
              ],
              "appropriate replacement behavior"
            ),
            location
          );

        const skill =
          naturalizeProgram(
            getName(
              selectedSkills[
                index %
                  selectedSkills.length
              ],
              replacement
            ),
            location
          );

        return createEpisode(
          behavior,
          intervention,
          replacement,
          skill,
          pickOne(
            activities,
            location ===
              "school"
              ? "classroom activity"
              : "structured play activity"
          ),
          pickOne(
            antecedents,
            "presentation of demands"
          ),
          pickOne(
            transitionStarters,
            "During the session"
          ),
          location
        );
      }
    );

  const skillSummary =
    selectedSkills
      .map((skill: any) => {
        const skillName =
          naturalizeProgram(
            getName(
              skill,
              "approved skill acquisition program"
            ),
            location
          );

        return `${skillName} was addressed through repeated teaching opportunities, ${promptLevel}, reinforcement delivery, and prompting as needed`;
      })
      .join(". ");

  const replacementSummary =
    selectedReplacements
      .map(
        (replacement: any) =>
          naturalizeProgram(
            getName(
              replacement,
              "approved replacement behavior"
            ),
            location
          )
      )
      .join(", ");

  const reinforcementSummary = `Reinforcement included ${selectedReinforcers.join(
    ", "
  )} contingent on task engagement, appropriate communication, transitions, and participation during session activities.`;

  let note = `During today’s scheduled ${formatLocation(
    location
  )}, services were provided from ${timeIn} to ${timeOut} with the ${presentPerson} present. ${environmentalChanges}. Medication update: ${medication}. The RBT implemented procedures targeting active behavior-reduction, replacement, and skill-acquisition goals while collecting data on maladaptive behaviors, replacement programs, prompting, attending, transitions, time on task, and responses to intervention. ${episodes.join(
    " "
  )} Skill-acquisition programming remained active throughout the session. ${skillSummary}. Replacement behaviors addressed during the session included ${replacementSummary}. ${reinforcementSummary} Behavioral responses were documented according to the current treatment plan.`;

  while (
    countWords(note) < 450
  ) {
    note += ` Additional teaching opportunities were implemented to support functional communication, transitions, attending, time on task, appropriate responding, and participation during treatment activities.`;
  }

  return finalClean(note);
}