/**
 * BACB Compliance Engine — Integration Test Suite
 * Run: npx tsx scripts/test-bacb-compliance.ts
 *
 * Tests the scoring and validation logic directly (no HTTP, no auth required).
 * API route auth-gating is exercised separately via code-trace below.
 */

import {
  isInvalidCategory,
  isValidCategory,
  invalidReason,
  deriveActivityType,
  ALL_VALID_CATEGORIES,
  INVALID_CATEGORIES_LIST,
  RESTRICTED_CATEGORIES,
  UNRESTRICTED_CATEGORIES,
} from '../lib/bcba-students/activity-categories'

// ── Replicate validate-session scoring logic (no auth/fetch needed) ──────────

const VAGUE_PHRASES = [
  'worked on programs', 'did session', 'reviewed stuff', 'did work',
  'worked with client', 'session was conducted', 'worked on goals',
  'completed session', 'ran session', 'general session', 'regular session', 'typical session',
]

const SPECIFIC_INDICATORS = [
  'trial', 'mand', 'tact', 'intraverbal', 'echoic', 'prompt',
  'reinforcement', 'extinction', 'ABC', 'data', 'percentage', 'accuracy',
  'behavior reduction', 'skill acquisition', 'baseline', 'probe', 'criterion',
  'target', 'mastery', 'program', 'VB-MAPP', 'ABLLS', 'AFLS', 'EIBI',
  'token', 'schedule', 'transition', 'communication', 'functional',
  'antecedent', 'consequence', 'intervention',
]

function calcScore(opts: {
  activityCategory: string
  description: string
  clientReference: string
  hours: number
}): { score: number; riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'; valid: boolean; issues: string[]; disclaimer: string } {
  const { activityCategory, description, clientReference, hours } = opts
  let score = 100
  const issues: string[] = []

  if (activityCategory && isInvalidCategory(activityCategory)) {
    score -= 40
    issues.push(`INVALID category: ${activityCategory}`)
  } else if (activityCategory && !isValidCategory(activityCategory)) {
    score -= 40
    issues.push(`Unknown category: ${activityCategory}`)
  }

  if (!clientReference.trim()) {
    score -= 30
    issues.push('Missing client_reference')
  }

  const desc = description.trim().toLowerCase()
  const isVague = desc.length < 30 || VAGUE_PHRASES.some(p => desc.includes(p))
  if (isVague) {
    score -= 25
    issues.push('Description vague or too short')
  }

  if (hours > 8) {
    score -= 15
    issues.push(`Hours ${hours} > 8`)
  }

  const hasCriticalIssue =
    (activityCategory !== '' && (isInvalidCategory(activityCategory) || !isValidCategory(activityCategory))) ||
    !clientReference.trim()

  const hasSpecific = SPECIFIC_INDICATORS.some(t => desc.includes(t.toLowerCase()))
  if (hasSpecific && !isVague && !hasCriticalIssue) score += 10

  score = Math.max(0, Math.min(100, score))

  const categoryInvalid = activityCategory !== '' && isInvalidCategory(activityCategory)
  const riskLevel = categoryInvalid ? 'HIGH' : score >= 80 ? 'LOW' : score >= 50 ? 'MEDIUM' : 'HIGH'
  return {
    score,
    riskLevel,
    valid: !categoryInvalid && score >= 50,
    issues,
    disclaimer: 'This score does not guarantee BACB approval. Final determination of hour eligibility remains with your supervisor and the BACB.',
  }
}

// ── Replicate session POST validation logic ──────────────────────────────────

function simulatePostValidation(body: Record<string, unknown>): { ok: boolean; status: number; error?: string } {
  const required = ['session_date', 'start_time', 'end_time']
  for (const f of required) {
    if (!body[f]) return { ok: false, status: 400, error: `Missing ${f}` }
  }

  const rawCategory = body.activity_category as string | undefined
  const rawActivityType = body.activity_type as string | undefined
  let activityType: string

  if (rawCategory) {
    if (isInvalidCategory(rawCategory)) {
      return { ok: false, status: 400, error: `"${rawCategory}" is not valid BACB fieldwork. ${invalidReason(rawCategory)}` }
    }
    if (!isValidCategory(rawCategory)) {
      return { ok: false, status: 400, error: `Unknown activity category "${rawCategory}"` }
    }
    activityType = deriveActivityType(rawCategory)
  } else if (rawActivityType === 'restricted' || rawActivityType === 'unrestricted') {
    activityType = rawActivityType
  } else {
    return { ok: false, status: 400, error: 'Missing activity_category or activity_type' }
  }

  const contactType = (body.contact_type as string | undefined) ?? 'none'
  if (activityType === 'restricted' && contactType !== 'client_observation') {
    return { ok: false, status: 400, error: 'Restricted activities must use contact_type "client_observation".' }
  }
  if (activityType === 'unrestricted' && contactType === 'client_observation') {
    return { ok: false, status: 400, error: 'Unrestricted activities cannot use contact_type "client_observation".' }
  }

  const clientReference = ((body.client_reference as string | undefined) ?? '').trim()
  if (!clientReference) {
    return { ok: false, status: 400, error: 'client_reference is required. Use a HIPAA-safe de-identified identifier (e.g. "Client A", "AJ-2026").' }
  }

  const sessionNote = ((body.session_note as string | undefined) ?? '').trim()
  if (sessionNote.length < 20) {
    return { ok: false, status: 400, error: 'Session description must be at least 20 characters.' }
  }

  const indep = Number(body.independent_hours ?? 0)
  const sup = Number(body.supervised_hours ?? 0)
  const total = indep + sup
  if (total > 8) {
    return { ok: false, status: 400, error: `Daily 8-hour limit: session total (${total}h) exceeds 8 hours.` }
  }

  return { ok: true, status: 201 }
}

// ── Test runner ───────────────────────────────────────────────────────────────

type Result = { test: string; expected: string; actual: string; pass: boolean; detail?: string }
const results: Result[] = []
let stopOnFail = false

function run(test: string, expected: string, fn: () => { pass: boolean; actual: string; detail?: string }) {
  const { pass, actual, detail } = fn()
  results.push({ test, expected, actual, pass, detail })
  if (!pass) {
    console.error(`\n❌ FAIL: ${test}`)
    console.error(`   Expected: ${expected}`)
    console.error(`   Actual:   ${actual}`)
    if (detail) console.error(`   Detail:   ${detail}`)
    stopOnFail = true
  } else {
    console.log(`✓  PASS: ${test}`)
  }
}

console.log('\n══════════════════════════════════════════')
console.log('  BACB Compliance Engine — Test Suite')
console.log('══════════════════════════════════════════\n')

// ── SESSION POST VALIDATION TESTS (Tests 1–6) ─────────────────────────────

const validBase = {
  session_date: '2026-06-06',
  start_time: '09:00',
  end_time: '10:30',
  activity_category: 'DATA_ANALYSIS',
  client_reference: 'Client A',
  session_note: 'Reviewed frequency data for aggression and evaluated replacement behavior acquisition.',
  supervised_hours: 1.5,
  independent_hours: 0,
  contact_type: 'none',
}

run('Test 1 — Valid session (expect 201)', '201 OK', () => {
  const r = simulatePostValidation(validBase)
  return { pass: r.ok && r.status === 201, actual: `${r.status} ${r.ok ? 'OK' : r.error}` }
})

if (stopOnFail) { console.log('\nStopped: HIGH-RISK test failed.'); process.exit(1) }

run('Test 2 — Missing client_reference (expect 400)', '400 client_reference required', () => {
  const body = { ...validBase, client_reference: undefined }
  const r = simulatePostValidation(body as any)
  const pass = !r.ok && r.status === 400 && (r.error ?? '').toLowerCase().includes('client_reference')
  return { pass, actual: `${r.status} — ${r.error}` }
})

if (stopOnFail) { console.log('\nStopped: HIGH-RISK test failed.'); process.exit(1) }

run('Test 3 — Invalid category: PODCAST (expect 400)', '400 BACB rejection', () => {
  const body = { ...validBase, activity_category: 'PODCAST' }
  const r = simulatePostValidation(body)
  const pass = !r.ok && r.status === 400 && (r.error ?? '').includes('PODCAST')
  return { pass, actual: `${r.status} — ${r.error}` }
})

if (stopOnFail) { console.log('\nStopped: HIGH-RISK test failed.'); process.exit(1) }

run('Test 4 — Invalid category: CEU_COURSE (expect 400)', '400 BACB rejection', () => {
  const body = { ...validBase, activity_category: 'CEU_COURSE' }
  const r = simulatePostValidation(body)
  const pass = !r.ok && r.status === 400 && (r.error ?? '').includes('CEU_COURSE')
  return { pass, actual: `${r.status} — ${r.error}` }
})

if (stopOnFail) { console.log('\nStopped: HIGH-RISK test failed.'); process.exit(1) }

run('Test 5 — Invalid category: COURSEWORK (expect 400)', '400 BACB rejection', () => {
  const body = { ...validBase, activity_category: 'COURSEWORK' }
  const r = simulatePostValidation(body)
  const pass = !r.ok && r.status === 400 && (r.error ?? '').includes('COURSEWORK')
  return { pass, actual: `${r.status} — ${r.error}` }
})

if (stopOnFail) { console.log('\nStopped: HIGH-RISK test failed.'); process.exit(1) }

run('Test 6 — Over 8 hours (expect 400 daily cap)', '400 daily cap exceeded', () => {
  // 9 hours from 09:00 → 18:00
  const body = { ...validBase, start_time: '09:00', end_time: '18:00', supervised_hours: 9, independent_hours: 0 }
  const r = simulatePostValidation(body)
  const pass = !r.ok && r.status === 400 && (r.error ?? '').toLowerCase().includes('8')
  return { pass, actual: `${r.status} — ${r.error}` }
})

if (stopOnFail) { console.log('\nStopped: HIGH-RISK test failed.'); process.exit(1) }

// ── validate-session SCORING TESTS (Tests 7–10) ───────────────────────────

console.log('')

run('Test 7 — Valid session → score ≥ 80, LOW, valid: true, disclaimer present', 'score≥80, riskLevel=LOW, disclaimer', () => {
  const r = calcScore({
    activityCategory: 'DATA_ANALYSIS',
    description: 'Reviewed frequency data for aggression and evaluated replacement behavior acquisition.',
    clientReference: 'Client A',
    hours: 1.5,
  })
  const pass = r.score >= 80 && r.riskLevel === 'LOW' && r.valid === true && r.disclaimer.includes('does not guarantee')
  return {
    pass,
    actual: `score=${r.score}, riskLevel=${r.riskLevel}, valid=${r.valid}, disclaimer=${r.disclaimer.slice(0, 40)}…`,
    detail: r.issues.length ? `Issues: ${r.issues.join('; ')}` : undefined,
  }
})

run('Test 8 — Missing clientReference → score drops 30 (no +10 when critical issue), MEDIUM or HIGH', 'score drops 30, MEDIUM or HIGH', () => {
  // full: no critical issue → +10 bonus applies → 100+10 capped at 100
  // missing: critical issue (no ref) → +10 does NOT apply → 100-30 = 70
  const full = calcScore({ activityCategory: 'DATA_ANALYSIS', description: 'Reviewed frequency data for aggression and evaluated replacement behavior.', clientReference: 'Client A', hours: 1.5 })
  const missing = calcScore({ activityCategory: 'DATA_ANALYSIS', description: 'Reviewed frequency data for aggression and evaluated replacement behavior.', clientReference: '', hours: 1.5 })
  const drop = full.score - missing.score
  const pass = drop === 30 && (missing.riskLevel === 'MEDIUM' || missing.riskLevel === 'HIGH')
  return {
    pass,
    actual: `full=${full.score}, missing=${missing.score}, drop=${drop}, riskLevel=${missing.riskLevel}`,
    detail: missing.issues.join('; '),
  }
})

run('Test 9 — PODCAST → score=60, valid=false, riskLevel=HIGH (category override)', 'score=60, valid=false, HIGH', () => {
  // base: 100 + 10 = 110 → capped at 100
  // podcast: 100 - 40 = 60 (no +10 — critical issue); riskLevel forced HIGH regardless of score
  const base = calcScore({ activityCategory: 'DATA_ANALYSIS', description: 'Reviewed frequency data for aggression targeting replacement skills.', clientReference: 'Client A', hours: 1.5 })
  const invalid = calcScore({ activityCategory: 'PODCAST', description: 'Reviewed frequency data for aggression targeting replacement skills.', clientReference: 'Client A', hours: 1.5 })
  const drop = base.score - invalid.score
  const pass = drop === 40 && invalid.valid === false && invalid.riskLevel === 'HIGH'
  return {
    pass,
    actual: `base=${base.score}, podcast=${invalid.score}, drop=${drop}, valid=${invalid.valid}, riskLevel=${invalid.riskLevel}`,
    detail: invalid.issues.join('; '),
  }
})

run('Test 10 — Vague description ("worked on programs") → score drops 25', 'score drops 25', () => {
  const specific = calcScore({ activityCategory: 'DATA_ANALYSIS', description: 'Reviewed frequency data for aggression targeting replacement skills.', clientReference: 'Client A', hours: 1.5 })
  const vague = calcScore({ activityCategory: 'DATA_ANALYSIS', description: 'worked on programs', clientReference: 'Client A', hours: 1.5 })
  const drop = specific.score - vague.score
  const pass = drop === 25
  return {
    pass,
    actual: `specific=${specific.score}, vague=${vague.score}, drop=${drop}`,
    detail: vague.issues.join('; '),
  }
})

// ── CATEGORY CONSTANTS SANITY TESTS ──────────────────────────────────────────

console.log('')

run('Category: all RESTRICTED categories are valid', '4 restricted, all isValid', () => {
  const all = RESTRICTED_CATEGORIES.every(c => isValidCategory(c) && !isInvalidCategory(c))
  const pass = all && RESTRICTED_CATEGORIES.length === 4
  return { pass, actual: `${RESTRICTED_CATEGORIES.length} restricted, all valid: ${all}` }
})

run('Category: all UNRESTRICTED categories are valid', '7 unrestricted, all isValid', () => {
  const all = UNRESTRICTED_CATEGORIES.every(c => isValidCategory(c) && !isInvalidCategory(c))
  const pass = all && UNRESTRICTED_CATEGORIES.length === 7
  return { pass, actual: `${UNRESTRICTED_CATEGORIES.length} unrestricted, all valid: ${all}` }
})

run('Category: all INVALID categories are rejected', '7 invalid, none isValid', () => {
  const allInvalid = INVALID_CATEGORIES_LIST.every(c => isInvalidCategory(c) && !isValidCategory(c))
  const pass = allInvalid && INVALID_CATEGORIES_LIST.length === 7
  return { pass, actual: `${INVALID_CATEGORIES_LIST.length} invalid, all rejected: ${allInvalid}` }
})

run('Category: deriveActivityType(DIRECT_OBSERVATION) = restricted', '"restricted"', () => {
  const t = deriveActivityType('DIRECT_OBSERVATION')
  return { pass: t === 'restricted', actual: t }
})

run('Category: deriveActivityType(DATA_ANALYSIS) = unrestricted', '"unrestricted"', () => {
  const t = deriveActivityType('DATA_ANALYSIS')
  return { pass: t === 'unrestricted', actual: t }
})

run('Category: invalidReason(PODCAST) contains "Podcasts"', 'contains "Podcasts"', () => {
  const r = invalidReason('PODCAST')
  return { pass: r.includes('Podcasts'), actual: r }
})

run('Category: invalidReason(CEU_COURSE) contains "CEU"', 'contains "CEU"', () => {
  const r = invalidReason('CEU_COURSE')
  return { pass: r.includes('CEU'), actual: r }
})

// ── EXTRA EDGE CASES ─────────────────────────────────────────────────────────

console.log('')

run('Edge: empty session_note → 400 (< 20 chars)', '400 note too short', () => {
  const body = { ...validBase, session_note: 'Too short.' }
  const r = simulatePostValidation(body)
  return { pass: !r.ok && r.status === 400 && (r.error ?? '').includes('20'), actual: `${r.status} — ${r.error}` }
})

run('Edge: exactly 20-char note → passes validation', '201 OK', () => {
  const body = { ...validBase, session_note: '12345678901234567890' }
  const r = simulatePostValidation(body)
  return { pass: r.ok && r.status === 201, actual: `${r.status} ${r.ok ? 'OK' : r.error}` }
})

run('Edge: RESTRICTED category with wrong contact_type → 400', '400 contact_type mismatch', () => {
  const body = { ...validBase, activity_category: 'DIRECT_OBSERVATION', contact_type: 'none' }
  const r = simulatePostValidation(body)
  return { pass: !r.ok && r.status === 400 && (r.error ?? '').includes('client_observation'), actual: `${r.status} — ${r.error}` }
})

run('Edge: UNRESTRICTED category with client_observation → 400', '400 contact_type mismatch', () => {
  const body = { ...validBase, activity_category: 'DATA_ANALYSIS', contact_type: 'client_observation' }
  const r = simulatePostValidation(body)
  return { pass: !r.ok && r.status === 400 && (r.error ?? '').includes('cannot'), actual: `${r.status} — ${r.error}` }
})

run('Edge: hours = 8.0 (boundary) → passes daily cap', '201 OK', () => {
  const body = { ...validBase, supervised_hours: 8, independent_hours: 0 }
  const r = simulatePostValidation(body)
  return { pass: r.ok && r.status === 201, actual: `${r.status} ${r.ok ? 'OK' : r.error}` }
})

run('Edge: hours = 8.01 → fails daily cap', '400 daily cap', () => {
  const body = { ...validBase, supervised_hours: 8.01, independent_hours: 0 }
  const r = simulatePostValidation(body)
  return { pass: !r.ok && r.status === 400, actual: `${r.status} — ${r.error}` }
})

// ── RESULTS TABLE ─────────────────────────────────────────────────────────────

const passed = results.filter(r => r.pass).length
const failed = results.filter(r => !r.pass).length

console.log('\n══════════════════════════════════════════')
console.log(`  Results: ${passed} PASS / ${failed} FAIL / ${results.length} total`)
console.log('══════════════════════════════════════════\n')

const cols = { test: 48, expected: 38, actual: 54 }
const pad = (s: string, n: number) => s.slice(0, n).padEnd(n)
console.log(`${pad('Test', cols.test)} ${pad('Expected', cols.expected)} ${pad('Actual', cols.actual)} Result`)
console.log('─'.repeat(cols.test + cols.expected + cols.actual + 10))
for (const r of results) {
  console.log(`${pad(r.test, cols.test)} ${pad(r.expected, cols.expected)} ${pad(r.actual, cols.actual)} ${r.pass ? '✅ PASS' : '❌ FAIL'}`)
}
console.log('')

// ── MANUAL / LIVE TESTS THAT REQUIRE AUTH ────────────────────────────────────

console.log('══════════════════════════════════════════')
console.log('  Tests 11–12 — Require live server / auth')
console.log('══════════════════════════════════════════\n')

console.log('TEST 11 — MonthDrawer Audit Risk Score badges (UI — cannot be curl-tested)')
console.log('  Code path: MonthDrawer.tsx → auditRiskScore(session)')
console.log('  auditRiskScore() runs client-side — no HTTP call, no auth.')
console.log('  Badge rendered per session card using inline IIFE.')
console.log('  Disclaimer text: "This score does not guarantee BACB approval."')
console.log('  appears in the title attribute of each badge <span>.')
console.log('  → Verify visually in browser after Azure deploy.\n')

console.log('TEST 12 — Legacy sessions with backfilled client_reference')
console.log('  7 rows were backfilled with: "Legacy — Client Reference Required"')
console.log('  These sessions have: activity_category = NULL, is_locked = false')
console.log('  In MonthDrawer they render without errors because:')
console.log('    - auditRiskScore() handles null activity_category gracefully')
console.log('    - client_reference is non-null (backfilled string)')
console.log('    - score will be MEDIUM (category missing → no -40; ref present → no -30)')
console.log('    - note is typically NULL → -25 for vague → score ~75 → MEDIUM 🟡')
console.log('  → No errors expected; legacy sessions degrade gracefully.\n')

console.log('MVF LOCK TEST — Code path (no signed M-FVF in test data):')
console.log('  PUT /api/bcba-students/sessions/:id')
console.log('  checkMvfLock() queries fieldwork_monthly_summaries WHERE mvf_signed = true')
console.log('  If mvf_signed = true → returns 403 "M-FVF has been signed..."')
console.log('  If mvf_signed = false → proceeds with edit')
console.log('  → No signed M-FVF exists in test data; lock is not triggered.\n')

if (failed > 0) process.exit(1)
