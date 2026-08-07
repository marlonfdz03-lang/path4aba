// scripts/exploreGeometry.mjs  (OFFLINE, NO LLM, NO production)
// Explore pdf2json positioning: cluster fragments into rows by y, sort cells by x, and print rows that
// look like table rows (contain a function keyword, an ICD code, a MASTERED marker, or a behavior-ish name)
// so we can SEE the table geometry before building the reconstructor. Run:
//   node scripts/exploreGeometry.mjs <pdf-path> [anchor-regex]
import PDFParser from 'pdf2json';
import { readFileSync } from 'node:fs';

const PDF = process.argv[2];
const ROW_TOL = 0.4; // fragments within this y-distance are the same row (Alexandra rows ~0.75 apart)

function positionedFragments(pdfData) {
  const out = [];
  (pdfData?.Pages || []).forEach((page, pi) => {
    (page?.Texts || []).forEach((t) => {
      const text = (t?.R || []).map((r) => { try { return decodeURIComponent(r?.T || ''); } catch { return r?.T || ''; } }).join('');
      if (text.trim()) out.push({ text: text.replace(/\s+/g, ' ').trim(), x: t.x, y: t.y, page: pi });
    });
  });
  return out;
}

// Cluster fragments on a page into rows (group by y within ROW_TOL), cells sorted by x.
function rowsForPage(frags) {
  const sorted = [...frags].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const f of sorted) {
    const row = rows.find((r) => Math.abs(r.y - f.y) < ROW_TOL);
    if (row) { row.cells.push(f); row.y = (row.y * row.cells.length + f.y) / (row.cells.length + 1); }
    else rows.push({ y: f.y, cells: [f] });
  }
  return rows.map((r) => ({ y: r.y, cells: r.cells.sort((a, b) => a.x - b.x) }));
}

const FUNC = /\b(escape|attention|tangible|automatic|sensory)\b/i;
const ICD = /\b[A-Za-z]\d{2}(?:\.\d+)?\b/;
const MASTERED = /\bmastered\b/i;

function main() {
  const p = new PDFParser();
  p.on('pdfParser_dataError', () => process.exit(1));
  p.on('pdfParser_dataReady', (d) => {
    const frags = positionedFragments(d);
    const byPage = {};
    for (const f of frags) (byPage[f.page] ||= []).push(f);
    for (const [pi, pf] of Object.entries(byPage)) {
      const rows = rowsForPage(pf);
      const interesting = rows.filter((r) => {
        const line = r.cells.map((c) => c.text).join(' ');
        return FUNC.test(line) || ICD.test(line) || MASTERED.test(line);
      });
      if (!interesting.length) continue;
      console.log(`\n───── PAGE ${pi} (${interesting.length} candidate table rows) ─────`);
      for (const r of interesting.slice(0, 40)) {
        const cols = r.cells.map((c) => `[x=${c.x.toFixed(1)}] ${c.text}`).join('   ');
        console.log(`y=${r.y.toFixed(2).padStart(6)}  ${cols}`);
      }
    }
  });
  p.parseBuffer(readFileSync(PDF));
}
main();
