// scripts/proveFastMas.mjs — FAST/MAS step 3 OFFLINE proof: locate → strip → transcribe → validate.
// Runs the 3 stored test PDFs through the full pipeline. Uses Azure OpenAI ONLY for name-tidying of
// geometry-located cells (never prose). NO prod DB, NO live PHI (local test PDFs; identifiers stripped
// before the LLM). Run: node --env-file=.env.local scripts/proveFastMas.mjs
import { readFileSync } from 'node:fs'
import OpenAI from 'openai'
import { parsePositioned, clusterRows } from '../lib/pdfGeometry.ts'
import { buildLocatedInput, transcribeLocated, validate } from '../lib/fastMasTranscribe.ts'

const openai = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY || 'azure-openai',
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/gpt-4o`,
  defaultQuery: { 'api-version': '2025-01-01-preview' },
  defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY },
})

const PDFS = [
  ['ALEXANDRA', 'assessments-local/ALEXANDRA-REASSESSMENT-Julio2026-signed-17858698536857.pdf', ['Alexandra Juarez', 'Alexandra']],
  ['FELIX', 'assessments-local/Reassessment Felix de la Nuez 2026-08-06 00_10_59.pdf', ['Félix De La Nuez', 'Felix']],
  ['BRANDON', 'assessments-local/2026-Brandon-Julio-signed-17858694243391.pdf', ['Brandon Cruz', 'Brandon']],
]
const G = (s) => `\x1b[32m${s}\x1b[0m`, R = (s) => `\x1b[31m${s}\x1b[0m`, D = (s) => `\x1b[2m${s}\x1b[0m`

for (const [name, path, knownNames] of PDFS) {
  const rows = clusterRows(await parsePositioned(readFileSync(path)))
  const located = buildLocatedInput(rows, knownNames) // LOCATE + STRIP

  console.log(`\n════════ ${name} ════════`)
  // Firewall check: confirm no raw identifier reached the located (LLM-bound) input.
  const leak = knownNames.flatMap((n) => n.split(/\s+/)).filter((w) => w.length >= 3)
    .filter((w) => JSON.stringify(located).match(new RegExp(`\\b${w}\\b`, 'i')))
  console.log(`  strip-before-LLM: ${leak.length ? R(`LEAK ${leak.join(',')}`) : G('clean (no raw name in LLM input)')}`)
  console.log(`  located: ${located.geometricBehaviorCount} behavior blocks · ${located.masteredItems.length} mastered items · diagnosis [${located.diagnosisCodes.join(', ') || '—'}]`)

  const t = await transcribeLocated(located, openai) // TRANSCRIBE (name-tidy only)
  const v = validate(t, located)                     // VALIDATE (firewall gates)

  console.log(`\n  behaviors (${t.behaviors.length}):`)
  for (const b of t.behaviors) console.log(`    • ${b.name.slice(0, 46).padEnd(48)} [${b.functions.join(', ') || D('unknown')}]`)
  console.log(`  mastered skills: ${JSON.stringify(t.masteredSkills)}`)
  console.log(`  diagnosis: [${located.diagnosisCodes.join(', ') || '—'}]`)
  console.log(`\n  VALIDATION: ${v.length ? R('FAIL — ' + v.join(' | ')) : G('PASS (count=geometry · functions∈vocab · mastered=located · no Z-code)')}`)
}
console.log('')
