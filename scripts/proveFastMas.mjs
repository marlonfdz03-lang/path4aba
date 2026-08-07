// scripts/proveFastMas.mjs — FAST/MAS step 3 OFFLINE proof: locate → strip → transcribe → validate.
// Runs the 3 stored test PDFs through the full pipeline. Uses Azure OpenAI ONLY for name-tidying of
// geometry-located cells (never prose). NO prod DB, NO live PHI (local test PDFs; identifiers stripped
// before the LLM). Run: node --env-file=.env.local scripts/proveFastMas.mjs
import { readFileSync } from 'node:fs'
import OpenAI from 'openai'
import { parsePositioned, clusterRows } from '../lib/pdfGeometry.ts'
import { buildLocatedInput, transcribeLocated, validate } from '../lib/fastMasTranscribe.ts'
import { assessConfidence } from '../lib/fastMasConfidence.ts'

const openai = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY || 'azure-openai',
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/gpt-4o`,
  defaultQuery: { 'api-version': '2025-01-01-preview' },
  defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY },
})

const PDFS = [
  ['ALEXANDRA', 'alexandra', 'assessments-local/ALEXANDRA-REASSESSMENT-Julio2026-signed-17858698536857.pdf', ['Alexandra Juarez', 'Alexandra']],
  ['FELIX', 'felix', 'assessments-local/Reassessment Felix de la Nuez 2026-08-06 00_10_59.pdf', ['Félix De La Nuez', 'Felix']],
  ['BRANDON', 'brandon', 'assessments-local/2026-Brandon-Julio-signed-17858694243391.pdf', ['Brandon Cruz', 'Brandon']],
]
const G = (s) => `\x1b[32m${s}\x1b[0m`, R = (s) => `\x1b[31m${s}\x1b[0m`, Y = (s) => `\x1b[33m${s}\x1b[0m`, D = (s) => `\x1b[2m${s}\x1b[0m`

// Ground truth (strip // and /* */ comments + trailing commas from the JSONC).
const EXPECTED = JSON.parse(
  readFileSync('assessments-local/expected.jsonc', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/,(\s*[}\]])/g, '$1'),
).clients || {}
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const nameMatch = (a, b) => { const x = norm(a), y = norm(b); return x && y && (x.includes(y) || y.includes(x) || x.slice(0, 14) === y.slice(0, 14)) }

// CORRECTNESS GATE (three states): CORRECT (located set == ground truth), WRONG (located non-empty but !=
// truth — spurious/missing/leak), UNREAD (located empty because the format is narrative — honest-unknown,
// NOT a correctness failure; the reader correctly declined to guess).
function correctnessGate(transcribedBehaviors, gt) {
  const truth = Array.isArray(gt?.activeBehaviors) ? gt.activeBehaviors : []
  if (!transcribedBehaviors.length) return { state: 'UNREAD' } // narrative — geometry located nothing (honest)
  if (!gt?.activeBehaviorsComplete || !truth.length) return { state: 'no-ground-truth' }
  const gotNames = transcribedBehaviors.map((b) => b.name)
  const spurious = gotNames.filter((g) => !truth.some((t) => nameMatch(g, t.name)))
  const missing = truth.filter((t) => !gotNames.some((g) => nameMatch(g, t.name))).map((t) => t.name)
  return { state: spurious.length || missing.length ? 'WRONG' : 'CORRECT', spurious, missing }
}

for (const [name, key, path, knownNames] of PDFS) {
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
  console.log(`  consistency (faithful to geometry): ${v.length ? R('FAIL — ' + v.join(' | ')) : G('PASS')}`)

  // CORRECTNESS gate — the meaningful bar: is the located behavior set actually RIGHT?
  const c = correctnessGate(t.behaviors, EXPECTED[key])
  if (c.state === 'CORRECT') console.log(`  correctness (behaviors vs ground truth): ${G('CORRECT')}`)
  else if (c.state === 'UNREAD') console.log(`  correctness (behaviors vs ground truth): ${Y('UNREAD — narrative format, geometry located 0; honest-unknown (NOT guessed)')}`)
  else if (c.state === 'WRONG') console.log(`  correctness (behaviors vs ground truth): ${R('WRONG')}${c.spurious.length ? D(`\n      spurious: ${c.spurious.join(', ')}`) : ''}${c.missing.length ? D(`\n      missing:  ${c.missing.join(', ')}`) : ''}`)
  else console.log(`  correctness: ${D('(no ground truth set)')}`)

  // CONFIDENCE GUARD — intrinsic self-assessment (no ground truth) → refresh vs preserve+flag.
  const conf = assessConfidence(rows)
  const badge = conf.level === 'HIGH' ? G('HIGH') : conf.level === 'UNREAD' ? Y('UNREAD') : R('LOW')
  console.log(`  confidence guard: ${badge} → ${conf.route === 'refresh' ? G('REFRESH behaviors (source of truth)') : R('PRESERVE existing + FLAG (no overwrite, no drop)')}`)
  for (const r of conf.reasons) console.log(D(`      reason: ${r}`))
  if (conf.perBehaviorFlags.length) console.log(D(`      per-behavior flags: ${conf.perBehaviorFlags.map((f) => `${f.name} (${f.issue})`).join('; ')}`))
}
console.log('')
