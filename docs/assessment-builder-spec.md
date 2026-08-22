# Assessment Builder — Design Spec (3a)

**Status:** DRAFT for Marlon's review. Document only — nothing here is built or run. The SQL below is for
Marlon to run **manually with psql when approved** (never `prisma db push`). The one piece built tonight is
the **Overview Dashboard (3b)** — see `lib/assessmentStatus.ts` + `/assessment/[clientId]`.

---

## 1. What the Builder is

The BCBA writes a client's assessment **inside Path4ABA**, section by section. A reassessment starts from the
previous assessment. Path assists: flags contradictions (e.g. a stray "Matthew" in Brandon's assessment),
suggests vocabulary, surfaces weaknesses, and autocompletes from the Clinical Library ("+" → pick *Tantrum* →
typical topographies / functions / interventions load for the BCBA to **review and accept**). On completion,
the assessment becomes the client's `clinical_profile` — the same shape note generation already consumes.

**Design principle:** the Builder's output must be a **superset** of today's `clinical_profile`. Note
generation, the gates, preselection, and the Clinical Library keep working unchanged; the Builder just becomes
a better *source* than the PDF extractor.

---

## 2. Section structure

Grounded in the Part-2 inventory (§7): the extractor schema, the real stored profiles (9 clients), and what
note generation actually consumes. **Required** = note generation or a gate depends on it; **Optional** =
captured/useful but nothing breaks without it. Order follows how a BCBA reasons through an assessment.

| # | Section | Fields (R = required, O = optional) | Grounding |
|---|---|---|---|
| 1 | **Client & Diagnosis** | name **R**; diagnosis[] **R**; gender/pronouns **R** (note needs pronouns — missing in 4/9 today); caregivers[] **R**; age **O**; setting **O** | note pronouns (`masterPrompt:497`), diagnosis consumed |
| 2 | **Maladaptive Behaviors** | per behavior: name **R**, topographies[] **R**, functions[] **R** (+ provenance, see Audit A), status **R**; baselineFrequency/intensity/measurableUnit **O** (extractor captures, storage currently drops) | 92/92 complete today; the core of every note |
| 3 | **Mastered / Historical Behaviors** | masteredBehaviors[] **O** | 0/9 populated today — thin; not note-consumed |
| 4 | **Replacement Skills** | per skill: name **R**, targetFunction **R**, status **R**; currentAccuracy **O**; teaching procedure **O** (GAP — never captured; note omits method clauses without it) | 107/107 have targetFunction |
| 5 | **Approved & Prohibited Interventions** | approvedInterventions[] **R** (≥1); prohibitedInterventions[] **O** (safe defaults exist) | note's intervention set + gate |
| 6 | **Reinforcers** | ≥1 non-edible **R**; buckets people/tangibles/activities/social **O** structure | note names reinforcers; edibles filtered |
| 7 | **Activities by Setting** | homeActivities[] / schoolActivities[] **R for note quality** | **BIGGEST GAP** — stored lists are a curated baseline, not assessment-real (school list byte-identical across all 9) |
| 8 | **Parent-Training Goals** | parentTrainingGoals[] **O** | 3–7 per client; not note-consumed |
| 9 | **Medications / Clinical Events** | medications[] **O** | extractor captures, storage drops |

**Provenance requirement (from Audit A), applies to §2 functions:** the Builder must record, per function,
whether it was **entered by the BCBA from the assessment** vs **suggested/inferred** (Library or LLM) — so the
note can honestly say "documented" only for the former. This is the going-forward capture that existing data
can never get.

---

## 3. Data model — where a draft lives, how it becomes a profile

### Why a separate draft table (not editing `clinical_profile` directly)
- An in-progress assessment is **incomplete and inconsistent by nature** — half-filled sections, a behavior
  with no function yet. `clinical_profile` is **live**: note generation reads it. Editing it in place would
  feed half-written assessments into real notes. The draft must be isolated until the BCBA **completes** it.
- We also need **draft autosave**, **reassessment-from-previous**, and an **audit trail** (who wrote what,
  when) — none of which the single live `clinical_profile` JSON supports.

### Proposed table (SQL for Marlon to run later — DO NOT run now)

```sql
-- Assessment Builder drafts. One row per assessment attempt (initial or reassessment). The completed draft is
-- copied into clients.clinical_profile; the draft is retained as the versioned record + the base for the next
-- reassessment. RUN MANUALLY WITH psql. Never `prisma db push`.
CREATE TABLE assessment_drafts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'draft',          -- 'draft' | 'completed' | 'superseded'
  data           JSONB NOT NULL DEFAULT '{}'::jsonb,     -- the section content (same shape family as clinical_profile)
  based_on_id    UUID REFERENCES assessment_drafts(id),  -- the prior assessment a reassessment started from
  created_by     TEXT,                                   -- user id/email who started it
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at   TIMESTAMPTZ,
  completed_by   TEXT
);
CREATE INDEX assessment_drafts_client_idx ON assessment_drafts (client_id, status);
CREATE INDEX assessment_drafts_updated_idx ON assessment_drafts (updated_at);
```

`prisma/schema.prisma` would add the matching `model assessment_drafts` (so `prisma generate` produces the
delegate) — added at build time, not now.

### Lifecycle
1. **Start** — create a `draft` row for the client (optionally `based_on_id` = the last completed draft).
2. **Autosave** — PATCH the `data` JSONB as the BCBA edits (section by section). The Overview dashboard reads
   this draft (not `clinical_profile`) once the Builder is live.
3. **Complete** — validate with the deterministic status engine (`computeAssessmentStatus`); on GREEN/accepted,
   copy `data` → `clients.clinical_profile` (the existing write path), stamp `completed_at/by`, set
   `status='completed'`, and mark any prior draft `superseded`.
4. **Reassessment** — "Start reassessment" clones the last `completed` draft's `data` into a new `draft` row
   with `based_on_id` pointing at it. The BCBA edits from a pre-filled starting point instead of a blank page.

### Migration-free interim (what the built 3b does today)
Until the table exists, the Overview reads the **current `clinical_profile`** directly (already built). When
`assessment_drafts` lands, the Overview API swaps its source from `clients.clinical_profile` to the draft's
`data` — **the status logic (`lib/assessmentStatus.ts`) does not change**, because the draft `data` shares the
`clinical_profile` shape family.

---

## 4. Clinical Library integration (the "+" autocomplete)

The Library (`clinical_library`) already stores, per canonical entry: `kind`
(behavior/skill/procedure/reinforcer/activity), `display_name`, accumulated `variants[]` (topographies), and
`functions[]`. That is exactly the autocomplete payload.

- **"+" → pick *Tantrum*** → the Builder loads that Library row's `variants` (typical topographies) and
  `functions`, plus (future) any curated intervention associations, as **suggestions the BCBA reviews and
  edits** — never auto-committed.
- **Matching** the typed behavior to a Library entry uses the shipped `canonicalKey` (the Library's own dedup
  key), so "Tantrums"/"Tantrum Behavior" resolve to the one entry.
- **When the Library has nothing** for that behavior: the "+" simply offers a blank structured row (name +
  empty function/topography fields) — the BCBA fills it, and on completion the ingest already teaches the
  Library the new entry (the existing `saveClinicalLibrary` accumulation), so the corpus grows. No error, no
  block — an empty Library is the day-1 state and must degrade gracefully.

---

## 5. Assist features — MECHANICAL (safe) vs LLM (needs Marlon's firewall)

| Assist | Mechanical / LLM | Notes |
|---|---|---|
| Section completeness / traffic-light status | **Mechanical** | Built (3b). Deterministic field/consistency checks. |
| Required-field prompts ("this behavior has no function") | **Mechanical** | Field presence. |
| Cross-field consistency (skill targets a function no behavior has; no intervention fits a function) | **Mechanical** | Built (3b), reuses generator helpers. |
| Library autocomplete ("+") | **Mechanical** | Deterministic lookup by `canonicalKey`; BCBA reviews. |
| All-edible reinforcer / edible flagging | **Mechanical** | Reuses `looksEdible`. |
| Duplicate / near-duplicate entry detection | **Mechanical** | Reuses `tokenSubsetMatch` (the Library merge-suggestion logic). |
| **Stray-name / cross-client contradiction** ("Matthew in Brandon's") | **Mixed** | A deterministic own-name-excluding heuristic ships in 3b as an **advisory**. Reliable detection (entity recognition across all clients' names) is **LLM/NLP** → firewall review. |
| **Vocabulary suggestions** (better operational-definition wording) | **LLM** | Generative → firewall review. Must be suggestion-only, BCBA accepts. |
| **"Find weaknesses" / clinical adequacy** (is this topography measurable? is the function correct?) | **LLM** | Clinical judgment → firewall review. Never auto-applied. |
| **Function inference** from a behavior description | **LLM** | This is exactly the provenance problem (Audit A) — if the Builder infers a function it must record `source: inferred`, never present it as documented. |

**Firewall rule (standing):** any LLM assist proposes; the BCBA disposes. No LLM output is stored as clinical
truth without human acceptance, and anything LLM-inferred carries its provenance (ties to the Audit-A
provenance model).

---

## 6. Staged build plan (smallest first)

1. **Overview dashboard (DONE, 3b)** — read-only, deterministic status over the current `clinical_profile`.
   Zero clinical risk; immediately useful.
2. **`assessment_drafts` table + draft CRUD** — create/load/autosave a draft; Overview reads the draft. No
   note-generation impact (drafts are isolated).
3. **Section editors** — structured forms per §2 section, writing the draft JSONB. Required-field validation
   reuses 3b.
4. **Library "+" autocomplete** — deterministic lookup; graceful empty-Library fallback.
5. **Complete → clinical_profile** — the copy-on-complete path + reassessment-from-previous.
6. **Mechanical assists** — dedup detection, stray-name advisory (already in 3b), cross-field prompts inline.
7. **LLM assists (each its own firewall-reviewed commit)** — vocabulary suggestions, weakness-finding,
   function inference with provenance. Last, and gated.

Each stage is independently shippable and reviewable. Nothing after stage 1 touches note generation until
stage 5, which is a deliberate, reviewed cutover.

---

## 7. Real-assessment section inventory (Part 2)

Analyzed: the extractor schema (`lib/extractAssessment.ts`), all **9** stored `clinical_profile`s, and what
`buildServerSessionInput`/`generateSmartNote` consume. (Only 9 clients exist; only 4 source PDFs, for 3
clients — 6 of 9 profiles have no retained source document.)

### Consistently present & rich (safe to build on)
- **maladaptiveBehaviors** — 92/92 have name + topographies + functions + status. The core.
- **replacementBehaviors** — 107/107 have targetFunction + status.
- **interventions** — 5–33 per client (name + status).
- **reinforcers** — 7–29 items (stored FLAT, buckets already merged; includes edibles + occasional people leak).
- **diagnosis, caregivers, parentTrainingGoals** — populated in all 9.

### Usually missing or thin
- **masteredBehaviors** — 0/9 non-empty (4 absent, 5 empty). Essentially never captured.
- **skillAcquisition** (mastered skills) — non-empty in only 3/9; and note generation deliberately excludes it.
- **gender/pronouns** — only 5/9 (note falls back to "the client" for the other 4).
- **homeActivities/schoolActivities** — present everywhere but **NOT assessment-derived**: a curated baseline
  catalog (school list byte-identical across all 9; home has only 2 distinct values). Real per-setting activity
  extraction is effectively absent.
- **Extractor-captured but dropped on storage** — baselineFrequency, intensity, measurableUnit, newBehaviors,
  medications, setting_details, age, preferredActivities, nonPreferredActivities, currentAccuracy. The schema
  asks for them; no profile retains them. A Builder that wants these must store them (they exist in the extractor
  output but are discarded by `assessmentPipeline`'s `buildAssessmentProfile`).

### What note generation NEEDS that assessments often don't provide
1. **Gender/pronouns** — missing 4/9.
2. **Genuinely assessment-sourced, setting-split activities** — the note's ACTIVITY SOURCE rule wants real
   approved activities; the stored home/school lists are generic baseline. **The biggest gap** between what the
   note wants and what the assessment supplies — a headline reason the Builder is worth it.
3. **Per-program teaching method + reinforcement schedule** — the note only names a method/schedule when the
   plan declares it per program; no such field exists in the profile, so those clauses are always omitted.
4. **A retained source document** — 6/9 clients have none.

### Key transform to remember (extractor output ≠ stored profile)
`assessmentPipeline` reshapes extractor output before storage: `topography`→`topographies`, `function`→
`functions`, `replacementSkills` split by status into `replacementBehaviors` (active) + `skillAcquisition`
(mastered), `reinforcers` object flattened to a `string[]`, and home/school activities replaced with the
curated baseline. **The Builder should store the richer draft shape and map to `clinical_profile` on
completion — retaining the fields storage currently drops.**
