// scripts/proveGeometry.mjs — OFFLINE proof of FAST/MAS step 2. NO LLM, NO production, NO network.
// Runs the deterministic geometric readers against the 3 stored test PDFs and prints the reconstructed
// structures so we can see whether geometry recovers behavior→function, mastered skills, and confirmed
// diagnosis. Run: node scripts/proveGeometry.mjs
import { readFileSync } from 'node:fs'
import { parsePositioned, redactFragments, redactText, clusterRows, readBehaviorFunctions, readMasteredSkills, readConfirmedDiagnosis } from '../lib/pdfGeometry.ts'

// names[] = the identifiers the client RECORD would supply in production (clientName + caregivers). The lib
// hardcodes none; the caller passes them. Used only to DEMO the strip-before-LLM boundary (step 3 input).
const PDFS = [
  ['ALEXANDRA', 'assessments-local/ALEXANDRA-REASSESSMENT-Julio2026-signed-17858698536857.pdf', ['Alexandra']],
  ['FELIX', 'assessments-local/Reassessment Felix de la Nuez 2026-08-06 00_10_59.pdf', ['Félix De La Nuez', 'Felix']],
  ['BRANDON', 'assessments-local/2026-Brandon-Julio-signed-17858694243391.pdf', ['Brandon Cruz', 'Brandon']],
]

for (const [name, path, names] of PDFS) {
  // Geometry runs on RAW (ligature-normalized) fragments — reconstruction needs the real clinical text.
  const frags = await parsePositioned(readFileSync(path))
  const rows = clusterRows(frags)

  console.log(`\n════════════════ ${name} ════════════════`)

  const bf = readBehaviorFunctions(rows)
  console.log(`\n  BEHAVIOR → FUNCTION  (${bf.length} blocks with a Hypothesized Function — deterministic active-behavior count)`)
  for (const r of bf) console.log(`    • ${r.behavior.slice(0, 46).padEnd(48)} → [${r.functions.join(', ') || '—'}]`)

  const ms = readMasteredSkills(rows)
  console.log(`\n  MASTERED SECTIONS  (${ms.length} "MASTERED:" headings)`)
  for (const h of ms) console.log(`    • p${h.page} "${h.heading.slice(0, 40)}" → items: ${JSON.stringify(h.items.slice(0, 6))}`)

  const dx = readConfirmedDiagnosis(rows)
  console.log(`\n  CONFIRMED DIAGNOSIS  → ${dx ? `[${dx.codes.join(', ')}]  (via ${dx.source})` : 'no confirmed-diagnoses statement found'}`)

  // STRIP-BEFORE-LLM boundary demo: a topography fragment redacted with the record's known names — this is
  // what step 3 (transcription) would receive. Targeted (known names + pronouns), clinical terms preserved.
  const sample = frags.find((f) => names.some((n) => n.split(/\s+/).some((w) => new RegExp(`\\b${w}\\b`, 'i').test(f.text))))
  if (sample) console.log(`\n  STRIP-BEFORE-LLM demo:\n    raw:      ${JSON.stringify(sample.text.slice(0, 90))}\n    redacted: ${JSON.stringify(redactText(sample.text, names).slice(0, 90))}`)
}
console.log('')
