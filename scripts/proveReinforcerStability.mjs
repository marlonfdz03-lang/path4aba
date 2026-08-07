// scripts/proveReinforcerStability.mjs
//
// Proves the reinforcer-extraction fix: the SAME PDF now extracts the SAME complete reinforcer set across
// runs (the 19-vs-13 swing is gone), the parsing stays clean (no shred fragments), and nothing is invented.
//
// Runs REAL extraction against a real PDF N times and checks:
//   • STABILITY  — every run produces the identical reinforcer set (the core fix: exhaustive block + seed)
//   • CLEAN      — no shred fragments ("such as ...", leading and/or, orphan quotes) — the parsing fix holds
//   • COMPLETE   — prints the full set so you can confirm it captured everything the assessment names
//   • FIREWALL   — prints the set so you can confirm nothing was invented (only what the PDF names)
//
// RUN (needs Azure creds from .env.local; makes N real extraction calls):
//   node --env-file=.env.local scripts/proveReinforcerStability.mjs [pdfPath] [runs]
// Defaults: Brandon's July PDF, 3 runs.

import { readFileSync } from 'node:fs';
import PDFParser from 'pdf2json';
import { extractAssessment } from '../lib/extractAssessment.ts';
import { parseReinforcers } from '../lib/reinforcers.ts';

const PDF = process.argv[2] || 'assessments-local/2026-Brandon-Julio-signed-17858694243391.pdf';
const RUNS = Number(process.argv[3] || 3);

const C = { g: (s) => `\x1b[32m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m` };

function parsePdf(buffer) {
  return new Promise((resolve, reject) => {
    const p = new PDFParser();
    p.on('pdfParser_dataError', (e) => reject(e?.parserError || e));
    p.on('pdfParser_dataReady', (d) => {
      const text = (d?.Pages || [])
        .map((pg) => (pg?.Texts || []).map((t) => (t?.R || []).map((r) => { try { return decodeURIComponent(r?.T || ''); } catch { return r?.T || ''; } }).join(' ')).join(' '))
        .join('\n');
      resolve(text);
    });
    p.parseBuffer(buffer);
  });
}

// Shred flags — the same failure signatures the parsing fix eliminated.
function shredFlags(s) {
  const f = [], t = String(s).trim();
  if (/^(such as|e\.g\.?|including|like)\b/i.test(t)) f.push('lead-connector');
  if (/^(and|or|,|;)\b/i.test(t)) f.push('lead-conjunction');
  if (/^["']|["']$/.test(t)) f.push('orphan-quote');
  if (/\bsuch as\b/i.test(t)) f.push('contains-such-as');
  if (t.length < 2) f.push('too-short');
  return f;
}

const norm = (s) => String(s).toLowerCase().trim();
const sortedSet = (arr) => [...new Set(arr.map(norm))].sort();

async function main() {
  console.log(`\nReinforcer stability — ${PDF.split('/').pop()} × ${RUNS} runs\n`);
  const text = await parsePdf(readFileSync(PDF));

  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const extracted = await extractAssessment(text.slice(0, 90000));
    const items = parseReinforcers(extracted.reinforcers);
    runs.push(items);
    console.log(`run ${i + 1}: ${items.length} reinforcers`);
  }

  // STABILITY — every run's set identical to run 1's.
  const base = sortedSet(runs[0]);
  let stable = true;
  for (let i = 1; i < runs.length; i++) {
    const s = sortedSet(runs[i]);
    const missing = base.filter((x) => !s.includes(x));
    const extra = s.filter((x) => !base.includes(x));
    if (missing.length || extra.length) {
      stable = false;
      console.log(C.r(`  ✗ run ${i + 1} differs — missing: [${missing.join(', ')}]  extra: [${extra.join(', ')}]`));
    }
  }
  console.log(stable ? C.g(`\n✓ STABLE — all ${RUNS} runs produced the identical ${base.length}-item set`) : C.r(`\n✗ UNSTABLE — runs disagree (the 19-vs-13 class of defect)`));

  // CLEAN — no shred fragments in any run.
  const allShred = runs.flatMap((items, i) => items.map((it) => ({ run: i + 1, it, flags: shredFlags(it) })).filter((x) => x.flags.length));
  console.log(allShred.length ? C.r(`✗ CLEAN — ${allShred.length} shred fragment(s): ${allShred.slice(0, 5).map((x) => JSON.stringify(x.it)).join(', ')}`) : C.g(`✓ CLEAN — no shred fragments in any run (parsing fix holds)`));

  // COMPLETE / FIREWALL — print the set so completeness + no-invention can be confirmed by eye.
  console.log(C.dim(`\n  the ${base.length}-item set (confirm it captures everything named, invents nothing):`));
  console.log(C.dim(`  ${runs[0].join(' · ')}`));

  process.exit(stable && !allShred.length ? 0 : 1);
}

main().catch((e) => { console.error('stability check failed:', e.message); process.exit(1); });
