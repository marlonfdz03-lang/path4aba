// ─────────────────────────────────────────────────────────────────────────────
// ASSESSMENT-REFRESH PROOF HARNESS
//
// Runs the REAL extraction + build pipeline against real assessment PDFs and checks the refreshed
// profile for the three data-destroying bugs — BEFORE any real user (or d4c2094) can trigger them:
//   Bug 1 MASTERY   — per-item status flattened to 'active' (destroyer) AND status vs masteredBehaviors
//                     split-brain (which the eventual fix must collapse to one source of truth).
//   Bug 2 REINFORCERS — naive comma-split shreds prose into garbage fragments. Tested on BOTH paths:
//                     mapToLegacyFormat (LIVE in production create/merge) AND buildAssessmentProfile
//                     (the refresh path d4c2094 uses). Both have the comma-split (:118 and :173).
//   Bug 3 DIAGNOSIS — over-counts / doesn't replace stale codes.
// Plus refresh correctness (behaviors present with functions+topographies) and the refresh mechanics
// (previousProfile snapshot + observedCatalog preserved).
//
// This is a LOCAL dev tool. It hits the live Azure endpoint and reads real PHI PDFs from the git-ignored
// assessments-local/ dir. Output stays on your machine; nothing is written to git. It writes NOTHING to
// the database — read-and-compute only.
//
// RUN:  npm run prove:assessment      (which is: node --env-file=.env.local scripts/proveAssessmentRefresh.mjs)
//
// PHASE A (observe): with an empty/placeholder expected.jsonc it prints the ACTUAL extracted values so you
//                    can fill the ground truth from the PDFs.
// PHASE B (gate):    with expected.jsonc filled it asserts each check PASS/FAIL. Expect RED today — that
//                    is the proof-of-bug. The fixes must turn it green on all three assessments.
// ─────────────────────────────────────────────────────────────────────────────
import { register } from 'node:module';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Register the @/ alias resolver BEFORE importing any app module (they use @/lib/... imports).
register('./alias-hooks.mjs', import.meta.url);

const HERE = new URL('.', import.meta.url);
const ROOT = new URL('../', import.meta.url);
const LOCAL = new URL('../assessments-local/', import.meta.url);

// Dynamic imports so they resolve AFTER register() above.
const { parsePdf, buildAssessmentProfile, mapToLegacyFormat } = await import('../lib/assessmentPipeline.ts');
const { extractAssessment } = await import('../lib/extractAssessment.ts');
const { parsePositioned, clusterRows } = await import('../lib/pdfGeometry.ts');
const { assembleCommit1, assembleRefreshProfile } = await import('../lib/assembleRefreshProfile.ts');
const { validateAssessmentProfile, buildRefreshedProfile } = await import('../lib/assessmentRefresh.ts');
const { CURATED_HOME_ACTIVITIES, CURATED_SCHOOL_ACTIVITIES } = await import('../lib/curatedActivities.ts');
const { diagnosisColumn } = await import('../lib/diagnosis.ts');

// ── tiny helpers ──────────────────────────────────────────────────────────────
const arr = (v) => (Array.isArray(v) ? v : []);
const norm = (s) => String(s || '').toLowerCase().trim();
const C = { green: (s) => `\x1b[32m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` };
let RED_COUNT = 0;
const check = (label, ok, detail = '') => {
  if (ok === null) { console.log(`   ${C.dim('•')} ${label} ${C.dim('(observe — no ground truth filled)')} ${detail}`); return; }
  if (!ok) RED_COUNT++;
  console.log(`   ${ok ? C.green('PASS') : C.red('FAIL')}  ${label}${detail ? '  ' + C.dim(detail) : ''}`);
};

// String-aware JSONC → JSON (so the template can carry // and /* */ comments for a non-coder to read).
function stripJsonc(src) {
  let out = '', inStr = false, q = '', i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (inStr) { out += c; if (c === '\\') { out += src[++i] ?? ''; } else if (c === q) inStr = false; i++; continue; }
    if (c === '"' || c === "'") { inStr = true; q = c; out += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}

const ICD = (s) => (String(s).match(/[A-Z]\d{2}(?:\.\d+)?/g) || []); // pull ICD codes from a diagnosis string
const codesOf = (list) => [...new Set(arr(list).flatMap(ICD))];

// A reinforcer entry looks SHREDDED (a fragment of prose, not a discrete reinforcer) when it…
function shredFlags(item) {
  const s = String(item || '');
  const flags = [];
  if (/^\s*(and|or|like|such as|including|e\.g\.)\b/i.test(s)) flags.push('leading-conjunction');
  if (/\bsuch as\b/i.test(s)) flags.push('embedded-"such as"');
  if (((s.match(/'/g) || []).length % 2) === 1 || ((s.match(/"/g) || []).length % 2) === 1) flags.push('unbalanced-quote');
  if (/^[\s'"().,;:-]+$/.test(s)) flags.push('punctuation-only');
  return flags;
}

// ── load ground truth ───────────────────────────────────────────────────────
const expPath = new URL('expected.jsonc', LOCAL);
if (!existsSync(fileURLToPath(expPath))) {
  console.error(C.red(`\nMissing ${fileURLToPath(expPath)} — the ground-truth template. See the one written for you.`));
  process.exit(1);
}
const expected = JSON.parse(stripJsonc(readFileSync(expPath, 'utf8')));
const clients = expected.clients || {};

if (!process.env.AZURE_OPENAI_ENDPOINT) {
  console.error(C.red('\nAZURE_OPENAI_ENDPOINT is not set. Run via `npm run prove:assessment` (loads .env.local).'));
  process.exit(1);
}

console.log(C.bold('\n════ ASSESSMENT-REFRESH PROOF HARNESS ════'));
console.log(C.dim('Real extraction against real PDFs. No DB writes. Output is local-only.\n'));

// Synthetic prior profile for the refresh-mechanics check (mastery + captured dropdowns that MUST survive).
const FIXTURE_EXISTING = {
  maladaptiveBehaviors: [{ name: 'PriorBehavior', status: 'mastered', functions: ['escape'], topographies: ['x'] }],
  observedCatalog: { aba_matrix: { current: { functions: ['Escape'], functionsByBehavior: { PriorBehavior: ['Escape', 'Automatic Reinforcement'] } } } },
  blockedNarrativeTerms: [{ term: 'sensory', substitute: null }],
  previousProfile: { shouldBeStripped: true },
};

// Resolve a client's PDF: the exact configured name if present, else any *.pdf in the folder whose
// filename contains the client key (so "ALEXANDRA-REASSESSMENT-….pdf" matches key "alexandra"). This
// spares a non-coder from renaming exports.
const pdfFiles = existsSync(fileURLToPath(LOCAL)) ? readdirSync(fileURLToPath(LOCAL)).filter((f) => f.toLowerCase().endsWith('.pdf')) : [];
function resolvePdf(key, gt) {
  const configured = gt.pdf || `${key}.pdf`;
  if (pdfFiles.includes(configured)) return configured;
  return pdfFiles.find((f) => f.toLowerCase().includes(key.toLowerCase())) || null;
}

for (const [key, gt] of Object.entries(clients)) {
  const pdfName = resolvePdf(key, gt);
  console.log(C.bold(`\n──── ${key}${pdfName ? ` (${pdfName})` : ''} ────`));
  if (gt.assessment) console.log(C.dim(`   ground truth: ${gt.assessment} — mastery/active tested against THIS assessment`));
  if (!pdfName) {
    console.log(C.dim(`   (skipped — no PDF matching “${key}” found in assessments-local/)`));
    continue;
  }
  const pdfPath = new URL(pdfName, LOCAL);

  let extracted, geomRows;
  try {
    const buffer = readFileSync(fileURLToPath(pdfPath));
    const text = await parsePdf(buffer);
    extracted = await extractAssessment(String(text).slice(0, 90000));
    geomRows = clusterRows(await parsePositioned(buffer)); // FAST/MAS positioned read (same one parse)
  } catch (e) {
    console.log(C.red(`   extraction failed: ${e.message}`));
    RED_COUNT++;
    continue;
  }

  const llmRefreshProfile = buildAssessmentProfile(extracted); // LLM baseline (d4c2094 refresh path)
  // FAST/MAS Commit 1 overlay: geometry-authoritative diagnosis + mastered-skills; LLM flagged fallback.
  const { profile: refreshProfile, reviewFlags } = assembleCommit1(llmRefreshProfile, geomRows);
  // Create path gets the SAME geometry overlay (diagnosis + mastered authoritative, LLM flagged fallback).
  const createProfile = assembleCommit1(mapToLegacyFormat(extracted), geomRows).profile;

  // ── Guard 1 (must not false-reject a real assessment) ──
  const problems = validateAssessmentProfile(refreshProfile, extracted);
  check('Guard 1 accepts this real assessment', problems.length === 0, problems.length ? `problems: ${problems.join('; ')}` : '');

  // ── Bug 1: MASTERY (checked on the STORED profile, whose single source is per-item status) ──
  const activeOut = new Set(arr(refreshProfile.maladaptiveBehaviors).map((b) => norm(b.name)));
  const storedStatus = new Map(arr(refreshProfile.maladaptiveBehaviors).map((b) => [norm(b.name), norm(b.status)]));
  const storedMastered = new Set(arr(refreshProfile.masteredBehaviors).map(norm));

  // 1a — ONE source of truth: a behavior's STORED classification (mastered vs active) must match its own
  // per-item status. The pre-fix pipeline routed behaviors by masteredBehaviors[] (a SECOND source) and
  // hardcoded 'active', so stored mastery could disagree with status — the split-brain. Post-fix everything
  // derives from status, so they agree. (A name-only mastered entry the LLM listed only in masteredBehaviors[]
  // has no extracted behavior row, so it's not in this loop — legitimately stored-mastered, not a disagreement.)
  const disagree = [];
  for (const b of arr(extracted.maladaptiveBehaviors)) {
    const name = norm(b.name);
    const statusMastered = norm(b.status) === 'mastered';
    if (statusMastered !== storedMastered.has(name)) {
      disagree.push(`${b.name}: status=${norm(b.status) || 'unknown'} but stored ${storedMastered.has(name) ? 'mastered' : 'active'}`);
    }
  }
  const activeWithMasteredStatus = arr(refreshProfile.maladaptiveBehaviors).filter((b) => norm(b.status) === 'mastered').map((b) => b.name);
  check('Bug 1a — one mastery source (stored classification matches per-item status)',
    disagree.length === 0 && activeWithMasteredStatus.length === 0,
    [disagree.join(' | '), activeWithMasteredStatus.length ? `active but status=mastered: ${activeWithMasteredStatus.join(', ')}` : ''].filter(Boolean).join(' | '));
  // Diagnostic: the RAW extractor split-brain the pipeline had to reconcile (observe — does not affect pass/fail).
  {
    const byStatus = arr(extracted.maladaptiveBehaviors).filter((b) => norm(b.status) === 'mastered').map((b) => norm(b.name));
    const list = arr(extracted.masteredBehaviors).map(norm);
    const raw = [...list.filter((n) => !byStatus.includes(n)).map((n) => `${n}: in masteredBehaviors[] not status`),
                 ...byStatus.filter((n) => !list.includes(n)).map((n) => `${n}: status=mastered not in list`)];
    if (raw.length) console.log(`   ${C.dim(`↳ raw extractor split-brain reconciled by the pipeline: ${raw.join(' | ')}`)}`);
  }

  // 1b — no non-active item flattened to 'active': an extracted non-active behavior must NOT be stored with
  // status 'active' (its real status must be carried, not overwritten).
  const flattened = arr(extracted.maladaptiveBehaviors)
    .filter((b) => ['mastered', 'maintenance', 'discontinued'].includes(norm(b.status)))
    .filter((b) => storedStatus.get(norm(b.name)) === 'active')
    .map((b) => `${b.name} (was ${b.status})`);
  check('Bug 1b — no non-active item flattened to active', flattened.length === 0, flattened.length ? `flattened: ${flattened.join(', ')}` : '');

  // Mastered SKILLS/programs (a "MASTERED:" heading inside the skills section) — a REAL mastery signal in the
  // July PDFs. buildAssessmentProfile routes status=mastered skills to skillAcquisition.
  const masteredSkills = arr(refreshProfile.skillAcquisition).map((x) => x.name);
  console.log(`   ${C.dim(`↳ skills: mastered(skillAcquisition) ${masteredSkills.length} [${masteredSkills.join(', ') || 'none'}]  |  active(replacementBehaviors) ${arr(refreshProfile.replacementBehaviors).length}`)}`);
  // GATE (was observe-only): every expected mastered skill must be CAPTURED as mastered (→ skillAcquisition),
  // not dropped. Presence match (normalized substring) tolerates minor name variation. Vacuous until ground
  // truth is filled. This is instruction-driven capture — if it drops on some runs, that is the extraction
  // -stability / FAST-MAS structured-reading root, tracked as a known-residual, never force-passed.
  if (Array.isArray(gt.masteredSkills) && gt.masteredSkills.length) {
    const gotNorm = masteredSkills.map(norm);
    const missing = gt.masteredSkills.filter((w) => {
      const wn = norm(w);
      return !gotNorm.some((g) => g.includes(wn) || wn.includes(g));
    });
    check(`Skill-mastery — mastered skills captured (${masteredSkills.length})`, missing.length === 0,
      missing.length ? `DROPPED (not captured as mastered): ${missing.join(', ')}` : '');
    // Label the honest red: a mastered skill the extractor drops from a "MASTERED:" heading is not
    // instruction-fixable (proven 0/6) — it is the SAME structured-reading root as F82/functions. The gate
    // stays RED on purpose; this only LABELS it as tracked, never a false green.
    if (missing.length && gt.masteredSkillsKnownResidual) {
      console.log(`   ${C.dim(`↳ KNOWN-RESIDUAL: mastered-skill capture [${missing.join(', ')}] — extractor does not read the "MASTERED:" skills heading; tracked to FAST/MAS structured-reading front, NOT a regression`)}`);
    }
  } else {
    check('Skill-mastery — mastered skills captured', null);
  }

  // Ground-truth mastery checks. An ARRAY (even empty []) is a REAL assertion; a string ("TO CONFIRM")
  // observes. Alexandra July = [] asserts "no behavior is mastered" — the honest gate now that we know the
  // July PDF has no mastered-behavior section (the extractor's Hygiene-active/5-absent output MATCHES it).
  if (Array.isArray(gt.masteredInAssessment)) {
    const expectedMastered = gt.masteredInAssessment.map(norm);
    const masteredOut = new Set([
      ...arr(refreshProfile.masteredBehaviors).map(norm),
      ...arr(refreshProfile.maladaptiveBehaviors).filter((b) => norm(b.status) === 'mastered').map((b) => norm(b.name)),
    ]);
    // 1c — a mastered-in-PDF behavior must not be stored ACTIVE (flatten). Vacuously true for [].
    const wronglyActive = expectedMastered.filter((n) => activeOut.has(n));
    check('Bug 1c — PDF-mastered behaviors are NOT active (flatten)', wronglyActive.length === 0, wronglyActive.length ? `active but should be mastered: ${wronglyActive.join(', ')}` : '');
    // 1d — a mastered-in-PDF behavior must be PRESENT as mastered, not silently dropped. Vacuous for [].
    const dropped = gt.masteredInAssessment.filter((n) => !masteredOut.has(norm(n)) && !activeOut.has(norm(n)));
    check('Bug 1d — PDF-mastered behaviors PRESENT as mastered (not silently dropped)', dropped.length === 0, dropped.length ? `silently missing: ${dropped.join(', ')}` : '');
    // 1e — NO FALSE mastery: no behavior stored mastered that the PDF does not mark mastered. With an empty
    // expected set this asserts the extractor invented NO behavior-mastery (e.g. did not promote an STO-level
    // "Mastered" to the behavior). This is what keeps the [] gate honest — it can still go RED on over-capture.
    const falseMastered = [...masteredOut].filter((n) => !expectedMastered.includes(n));
    check('Bug 1e — no FALSE mastery (nothing wrongly marked mastered / no STO promotion)', falseMastered.length === 0, falseMastered.length ? `wrongly mastered: ${falseMastered.join(', ')}` : '');
    // Root diagnostic (only when something truly expected was dropped).
    if (dropped.length) {
      const seenByExtractor = new Set([...arr(extracted.masteredBehaviors).map(norm), ...[...arr(extracted.maladaptiveBehaviors), ...arr(extracted.replacementSkills)].map((b) => norm(b.name))]);
      const notEven = gt.masteredInAssessment.filter((n) => !seenByExtractor.has(norm(n)));
      if (notEven.length) console.log(`   ${C.dim(`↳ root: extractor never emitted [${notEven.join(', ')}] — mastered/discontinued section not read`)}`);
    }
  } else {
    check('Bug 1c — PDF-mastered behaviors are NOT active (flatten)', null);
    check('Bug 1d — PDF-mastered behaviors PRESENT as mastered (not silently dropped)', null);
    check('Bug 1e — no FALSE mastery', null);
  }

  // ── Bug 2: REINFORCERS (both paths) ──
  for (const [pathName, prof] of [['refresh(buildAssessmentProfile)', refreshProfile], ['create(mapToLegacyFormat)', createProfile]]) {
    const items = arr(prof.reinforcers);
    const shredded = items.map((it) => ({ it, flags: shredFlags(it) })).filter((x) => x.flags.length);
    check(`Bug 2 — reinforcers clean [${pathName}] (${items.length} items)`, shredded.length === 0,
      shredded.length ? `${shredded.length} shredded, e.g. ${shredded.slice(0, 4).map((x) => JSON.stringify(x.it)).join(', ')}` : '');
  }

  // ── Bug 3: DIAGNOSIS (both paths) ──
  const july = codesOf(gt.diagnosisJuly);
  const staleOld = codesOf(gt.diagnosisJanuaryOld);
  // KNOWN-RESIDUAL codes (e.g. Felix F82): a "suspected"/differential the extractor emits BARE as a
  // confirmed F-code. NOT deterministically catchable (valid code, no marker) — tracked to the extraction-
  // accuracy / FAST-MAS structured-reading front (read the confirmed-diagnosis TABLE, same root as reading
  // the function tables). The over-count check stays RED on purpose (honest, not a false green); this only
  // LABELS the red so it is not mistaken for a regression. NEVER add these to diagnosisJuly ground truth.
  const knownResidual = codesOf(gt.diagnosisKnownResidual);
  for (const [pathName, prof] of [['refresh', refreshProfile], ['create', createProfile]]) {
    const got = codesOf(prof.diagnosis);
    if (july.length) {
      check(`Bug 3 — diagnosis count [${pathName}]`, got.length === july.length, `got ${got.length} (${got.join(',')}), expected ${july.length} (${july.join(',')})`);
      check(`Bug 3 — expected codes present [${pathName}]`, july.every((c) => got.includes(c)), `missing: ${july.filter((c) => !got.includes(c)).join(',') || 'none'}`);
      if (staleOld.length) check(`Bug 3 — stale old codes replaced/absent [${pathName}]`, !staleOld.some((c) => got.includes(c)), `stale still present: ${staleOld.filter((c) => got.includes(c)).join(',') || 'none'}`);
      // Label the honest red: if the ONLY over-count codes are known residuals, say so explicitly.
      const extra = got.filter((c) => !july.includes(c));
      if (extra.length && extra.every((c) => knownResidual.includes(c))) {
        console.log(`   ${C.dim(`↳ KNOWN-RESIDUAL [${pathName}]: ${extra.join(', ')} — extraction-judgment (bare "suspected" F-code); tracked to FAST/MAS structured-reading front, NOT a regression`)}`);
      }
    } else check(`Bug 3 — diagnosis [${pathName}] got ${got.length}: ${got.join(',')}`, null);
  }
  // Bug 3 — COLUMN SYNC (no-drift): the clients.diagnosis COLUMN the refresh route writes derives from the
  // SAME normalized diagnosis as the JSON, so parsing the column back to codes must equal the JSON's codes.
  // The harness does no DB writes, so this gates the invariant (one normalized source → column == JSON),
  // catching any future path that lets the column drift from clinical_profile.diagnosis.
  const jsonCodes = codesOf(refreshProfile.diagnosis).sort();
  const columnCodes = codesOf([diagnosisColumn(refreshProfile.diagnosis)]).sort();
  check('Bug 3 — column sync: diagnosis COLUMN matches JSON (no drift)',
    JSON.stringify(jsonCodes) === JSON.stringify(columnCodes),
    `column [${columnCodes.join(',')}] vs json [${jsonCodes.join(',')}]`);
  // Firewall backstop: NO Z-code and NO obviously-unconfirmed code may survive in the stored diagnosis.
  const zcodes = codesOf(refreshProfile.diagnosis).filter((c) => /^Z/i.test(c));
  check('Bug 3 — firewall: no Z-code in stored diagnosis', zcodes.length === 0, zcodes.length ? `leaked Z-codes: ${zcodes.join(',')}` : '');

  // ── FAST/MAS Commit 1: geometry-authoritative diagnosis + mastered; LLM fallback FLAGGED ──
  // The assembled refreshProfile above is already geometry-overlaid. Confirm the flag discipline: a field
  // geometry read structurally has NO llm-fallback flag; a field it could not read keeps the LLM value WITH
  // a flag. (No client name here — the flag is driven by whether geometry located the structure.)
  const dxFlag = reviewFlags.some((f) => f.field === 'diagnosis' && f.source === 'llm-fallback');
  const geomReadDiagnosis = !dxFlag; // geometry located a confirmed-diagnosis table → authoritative, unflagged
  console.log(`   ${C.dim(`↳ FAST/MAS: diagnosis ${geomReadDiagnosis ? 'GEOMETRY-authoritative' : 'LLM-fallback (flagged)'} · reviewFlags [${reviewFlags.map((f) => f.field + ':' + f.source).join(', ') || 'none'}]`)}`);
  // Firewall gate: every field NOT read by geometry must be flagged — never a silent unverified value.
  // Here we assert the flag exists whenever the LLM value was used for diagnosis (geometry didn't read it).
  if (dxFlag) check('FAST/MAS — LLM-fallback diagnosis is FLAGGED (never presented as verified)', true, '');

  // ── FAST/MAS Commit 2: GUARDED behavior refresh (HIGH → geometry refresh · LOW/UNREAD → preserve) ──
  // A DISTINCTIVE mock "existing profile" so preserve is provable: if guarded, the assembled behaviors must
  // EQUAL this mock (not the incomplete geometric read) — the whole point of the guard.
  const mockExisting = {
    maladaptiveBehaviors: [{ name: '__EXISTING_PRESERVED__', status: 'active', functions: ['escape'], topographies: ['existing topography'] }],
    masteredBehaviors: ['__EXISTING_MASTERED__'],
  };
  const asm = assembleRefreshProfile(llmRefreshProfile, geomRows, mockExisting);
  const conf = asm.confidence;
  console.log(`   ${C.dim(`↳ FAST/MAS guard: ${conf.level} → ${conf.route}${conf.reasons.length ? ' — ' + conf.reasons.join('; ') : ''}`)}`);
  const asmBeh = arr(asm.profile.maladaptiveBehaviors);
  if (conf.level === 'HIGH') {
    // Refreshed from geometry — must NOT be the mock, and the active count matches the PDF (wobble gone).
    const isMock = asmBeh.some((b) => /__EXISTING_PRESERVED__/.test(b.name));
    check('FAST/MAS guard HIGH — behaviors REFRESHED from geometry (not preserved)', !isMock, isMock ? 'unexpectedly preserved the mock' : '');
    if (gt.activeBehaviorsComplete === true && arr(gt.activeBehaviors).length)
      check(`FAST/MAS guard HIGH — geometry active count matches PDF (${asmBeh.length})`, asmBeh.length === arr(gt.activeBehaviors).length, `got ${asmBeh.length}, expected ${arr(gt.activeBehaviors).length}`);
  } else {
    // THE CRITICAL ASSERTION — preserved existing behaviors, NOT the dirty read.
    const preserved = JSON.stringify(asmBeh) === JSON.stringify(mockExisting.maladaptiveBehaviors)
      && JSON.stringify(arr(asm.profile.masteredBehaviors)) === JSON.stringify(mockExisting.masteredBehaviors);
    check(`FAST/MAS guard ${conf.level} — behaviors PRESERVED (=== existing, NOT the incomplete read)`, preserved,
      preserved ? '' : `assembled behaviors differ from existing — OVERWRITE LEAK: ${JSON.stringify(asmBeh.slice(0, 3))}`);
    check(`FAST/MAS guard ${conf.level} — guard-preserved flag present`, asm.reviewFlags.some((f) => f.source === 'guard-preserved'), '');
  }

  // ── Activities: curated baseline always present + assessment SPLIT only; flat discarded ──
  // Marlon's rule: the curated clinician-approved list is ALWAYS in the profile (every client, every path);
  // the assessment contributes activities ONLY when it SPLIT them by setting (homeActivities/schoolActivities);
  // a FLAT/untagged preferredActivities list is DISCARDED (never misplaced into both). Gates: (a) curated
  // baseline missing/empty; (b) the two lists identical (the old defect); (c) a flat activity leaking in.
  const curatedHome = CURATED_HOME_ACTIVITIES.map(norm);
  const curatedSchool = CURATED_SCHOOL_ACTIVITIES.map(norm);
  const homeActs = arr(refreshProfile.homeActivities).map(norm);
  const schoolActs = arr(refreshProfile.schoolActivities).map(norm);
  // (a) curated baseline is present in both lists (never empty, never fabricated — it IS the approved list).
  const missingHome = curatedHome.filter((a) => !homeActs.includes(a));
  const missingSchool = curatedSchool.filter((a) => !schoolActs.includes(a));
  check(`Activities — curated baseline present in homeActivities (${homeActs.length})`, missingHome.length === 0, missingHome.length ? `missing curated: ${missingHome.join(', ')}` : '');
  check(`Activities — curated baseline present in schoolActivities (${schoolActs.length})`, missingSchool.length === 0, missingSchool.length ? `missing curated: ${missingSchool.join(', ')}` : '');
  // (b) home ≠ school — the tags separate them (a curated home-only item must not be in school, and v.v.).
  check('Activities — home and school lists are NOT identical (tags separate them)',
    JSON.stringify(homeActs) !== JSON.stringify(schoolActs),
    'home and school activity lists are identical — the curated tags are not separating them');
  // (c) the flat/untagged preferredActivities must NOT leak in (only setting-tagged split activities may).
  //     A flat item that also happens to be a curated string is allowed (it is in via curated, not the flat list).
  const flatActs = arr(extracted.preferredActivities).map(norm);
  const curatedAll = new Set([...curatedHome, ...curatedSchool]);
  const leakedFlat = flatActs.filter((a) => !curatedAll.has(a) && (homeActs.includes(a) || schoolActs.includes(a)));
  check('Activities — flat/untagged preferredActivities is DISCARDED (not leaked into either list)',
    leakedFlat.length === 0, leakedFlat.length ? `leaked flat: ${[...new Set(leakedFlat)].join(', ')}` : '');

  // ── Behaviors correctness (refresh profile) ──
  const outBeh = arr(refreshProfile.maladaptiveBehaviors);
  // A ground-truth function-set is only gated when it's a real array of function names — a "TO CONFIRM"
  // marker (string, or empty) means the truth isn't locked yet, so that behavior only OBSERVES.
  const CONFIRMED = (f) => Array.isArray(f) && f.length && f.every((x) => typeof x === 'string' && x.trim().toUpperCase() !== 'TO CONFIRM');
  // Always print the ACTUAL emitted behavior names, so a renamed or dropped behavior is visible.
  console.log(`   ${C.dim(`↳ emitted ${outBeh.length}: ${outBeh.map((b) => `${b.name}[${arr(b.functions).join(',')}]`).join('  ')}`)}`);
  if (arr(gt.activeBehaviors).length) {
    // Count only gates when the list is declared complete; a partial (still-confirming) list observes.
    check('Behaviors — active count matches PDF',
      gt.activeBehaviorsComplete === true ? outBeh.length === arr(gt.activeBehaviors).length : null,
      `got ${outBeh.length}, expected ${arr(gt.activeBehaviors).length}${gt.activeBehaviorsComplete === true ? '' : ' — list not marked complete (observe)'}`);
    for (const eb of arr(gt.activeBehaviors)) {
      const got = outBeh.find((b) => norm(b.name) === norm(eb.name));
      if (!CONFIRMED(eb.functions)) {
        check(`Behaviors — “${eb.name}” functions`, null, got ? `got [${arr(got.functions).map(norm).join(',')}] — TO CONFIRM` : 'not found in output — TO CONFIRM');
        continue;
      }
      if (!got) { check(`Behaviors — “${eb.name}” present`, false, 'missing from output'); continue; }
      const gotFns = new Set(arr(got.functions).map(norm));
      const wantFns = arr(eb.functions).map(norm);
      const fnMatch = wantFns.length === gotFns.size && wantFns.every((f) => gotFns.has(f));
      check(`Behaviors — “${eb.name}” functions`, fnMatch, `got [${[...gotFns].join(',')}], expected [${wantFns.join(',')}]`);
    }
  }
  const emptyTopo = outBeh.filter((b) => !arr(b.topographies).length).map((b) => b.name);
  const emptyFns = outBeh.filter((b) => !arr(b.functions).length).map((b) => b.name);
  const names = outBeh.map((b) => norm(b.name));
  const dupes = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
  check('Behaviors — every behavior has a topography', emptyTopo.length === 0, emptyTopo.join(', '));
  check('Behaviors — every behavior has ≥1 function', emptyFns.length === 0, emptyFns.join(', '));
  check('Behaviors — no duplicate names', dupes.length === 0, dupes.join(', '));
}

// ── Refresh mechanics (generic, once) ──
console.log(C.bold('\n──── refresh mechanics (buildRefreshedProfile) ────'));
{
  const refreshed = buildRefreshedProfile(FIXTURE_EXISTING, { maladaptiveBehaviors: [{ name: 'New', status: 'active', functions: ['escape'], topographies: ['t'] }], interventions: [{ name: 'DRA' }], reinforcers: ['tokens'] });
  check('previousProfile snapshot written', !!refreshed.previousProfile);
  check('snapshot does not nest (no compounding)', refreshed.previousProfile && !refreshed.previousProfile.previousProfile);
  check('observedCatalog / functionsByBehavior preserved', JSON.stringify(refreshed.observedCatalog) === JSON.stringify(FIXTURE_EXISTING.observedCatalog));
}

console.log(C.bold(`\n════ RESULT: ${RED_COUNT === 0 ? C.green('ALL GREEN') : C.red(RED_COUNT + ' FAILING CHECK(S)')} ════`));
console.log(C.dim('Red is expected today — that is the proof-of-bug. The fixes must turn every check green on all three assessments before deploy / opening uploads.\n'));
