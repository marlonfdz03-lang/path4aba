export interface ProgramItem {
  name: string;
  status?: string;
}

export interface MaladaptiveBehavior {
  name: string;
  status?: string;
  topographies: string[];
}

export interface ClinicalProfile {
  maladaptiveBehaviors: MaladaptiveBehavior[];

  interventions: ProgramItem[];

  skillAcquisition: ProgramItem[];

  replacementBehaviors: ProgramItem[];

  reinforcers: string[];

  homeActivities: string[];

  schoolActivities: string[];
}

export function buildClinicalProfile(
  rawData: any
): ClinicalProfile {

  const activeMaladaptives = (
    rawData.maladaptiveBehaviors || []
  ).filter((behavior: any) => {
    const status =
      behavior?.status?.toLowerCase?.() || "active";

    return (
      status !== "mastered" &&
      status !== "discontinued" &&
      status !== "inactive" &&
      status !== "on hold"
    );
  });

  const activeSkills = (
    rawData.skillAcquisition || []
  ).filter((skill: any) => {
    const status =
      skill?.status?.toLowerCase?.() || "active";

    return (
      status !== "mastered" &&
      status !== "discontinued" &&
      status !== "inactive" &&
      status !== "on hold"
    );
  });

  const activeReplacements = (
    rawData.replacementBehaviors || []
  ).filter((replacement: any) => {
    const status =
      replacement?.status?.toLowerCase?.() || "active";

    return (
      status !== "mastered" &&
      status !== "discontinued" &&
      status !== "inactive" &&
      status !== "on hold"
    );
  });

  const activeInterventions = (
    rawData.interventions || []
  ).filter((intervention: any) => {
    const status =
      intervention?.status?.toLowerCase?.() || "active";

    return (
      status !== "mastered" &&
      status !== "discontinued" &&
      status !== "inactive" &&
      status !== "on hold"
    );
  });

  return {
    maladaptiveBehaviors: dedupeMaladaptives(
      activeMaladaptives
    ),

    interventions: dedupePrograms(
      activeInterventions
    ),

    skillAcquisition: dedupePrograms(
      activeSkills
    ),

    replacementBehaviors: dedupePrograms(
      activeReplacements
    ),

    reinforcers: dedupeStrings(
      rawData.reinforcers || []
    ),

    homeActivities: dedupeStrings(
      rawData.homeActivities || [
        "structured table activity",
        "play-based instruction",
        "toothbrushing routine",
        "meal routine",
        "puzzle activity",
        "clean-up routine",
      ]
    ),

    schoolActivities: dedupeStrings(
      rawData.schoolActivities || [
        "classroom table work",
        "group instruction",
        "academic worksheet activity",
        "peer interaction activity",
        "circle time",
        "line transition",
      ]
    ),
  };
}

function dedupeStrings(items: string[] = []) {
  return [
    ...new Set(
      items
        .filter(Boolean)
        .map((item) => item.trim())
    ),
  ];
}

function dedupePrograms(
  items: ProgramItem[] = []
) {
  const seen = new Set();

  return items.filter((item) => {
    if (!item?.name) return false;

    const key = item.name.trim().toLowerCase();

    if (seen.has(key)) return false;

    seen.add(key);

    return true;
  });
}

function dedupeMaladaptives(
  items: MaladaptiveBehavior[] = []
) {
  const seen = new Set();

  return items.filter((item) => {
    if (!item?.name) return false;

    const key = item.name.trim().toLowerCase();

    if (seen.has(key)) return false;

    seen.add(key);

    return true;
  });
}