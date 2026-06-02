export interface ProgramItem {
  name: string;
  status?: string;
}

export interface MaladaptiveBehavior {
  name: string;
  status?: string;
  topographies: string[];
  functions: string[];
}

export interface ClinicalProfile {
  maladaptiveBehaviors: MaladaptiveBehavior[];
  interventions: ProgramItem[];
  skillAcquisition: ProgramItem[];
  replacementBehaviors: ProgramItem[];
  reinforcers: string[];
  homeActivities: string[];
  schoolActivities: string[];
  caregivers: string[];
  clientName: string;
}

export function buildClinicalProfile(rawData: any): ClinicalProfile {

  const activeMaladaptives = (rawData.maladaptiveBehaviors || []).filter((b: any) => {
    const status = b?.status?.toLowerCase?.() || 'active';
    return !['mastered','discontinued','inactive','on hold'].includes(status);
  });

  const activeSkills = (rawData.skillAcquisition || rawData.replacementSkills || []).filter((s: any) => {
    const status = s?.status?.toLowerCase?.() || 'active';
    return !['mastered','discontinued','inactive','on hold'].includes(status);
  });

  const activeReplacements = (rawData.replacementBehaviors || rawData.replacementSkills || []).filter((r: any) => {
    const status = r?.status?.toLowerCase?.() || 'active';
    return !['mastered','discontinued','inactive','on hold'].includes(status);
  });

  const activeInterventions = (rawData.interventions || rawData.approvedInterventions || []).map((i: any) => {
    if (typeof i === 'string') return { name: i };
    return i;
  }).filter((i: any) => {
    const status = i?.status?.toLowerCase?.() || 'active';
    return !['mastered','discontinued','inactive','on hold'].includes(status);
  });

  // Build reinforcers array from object or array format
  let reinforcerList: string[] = [];
  if (Array.isArray(rawData.reinforcers)) {
    reinforcerList = rawData.reinforcers;
  } else if (rawData.reinforcers && typeof rawData.reinforcers === 'object') {
    const r = rawData.reinforcers;
    reinforcerList = [r.tangibles, r.activities, r.social, r.people]
      .filter(Boolean)
      .flatMap((s: string) => s.split(',').map((x: string) => x.trim()))
      .filter(Boolean);
  }

  const homeActs = rawData.homeActivities?.length
    ? rawData.homeActivities
    : rawData.preferredActivities?.length
      ? rawData.preferredActivities
      : ['structured table activity','play-based instruction','puzzle activity','clean-up routine','meal routine'];

  const schoolActs = rawData.schoolActivities?.length
    ? rawData.schoolActivities
    : ['classroom table work','group instruction','academic worksheet activity','peer interaction activity','circle time'];

  return {
    clientName: rawData.clientName || rawData.name || '',
    caregivers: dedupeStrings(rawData.caregivers || []),
    maladaptiveBehaviors: dedupeMaladaptives(activeMaladaptives),
    interventions: dedupePrograms(activeInterventions),
    skillAcquisition: dedupePrograms(activeSkills),
    replacementBehaviors: dedupePrograms(activeReplacements),
    reinforcers: dedupeStrings(reinforcerList),
    homeActivities: dedupeStrings(homeActs),
    schoolActivities: dedupeStrings(schoolActs),
  };
}

function dedupeStrings(items: string[] = []) {
  return [...new Set(items.filter(Boolean).map(i => i.trim()))];
}

function dedupePrograms(items: ProgramItem[] = []) {
  const seen = new Set<string>();
  return items.filter(item => {
    if (!item?.name) return false;
    const key = item.name.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeMaladaptives(items: any[] = []): MaladaptiveBehavior[] {
  const seen = new Set<string>();
  return items.filter(item => {
    if (!item?.name) return false;
    const key = item.name.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(item => ({
    name: item.name,
    status: item.status,
    topographies: item.topographies?.length
      ? item.topographies
      : item.topography
        ? [item.topography]
        : [],
    functions: Array.isArray(item.function)
      ? item.function
      : item.function
        ? [item.function]
        : [],
  }));
}
