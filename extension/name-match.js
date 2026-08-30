// Path4ABA — shared name matching, hand-ported for the extension.
//
// The extension has no module system and no build step, so it cannot import lib/nameMatch.impl.js.
// Everything between the parity fences below is a VERBATIM copy of that file's fenced body, and
// lib/nameMatchParity.test.mjs extracts it and runs the canonical module's vectors against it —
// so the port cannot drift. Edit lib/nameMatch.impl.js, then re-copy; never edit only this file.
//
// Loaded three ways:
//   • popup.html, before popup.js and data-tab-logic.js (the popup's own matching)
//   • chrome.scripting.executeScript({ files: ['name-match.js'] }) into the Office Puzzle page,
//     so the INJECTED autofiller can reach it — an injected `func:` carries only its own body,
//     which is exactly why the two h4 matchers used to be inline copies.
(function () {
  'use strict';

// __PARITY_START__
// Everything between the parity fences is hand-ported into extension/name-match.js,
// which has no module system and no build step. lib/nameMatchParity.test.mjs extracts
// that port and runs this file's vectors against it, so the two cannot drift.

// The one normalizer. Lowercase, every non-alphanumeric to a space, collapse runs.
// "Self-Injurious Behavior (SIB)" -> "self injurious behavior sib"
function normName(s) {
  return String(s == null ? '' : s)
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Office Puzzle wraps a program name in quotes in its h4 headings. Strip them before
// normalizing so the quoting style never participates in the comparison.
function stripOuterQuotes(s) {
  return String(s == null ? '' : s).trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
}

// Words that carry meaning for a shared-word comparison: longer than 2 characters, so
// "to", "of", "in" never contribute to a match.
function matchWords(normalized) {
  return normalized.split(' ').filter(function (w) { return w.length > 2; });
}

// PARENTHESIZED ACRONYMS. "Self-Injurious Behavior (SIB)" -> ["sib"]. Requires the
// parentheses and 2-8 upper-case characters: a bare "SIB" in prose is not a key, and a
// single letter ("(A)") is too weak to decide anything. This is the layer that was
// missing — normName strips the parentheses, so the one token that decisively
// identifies the program was being discarded before the comparison ran.
function acronymsOf(s) {
  const out = [];
  const re = /\(([A-Z][A-Z0-9]{1,7})\)/g;
  let m;
  while ((m = re.exec(String(s == null ? '' : s))) !== null) out.push(m[1].toLowerCase());
  return out;
}

// A parenthesized acronym present in BOTH names is decisive — PROVIDED the two names
// also share at least one significant word.
//
// The extra condition is not decoration. Acronyms get reused across unrelated programs:
// "Task Refusal (TR)" and "Toileting Routine (TR)" share TR and nothing else, and
// treating the acronym alone as decisive would merge them at every tier, including the
// apply path. Requiring one shared word keeps the acronym decisive where it identifies
// the same program — "Self-Injurious Behavior (SIB)" / "Self-Injury Behaviors (SIB)"
// share `self`; "Functional Communication Training (FCT)" / "Functional Communication
// (FCT)" share both words — while rejecting a coincidental initialism.
//
// POSITIVE ONLY — a differing acronym is NOT a decisive non-match, it simply falls
// through to the ordinary tiers. That asymmetry is deliberate: making a mismatch
// decisive would turn pairs that match today into non-matches, and this layer is meant
// to be purely additive.
function sharedAcronym(a, b) {
  const aa = acronymsOf(a);
  if (aa.length === 0) return null;
  const bb = acronymsOf(b);
  let hit = null;
  for (let i = 0; i < aa.length && hit === null; i++) {
    if (bb.indexOf(aa[i]) !== -1) hit = aa[i];
  }
  if (hit === null) return null;
  // Corroboration: at least one significant word in common, the acronym itself aside.
  const wa = matchWords(normName(a)).filter(function (w) { return w !== hit; });
  const wb = matchWords(normName(b)).filter(function (w) { return w !== hit; });
  for (let j = 0; j < wa.length; j++) {
    if (wb.indexOf(wa[j]) !== -1) return hit;
  }
  return null;
}

// TIERS. Named, and never re-derived at a call site.
//
//   strict  — normalized equality or bidirectional substring. NO shared-word tier.
//             For the APPLY path (writing into a datasheet cell): a wrong match here
//             puts a frequency on the wrong clinical target.
//   shared2 — strict, plus at least TWO shared words longer than 2 characters.
//             For CONSOLIDATION (folding an incoming name onto an existing series):
//             a wrong match merges two data series, which is recoverable but wrong.
//   loose   — strict, plus at least ONE shared word longer than 2 characters.
//             The widest tier. "Defiant Behavior" and "Disruptive Behavior" match here
//             on the word "behavior" alone; that is why it must never reach the apply
//             path. Retained because the preview and the Data tab's record grouping
//             already depend on it.
const TIERS = ['strict', 'shared2', 'loose'];

function namesMatch(a, b, tier, options) {
  const opts = options || {};
  const rawA = stripOuterQuotes(a);
  const rawB = stripOuterQuotes(b);

  // Layer 1: a shared parenthesized acronym decides it, at every tier.
  if (sharedAcronym(rawA, rawB)) return true;

  // Layer 2: a shared canonical entry from the clinical library decides it, at every
  // tier. `variantIndex` maps a NORMALIZED name or variant to its canonical key; build
  // it with buildVariantIndex() from clinical_library rows. Positive only, same as the
  // acronym layer. Absent index -> this layer is simply skipped.
  const na = normName(rawA);
  const nb = normName(rawB);
  if (opts.variantIndex) {
    const ca = opts.variantIndex[na];
    const cb = opts.variantIndex[nb];
    if (ca && cb && ca === cb) return true;
  }

  if (!na || !nb) return false;

  // Layer 3: the tier itself.
  if (na === nb) return true;
  if (na.indexOf(nb) !== -1 || nb.indexOf(na) !== -1) return true;
  if (tier === 'strict') return false;

  const wa = matchWords(na);
  const wb = matchWords(nb);
  const seen = {};
  for (let i = 0; i < wb.length; i++) seen[wb[i]] = true;
  let shared = 0;
  const counted = {};
  for (let j = 0; j < wa.length; j++) {
    if (seen[wa[j]] && !counted[wa[j]]) { counted[wa[j]] = true; shared++; }
  }
  if (tier === 'shared2') return shared >= 2;
  return shared >= 1; // loose
}

// Fold an incoming name onto an already-stored one so a series consolidates instead of
// splitting. Returns the EXISTING name on a match, the incoming name otherwise.
function canonicalName(incoming, existingNames, tier, options) {
  if (!incoming) return incoming;
  if (!normName(incoming)) return incoming;
  const names = existingNames || [];
  for (let i = 0; i < names.length; i++) {
    if (!normName(names[i])) continue;
    if (namesMatch(incoming, names[i], tier, options)) return names[i];
  }
  return incoming;
}

// Resolve a name against a pool, reporting whether it matched. The longer of the two is
// kept as the display name, which is the existing behavior of the chart resolver: the
// fuller name is assumed to be the more complete one.
function resolveName(name, pool, tier, options) {
  const candidates = pool || [];
  for (let i = 0; i < candidates.length; i++) {
    if (namesMatch(name, candidates[i], tier, options)) {
      const winner = String(candidates[i]).length >= String(name).length ? candidates[i] : name;
      return { resolvedName: winner, matched: true };
    }
  }
  return { resolvedName: name, matched: false };
}

// Resolve a WANTED name against a pool of dropdown OPTION texts for the APPLY path, refusing to
// guess when two genuinely-different options both match — filling the wrong row is worse than blank.
// Returns { status: 'matched', value } | { status: 'ambiguous', candidates } | { status: 'none' }.
//   1. a normalized-EXACT option wins outright (so "Tantrum 2" beats the "Tantrum" substring);
//   2. else a LONE strict match wins ("Off-task behavior" -> the only "Off Task");
//   3. else REFUSE — two strict matches, no unique exact -> caller blanks + flags AMBIGUOUS_MATCH.
function resolveOption(wanted, optionTexts, options) {
  const opts = Array.isArray(optionTexts) ? optionTexts : [];
  const w = normName(stripOuterQuotes(wanted));
  if (!w) return { status: 'none', candidates: [] };
  const matches = opts.filter(function (o) { return namesMatch(wanted, o, 'strict', options); });
  if (matches.length === 0) return { status: 'none', candidates: [] };
  const exacts = matches.filter(function (o) { return normName(stripOuterQuotes(o)) === w; });
  if (exacts.length === 1) return { status: 'matched', value: exacts[0], candidates: matches };
  if (exacts.length === 0 && matches.length === 1) return { status: 'matched', value: matches[0], candidates: matches };
  return { status: 'ambiguous', candidates: matches };
}

// Build the variant lookup from clinical_library rows: [{ display_name, variants[] }].
// That column (schema.prisma clinical_library.variants) has existed since the library
// migration and was read by nothing — this is the layer it was added for.
function buildVariantIndex(rows) {
  const index = {};
  const list = rows || [];
  for (let i = 0; i < list.length; i++) {
    const row = list[i] || {};
    const key = normName(row.canonical_key || row.canonicalKey || row.display_name || row.displayName || '');
    if (!key) continue;
    const names = [row.display_name || row.displayName || ''].concat(row.variants || []);
    for (let j = 0; j < names.length; j++) {
      const n = normName(names[j]);
      if (n) index[n] = key;
    }
  }
  return index;
}
// __PARITY_END__

  // One namespace, on both `window` (the injected MAIN-world case) and the popup's global scope.
  var API = {
    normName: normName,
    stripOuterQuotes: stripOuterQuotes,
    matchWords: matchWords,
    acronymsOf: acronymsOf,
    sharedAcronym: sharedAcronym,
    TIERS: TIERS,
    namesMatch: namesMatch,
    canonicalName: canonicalName,
    resolveName: resolveName,
    resolveOption: resolveOption,
    buildVariantIndex: buildVariantIndex,
  };
  if (typeof window !== 'undefined') window.P4NameMatch = API;
})();
