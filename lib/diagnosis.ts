// lib/diagnosis.ts
// Diagnosis normalization — the deterministic FIREWALL BACKSTOP for the diagnosis field. The extraction
// instruction ASKS the LLM to capture only confirmed diagnoses, but (like every LLM instruction) it is not
// 100%. This GUARANTEES the policy regardless of the model: no Z-code and no suspected/rule-out/differential/
// provisional diagnosis can ever reach the profile, and each ICD code appears once. Applied in BOTH profile
// builders (mapToLegacyFormat create-path + buildAssessmentProfile refresh-path) so they normalize identically.
//
// Policy (confirmed with Marlon — governs EVERY client):
//   • Z-codes (Z##.#) → ALWAYS excluded (ICD contextual factors, not clinical diagnoses).
//   • suspected / rule-out / differential / provisional → ALWAYS excluded (only CONFIRMED diagnoses stored).

const ICD_CODE = /[A-Za-z]\d{2}(?:\.\d+)?/;
const UNCONFIRMED = /\b(suspected|rule[\s-]?out|r\/o|differential|provisional|presumptive|possible|probable|query|to rule out)\b/i;

// Coerce one diagnosis entry to a display string. The extractor normally emits strings ("Name (F84.0)")
// but can wobble to objects ({ name, ICDCode | code | icd }) — never let a schema wobble break the firewall.
function toDiagnosisString(item: unknown): string {
  if (item == null) return '';
  if (typeof item === 'string') return item.trim();
  if (typeof item === 'object') {
    const o = item as Record<string, unknown>;
    const name = String(o.name ?? o.diagnosis ?? o.label ?? '').trim();
    const code = String(o.ICDCode ?? o.icdCode ?? o.code ?? o.icd ?? '').trim();
    if (name && code) return `${name} (${code})`;
    return name || code;
  }
  return String(item).trim();
}

export function normalizeDiagnosis(raw: unknown): string[] {
  const items = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const s = toDiagnosisString(item);
    if (!s) continue;
    // Only CONFIRMED — drop anything flagged suspected/rule-out/differential/provisional.
    if (UNCONFIRMED.test(s)) continue;
    const m = s.match(ICD_CODE);
    const code = m ? m[0].toUpperCase() : '';
    // Drop Z-codes (contextual factors, not diagnoses).
    if (/^Z/.test(code)) continue;
    // Dedupe by ICD code when present, else by normalized name.
    const key = code || s.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// The value written to the clients.diagnosis COLUMN — the normalized list joined (matches the column's
// historical string format from rbt/create). Normalizes defensively so the column can never carry a
// Z-code / suspected code and can never drift from the normalized clinical_profile.diagnosis JSON.
export function diagnosisColumn(diagnosis: unknown): string {
  return normalizeDiagnosis(diagnosis).join(', ');
}
