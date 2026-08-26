// ─────────────────────────────────────────────────────────────────────────────
// 97153 UNIVERSAL RED-FLAG PHRASES — the Medicaid documentation red flags any auditor
// looks for in a CPT 97153 (adaptive behavior treatment) session note. These are NOT
// one agency's preference; they are the payer standard applied to EVERY client and
// agency. A compliant note contains NONE of them.
//
// Four failure classes (from the 97153 standard):
//   1. VAGUE / SUBJECTIVE — "session was good", "did better", "great progress". Not
//      observable; nothing a reviewer can verify.
//   2. MENTALISTIC — attributes an internal state instead of observable behavior:
//      "because he didn't want to work", "he was frustrated", "the client wanted".
//   3. GENERIC INTERVENTION — names no procedure and no contingency: "used strategies",
//      "ran programs", "reinforced him" (without what, and after what).
//   4. FILLER — content-free closers: "no concerns were noted", "next session will
//      continue the same goals".
//
// THE RULE (same discipline as functionPatterns.ts — match the ASSERTION, not a bare
// clinical noun): every pattern here must match the RED-FLAG PHRASE, never an ordinary
// clinical noun that also shows up in compliant prose. The failure to avoid:
//   "concerns"  must NOT flag "safety concerns were noted and addressed" — only the
//               FILLER "no concerns were noted".
//   "reinforced" must NOT flag "reinforced appropriate requesting with praise" — only
//                the generic "reinforced him" with no contingency.
//   "used"      must NOT flag "used the picture exchange cards" — only "used strategies".
//   "improved"  must NOT flag "improved with support" (allowed 97153 progress language).
//
// The regression test (redFlagPhrases.test.mjs) locks this in: an INNOCENT battery of
// compliant clinical prose must stay unmatched by ALL patterns, and a POSITIVE battery
// of the standard's red-flag phrases must each match. Any pattern change that flags
// innocent prose — or stops catching a known red flag — fails there.
// ─────────────────────────────────────────────────────────────────────────────

export type RedFlagCategory = 'vague' | 'mentalistic' | 'generic-intervention' | 'filler'

export interface RedFlagPattern {
  re: RegExp
  category: RedFlagCategory
  // Short human-readable reason shown to the RBT alongside the offending phrase.
  reason: string
}

export const RED_FLAG_PATTERNS: RedFlagPattern[] = [
  // ── 1. VAGUE / SUBJECTIVE ──────────────────────────────────────────────────
  // "session was good/great/successful/productive", "good/great session".
  { re: /\bsession was (?:good|great|successful|productive|fine|okay|ok)\b/i, category: 'vague', reason: 'vague/subjective — state observable behavior instead' },
  { re: /\b(?:good|great|excellent|productive|nice|amazing|awesome) session\b/i, category: 'vague', reason: 'vague/subjective — state observable behavior instead' },
  // "did well/better/great/good", "doing better" — a subjective judgment, not behavior.
  { re: /\b(?:did|was doing|is doing|doing) (?:well|better|great|good|fine|awesome)\b/i, category: 'vague', reason: 'vague/subjective — describe what the client physically did' },
  // "great/good progress" — progress must be tied to observable performance + continued need.
  { re: /\b(?:great|good|excellent|nice|solid|lots of) progress\b/i, category: 'vague', reason: 'vague/subjective — describe the observable skill performance' },
  // Generic value judgments of the client / the work.
  { re: /\bclient (?:was )?(?:cooperative|compliant|well[- ]behaved|on point)\b/i, category: 'vague', reason: 'subjective evaluation — describe the observable behavior' },

  // ── 2. MENTALISTIC (internal state attributed instead of observable behavior) ─
  // "was/were/seemed/appeared/felt/got/became/looked <state>".
  { re: /\b(?:was|were|seemed|appeared|felt|got|became|looked|acted) (?:frustrated|upset|angry|mad|sad|happy|bored|anxious|nervous|excited|annoyed|distressed|overwhelmed|scared|afraid)\b/i, category: 'mentalistic', reason: 'mentalistic — describe the observable topography, not an inferred state' },
  // CALM / REGULATION family — the same class, previously missing ("calm" reached the EHR and was rejected).
  // A per-verb guard ("was/remained/stayed calm") so an authorized program NAME ("Calm-Down Routine") — which
  // has no preceding state verb — is not flagged.
  { re: /\b(?:was|were|seemed|appeared|felt|got|became|looked|acted|remained|stayed|kept|being|is|are) (?:calm|relaxed|settled|regulated|dysregulated|in control|out of control|content|at ease|composed|soothed|uncomfortable)\b/i, category: 'mentalistic', reason: 'mentalistic internal state — describe the observable behavior (e.g. stopped crying and resumed the activity)' },
  // "calmed (down)", "settled down/himself" (NOT bare "settled", which can be observable — "settled into her
  // seat"), "escalated emotionally", "self-regulated", "de-escalated".
  { re: /\bcalmed(?:\s+down)?\b|\bsettled\s+(?:down|himself|herself|themselves)\b|\bde[- ]escalated\b|\bsoothed\b/i, category: 'mentalistic', reason: 'mentalistic — state what the client observably did (e.g. stopped crying, resumed the task)' },
  { re: /\b(?:escalated emotionally|self[- ]regulated|emotional(?:ly)? (?:regulation|dysregulation))\b/i, category: 'mentalistic', reason: 'mentalistic — describe the observable behavior, not an internal-state summary' },
  // INTENT / DESIRE / INTERNAL MOTIVATION — attributes a want/interest/decision instead of an observable act.
  // ("preferred item" is a PLAN term and is NOT matched — only "preferred to <verb>" as an internal preference.)
  { re: /\b(?:the client|he|she|they) (?:attempted to|was interested in|were interested in|was motivated by|were motivated by|chose to|decided to|appeared to|seemed to|wanted to|wanted|tried to|preferred to)\b/i, category: 'mentalistic', reason: 'mentalistic intent — describe the observable action (e.g. "reached for the (tablet)"), not the inferred desire' },
  // "didn't want to …", "did not want to …". Apostrophe class covers straight ' and curly ’.
  { re: /\b(?:did ?n['’]?t|does ?n['’]?t|do(?:es)? not|did not|would ?n['’]?t|will not) want to\b/i, category: 'mentalistic', reason: 'mentalistic — describe what the client did, not what they wanted' },
  // Causal attribution to an internal state: "because he didn't want to / was / felt / wanted".
  { re: /\bbecause (?:he|she|they|the client) (?:was|were|felt|wanted|did ?n['’]?t|did not|does ?n['’]?t)\b/i, category: 'mentalistic', reason: 'mentalistic causal claim — an RBT documents observable events, not internal motives' },
  // "the client / he / she / they wanted / enjoyed / liked / loved / hated / disliked".
  { re: /\b(?:the client|he|she|they) (?:wanted|enjoyed|liked|loved|hated|disliked|preferred to|tried to|refused because)\b/i, category: 'mentalistic', reason: 'mentalistic — describe the observable action instead' },

  // ── 3. GENERIC INTERVENTION (no procedure, no contingency) ───────────────────
  // "used (various/several/…) strategies" — names no procedure.
  { re: /\b(?:used|use|using|implemented|applied|provided|did) (?:a variety of |a number of |various |several |different |multiple |some |a few |behavioral |coping )?strategies\b/i, category: 'generic-intervention', reason: 'generic — name the specific intervention and how it was implemented' },
  // "ran (the) programs" — no program named, no method.
  { re: /\bran (?:through )?(?:the |his |her |their )?programs?\b/i, category: 'generic-intervention', reason: 'generic — name the program run and how it was addressed' },
  // "reinforced him/her/them/the client" with NO stated behavior or contingency after it.
  { re: /\breinforced (?:him|her|them|the client)\b(?!\s+(?:for|with|by|when|after|following|contingent|immediately|each time|every time|upon|on|using))/i, category: 'generic-intervention', reason: 'generic — state what was reinforced and after what response' },
  // Bare "with prompting" / "with help" — no prompt type. NOT "with support", which is allowed 97153
  // progress language ("improved with support"); this pattern deliberately excludes it.
  { re: /\bwith (?:prompting|help)\b(?!\s*(?:from|,))/i, category: 'generic-intervention', reason: 'generic — specify the prompt type (verbal/gestural/partial physical)' },

  // ── 4. FILLER (content-free) ─────────────────────────────────────────────────
  // "no concerns (were) noted/reported/observed" — must NOT catch "safety concerns were noted".
  { re: /\bno (?:further |additional |other |new )?concerns? (?:were |was )?(?:noted|reported|observed|present|identified|raised)?\b/i, category: 'filler', reason: 'filler — state the actual clinical observations for this session' },
  { re: /\bnothing (?:notable|of note|to report|significant|else)\b/i, category: 'filler', reason: 'filler — state the actual clinical observations for this session' },
  // "(next session) will continue the same goals/programs/targets/plan".
  { re: /\b(?:will |we will |going to |plan(?:ning)? to )?continue (?:with )?the same (?:goals?|programs?|targets?|activities|plan|objectives?)\b/i, category: 'filler', reason: 'filler + future planning — remove; an RBT note documents this session, not the next' },
  { re: /\bnext session will (?:continue|be the same|focus on the same)\b/i, category: 'filler', reason: 'filler + future planning — remove; an RBT note documents this session only' },
]

export interface RedFlagHit {
  phrase: string      // the exact offending text as it appeared
  category: RedFlagCategory
  reason: string
}

// Scan a generated note for universal 97153 red-flag phrases. Returns one hit per distinct
// (phrase, category); order follows first appearance in the text. Empty when the note is clean.
export function findRedFlagPhrases(note: string): RedFlagHit[] {
  const text = String(note || '')
  if (!text.trim()) return []
  const hits: RedFlagHit[] = []
  const seen = new Set<string>()
  for (const { re, category, reason } of RED_FLAG_PATTERNS) {
    const m = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
    let match: RegExpExecArray | null
    while ((match = m.exec(text)) !== null) {
      const phrase = match[0].trim().replace(/\s+/g, ' ')
      const key = `${category}::${phrase.toLowerCase()}`
      if (!seen.has(key)) {
        seen.add(key)
        hits.push({ phrase, category, reason })
      }
      if (match.index === m.lastIndex) m.lastIndex++ // guard against zero-width matches
    }
  }
  return hits
}

// Human-readable flags for the note UI — same shape as the coherence flags (a list of strings
// the RBT reviews before signing). We SURFACE, never auto-delete: a red-flag phrase marks prose
// the RBT should rewrite with observable detail, not content to silently strip.
export function findRedFlagFlags(note: string): string[] {
  return findRedFlagPhrases(note).map(
    (h) => `97153 red-flag phrase "${h.phrase}" (${h.reason}) — rewrite with observable detail before using.`,
  )
}
