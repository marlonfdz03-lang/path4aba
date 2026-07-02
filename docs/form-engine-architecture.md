# Universal Clinical Form Engine — Technical Architecture

> Status: **Phase 1 COMPLETE & calibrated on ABA Matrix** (Scanner + Normalizer + ABAMatrixAdapter + debug). Live result: **28 fields detected, 0 unidentified** — DailyLog (11), BehaviorReduction (9), GoalImplementation (8). Phase 2 (`ClinicalExtractor`) is next, awaiting instructions.
> Relationship to legacy: `extension/abamatrix-autofill.js` is **retained as the fallback** behind the existing **Fill** button; the new engine runs only when `FORM_ENGINE_BETA` is enabled.

---

## Approved Decisions

1. **Two-call model is fixed — do not merge.** `ClinicalExtractor` (clinical reasoning) and `Planner` (field matching) stay as two distinct AI calls. They are not combined, and the Planner is not folded into the extractor. Target remains **2 calls**, max **3** (Validator escalation).
2. **Module name is `Watcher`** (not "MutationObserver"). It internally wraps the browser's native `MutationObserver` API, but the module — file, type, and references — is named `Watcher`.
3. **No PHI persistence.** `ClinicalFacts` and all derived data live **in memory for the duration of a single fill only**. Nothing is written to `chrome.storage`, `localStorage`, IndexedDB, or disk. When the fill ends (or the popup/page unloads), the facts are gone.
4. **Legacy autofill stays as the fallback.** `abamatrix-autofill.js` remains wired to the existing **Fill** button and is the default path. It is only bypassed when the new engine is explicitly enabled, and it is the automatic fallback if the engine errors.
5. **Feature flag `FORM_ENGINE_BETA`.** A boolean (default **false** in production) gates the entire new engine. `FORM_ENGINE_BETA = true` routes the Fill button through the new engine; `false` uses the legacy autofill. The flag is the single on/off switch for the whole Phase 2+ pipeline.

---

## Phase 1 Calibration Findings (ABA Matrix)

Empirical facts about the live ABA Matrix DOM (`app.abamatrix.com/session`), discovered by iterating `window.debugFormEngine()` against the real form. These drove the Scanner/Adapter/Normalizer implementation and are the ground truth Phase 2+ builds on. **Final result: 28 fields, 0 unidentified** — DailyLog (11), BehaviorReduction (9), GoalImplementation (8).

### DOM structure
- **The page has ~21 separate `<form>` elements**, not one form. **Each Daily Log question is its own `<form class="w-100-p px-8">`** — Daily Log is *not* card-based and *not* a single form. The adapter bundles every form whose controls are **not** inside a `mat-card` into one synthetic `DailyLog` section (`multiForm: true`, `element` = an **array** of forms).
- **Behavior Reduction and Goal Implementation are `mat-card` based.** In the calibration sample, Behavior was one form containing a card with ~10 controls and Goal a form with ~8 controls, all controls **inside** the `mat-card`. These cards are detected by scanning inner text (the cards carry **no title element**), typed by `getSectionType(cardEl)`.
- **`mat-card`s carry no title node** — section type is inferred from the questions rendered inside the card (e.g. `Behavior:` + `Evidenced By:` ⇒ BehaviorReduction; `Goal Implementation:` + `medical barriers` ⇒ GoalImplementation; `How did the client present` / `Who was present` / `significant changes` ⇒ DailyLog).

### Field-label (question) patterns — three shapes
The Scanner's `getQuestionText(fieldEl)` resolves the question in priority order:
1. **`mat-label` inside a `mat-form-field`** — the common Angular Material case.
2. **`previousElementSibling` text** — a `<div>`/`<p>`/`<strong>` sibling holds the question (radio groups, `app-select`, some inputs). Search walks up to 3 previous siblings, then the parent's previous sibling.
3. **`app-select` / custom-component fields** — value-bearing containers. **Skip `app-select` and any element containing a `mat-select` while searching for question text**, because those hold the *selected value*, not the question. Field types also extend beyond native Material: `app-select` ⇒ `select`, `mat-chip-list`/`mat-chip-grid`/`app-chip-input` ⇒ `chip`.

### Scanning rules that proved necessary
- **`seenControls` dedup (adapter).** Forms can nest / repeat, so the same control surfaces under multiple `<form>` elements. Each control is claimed by the **first** form that owns it; later forms sharing an already-claimed control are dropped. Without this, Daily Log fields are scanned multiple times.
- **Hidden forms/cards are skipped** via `offsetParent === null`.
- **JS filter, not CSS `:not()`.** `!el.closest('mat-card')` is used to separate form-level Daily Log controls from card controls; the equivalent CSS `:not(mat-card mat-form-field)` selector proved unreliable in this DOM.
- **Section-title elements are skipped in the Scanner.** A field whose question resolves to a header like `Behavior Reduction #1` / `Goal Implementation #2` is dropped (regex in the dispatcher) rather than mapped — the header is not a real field. This is deliberately handled in the Scanner, **not** added to the Normalizer's `FIELD_KEY_MAP`.
- **Nested field dedup (Daily Log).** When a custom wrapper (e.g. `app-select`) contains a native control (e.g. `mat-select`), only the **outermost** candidate is kept, so one logical field is not counted twice.

### Debug / reinjection
- **No idempotency guards.** The four engine modules must **always overwrite** their `window.*` exports on (re)injection — no `if (window.X) return;` early return. During calibration, the guard kept stale code alive after an extension reload; overwriting guarantees the latest code runs. A `window.__FormEngine_v` counter increments on each injection so a reinjection can be confirmed in the console.
- **`world: 'MAIN'`.** The pure-DOM modules load in the MAIN world so `window.debugFormEngine()` is callable from the default DevTools console context. On-demand injection (the **🧪 Debug Form** dev button → `background.js`) coexists with the `content_scripts` load path.

### Status of the core modules
- **Scanner, ABAMatrixAdapter, Normalizer are calibrated: 0 unidentified fields** across all three sections. The `FIELD_KEY_MAP` covers every visible ABA Matrix question (Daily Log presentation/evidence/participation/present/incidents/medical/environment/relevant-info; Behavior name/evidenced/function/antecedent/interventions/consequence/main-focus/result/STO; Goal name/barriers/activities/teaching/prompts/reinforcers/schedule). This is the stable foundation for Phase 2.

---

## 1. System Overview

### Purpose
Fill **any** web-based ABA documentation platform (Office Puzzle, ABA Matrix, CentralReach, Catalyst, Rethink, …) from a single clinical session note, with the same core engine and a thin per-platform adapter.

### Core principle
> **The AI reasons about clinical content exactly once. Local, deterministic logic does the form filling.**

Clinical reasoning is expensive, non-deterministic, and the source of most bugs. The engine isolates it into a single **ClinicalExtractor** pass that turns a free-text note into a structured `ClinicalFacts` object. Everything downstream — locating fields, matching facts to fields, filling, handling fields that only appear *after* a click, validating — is **local logic operating on already-extracted facts**. The AI is never in the fill loop.

### Architectural shape
```
        ┌─────────────────────────── platform-agnostic core ───────────────────────────┐
Note ─► ClinicalExtractor ─► Planner ─► Executor ─► Watcher ─► LocalResolver ─► Validator
        └───────────────────────────────────┬───────────────────────────────────────────┘
                                             │ uses
                              ┌──────────────▼──────────────┐
                              │  PlatformAdapter (interface) │
                              │  ABAMatrix | CentralReach…   │
                              └──────────────────────────────┘
```
The **core** knows nothing about any specific platform's DOM. All platform knowledge — how to detect sections, where the "add row" button is, how a section container is shaped — lives behind the `PlatformAdapter` interface. Adding a platform = writing one adapter, not touching the core.

### What this fixes vs. today's `abamatrix-autofill.js`
| Today | This engine |
|---|---|
| Index-based selectors (`matSelects[i*3]`, `textareas[tBase+2]`) — break on any DOM reflow | Stable IDs (`BR3_Antecedent`) resolved by locator strategy, never ordinal |
| One AI call that both reasons *and* answers form-specific questions | Split: reason once (facts), match once (plan); facts reused everywhere |
| Conditional fields (chip appears after "Yes") handled by `waitMs`+re-query guesswork | `Watcher` + `LocalResolver` resolve them from existing facts, deterministically |
| Every fill re-derives clinical content | Facts extracted once, cached for the whole session |
| ABA-Matrix-only, hard-coded | Platform-agnostic core + adapters |
| No notion of "unsure" | Every action carries a `confidence`; low-confidence is flagged, not guessed |

### Non-goals
- Not a form *builder* or renderer — it only fills existing third-party forms.
- Not a submitter — it fills and stops; a human reviews and submits (clinical + liability requirement).
- Does not persist PHI beyond the session; `ClinicalFacts` lives in memory for the fill only.

---

## 2. Module Definitions and Responsibilities

> Runtime placement: the **pure-DOM modules (Scanner, Normalizer, Adapters)** touch no `chrome.*` APIs and are world-agnostic. In **Phase 1 they load as `content_scripts` in the MAIN world** so `window.debugFormEngine()` is reachable from the default DevTools console context. The **API-driven modules (Executor, Watcher, LocalResolver, Validator, orchestrator)** need `chrome.runtime`, so in Phase 2+ they run in the **ISOLATED world**, invoking the scan via the shared world (or a small event bridge). **ClinicalExtractor** and the AI portion of **Planner** run **server-side** (Next.js route), reached via the background service worker's Bearer-token fetch (CORS-exempt) — mirroring the existing `getABAMatrixAnswers` proxy pattern.

### Scanner
- **Input:** the live DOM of any web-based form (scoped by the active `PlatformAdapter`).
- **Output:** `FormSchema` — a normalized, platform-agnostic snapshot.
- **Responsibility:** walk the DOM and extract, per field: the question/label text, field type (`text | textarea | select | radio | chip | checkbox | date | number`), available options (for selects/radios), current value, required flag, and visibility (`offsetParent !== null`). Groups fields into raw sections using the adapter's `detectSections()`.
- **Hard rule:** **must not depend on element order/index.** Every field carries a `FieldLocator` built from *stable* attributes — `formControlName`, `id`, `aria-label`, `name`, or nearest-label proximity — in that priority order. If nothing stable exists, the field is emitted with `locator.strategy = 'label-proximity'` and `visible=false` is preferred over a fragile ordinal.

### Normalizer
- **Input:** raw `FormSchema` from Scanner.
- **Output:** `NormalizedForm` with **stable field IDs** and detected section types.
- **ID format:** `{SectionType}{Number}_{FieldKey}` — e.g. `BR3_Antecedent`, `Goal2_Prompts`, `DailyLog_ParticipationLevel`. `SectionType` ∈ {`BR` (Behavior Reduction), `Goal`, `DailyLog`, `Caregiver`}. `Number` is the 1-based ordinal *within that section type* (display/grouping only — **never** used to locate an element). `FieldKey` is a canonical key mapped from the field's label via the adapter's `normalizeFieldKey()`.
- **Responsibility:** (a) assign stable IDs; (b) classify each section's `SectionType`; (c) flag `conditional` fields — those that are currently absent or hidden and will be revealed by another field's value (e.g. the "What prompts?" input that appears only after "Did you use prompts? → Yes"). Conditional fields are recorded in the schema even when not yet present, keyed by the trigger.
- Produces a `fieldIndex: Record<id, FormField>` for O(1) lookup by Planner/LocalResolver.

### ClinicalExtractor
- **Input:** raw session note text **+** client profile (name, active programs/goals, target behaviors from the assessment).
- **Output:** `ClinicalFacts` — structured JSON (see §3).
- **Cadence:** **exactly once per session.** Never per field, never per iteration.
- **Responsibility:** the *only* clinical-reasoning step. Reads the note and emits every clinical datum the downstream needs: daily-log presentation, each behavior (function, antecedent, interventions, result), each skill/goal (procedure, prompts, reinforcers, schedule), caregivers present, incidents, medical concerns. Knows nothing about any form.
- **1 AI call.** Output is validated against the `ClinicalFacts` schema (retry-on-mismatch).

### Planner
- **Input:** `ClinicalFacts` + `NormalizedForm`.
- **Output:** `FillPlan` — an array of `FillAction`s, each with a `confidence`.
- **Cadence:** **once per session.**
- **Responsibility:** **matching, not clinical reasoning.** For every form field, decide which fact fills it and how: which `mat-option` best matches `skill.reinforcementSchedule`, which dropdown entry matches `behavior.name`, which fact string goes in which textarea. Emits structural actions too (how many times to click "+" before per-row fields exist). Assigns a `confidence` to each match.
- **Confidence gate:** actions with `confidence < 0.65` are **flagged for human review, not auto-filled** (`requiresHumanReview = true`, routed to `flaggedForReview`). This is the safety valve against confident-but-wrong fills.
- **1 AI call** — used for *semantic option matching* (fuzzy label→option, free-text→enum) only. Deterministic 1:1 matches (direct fact→field) are resolved locally within the Planner; the AI is consulted only for the ambiguous remainder. Per **Approved Decision 1**, this call stays distinct from the ClinicalExtractor call — the two are never merged, holding the model at **2 calls**.

### Executor
- **Input:** `FillPlan` + live DOM.
- **Output:** `ExecutionResult` — `filled | skipped | failed | deferred` per action.
- **Responsibility:** perform each `FillAction` using **Angular-compatible events** — native value setter by element type + `input`/`change`/`blur`, `mat-select`→`mat-option` overlay clicks, chip input + `Enter`, radio input `.click()`. Re-resolves each field from its `FieldLocator` at execution time (never trusts a stale reference). **Idempotent:** skips fields already holding the intended value (safe re-runs; replaces today's crude 3-second debounce).
- **After each `reveals`-flagged action** (radio/select that can expose conditional fields): notifies the **Watcher** and awaits settling before proceeding, so newly-revealed fields are handled in-order rather than raced.

### Watcher
- The module is named **`Watcher`**; it internally wraps the browser's native `MutationObserver` API. Armed by the Executor around `reveals` actions.
- **Monitors** the DOM for fields that appear *after* an Executor action (conditional/dynamic fields).
- **On new field detected:** hands the field descriptor to **LocalResolver** — **not** back to the AI.
- **Escalates to Planner only if** LocalResolver returns `null` (cannot resolve locally). This keeps conditional-field handling at 0 AI calls in the common case.

### LocalResolver
- **Input:** a new/conditional field descriptor **+** the `ClinicalFacts` already extracted.
- **Output:** a `FillAction` or `null`.
- **Responsibility:** resolve a just-revealed field **locally**, reusing facts — **no AI call**. It re-runs the Planner's matching logic against the single new field, scoped to the section it appeared in.
- **Example:** Executor clicks **Yes** on "Did you use prompts?" → the "What prompts were used?" input appears → Watcher passes it here → LocalResolver reads `skill.promptsUsed` from `ClinicalFacts` and returns a `setText`/`addChip` action. Zero AI.
- Returns `null` only when the field maps to a fact that was never extracted (genuinely unknown) — that is the sole trigger for escalation.

### Validator
- **Input:** final DOM state (post-execution).
- **Output:** `ValidationResult` — the list of **required fields still empty/invalid**.
- **Responsibility:** confirm every required field is satisfied. Runs after the Executor/Watcher/LocalResolver loop settles.
- **Escalation rule:** if gaps remain **and** LocalResolver already failed on them → **then** escalate to Planner for a **second (or third) AI call** targeting only the outstanding fields. If no gaps, the fill completes with **2 AI calls total** (target).

### PlatformAdapter *(interface)*
- The single seam between the platform-agnostic core and a specific platform.
- **Required methods:** `detectSections()`, `clickAddButton(sectionType)`, `getAddButtonSelector(sectionType)` (plus the supporting methods in §6).
- **`ABAMatrixAdapter` implements `PlatformAdapter`.**
- **Future:** `CentralReachAdapter`, `CatalystAdapter`, `RethinkAdapter` — each a new file, core untouched.

---

## 3. Data Contracts (TypeScript)

> These live in one shared `types.ts` (server) mirrored by `types.d.ts` (extension). All IDs are the stable Normalizer IDs; no interface anywhere carries a positional index used for lookup.

```ts
// ─────────────────────────── Field & Section primitives ───────────────────────────

export type FieldType =
  | 'text' | 'textarea' | 'select' | 'radio'
  | 'checkbox' | 'chip' | 'date' | 'number' | 'unknown';

export type SectionType = 'DailyLog' | 'BehaviorReduction' | 'GoalImplementation' | 'Caregiver' | 'Unknown';

export interface FieldOption {
  label: string;                 // visible option text
  value: string;                 // underlying value (may equal label)
}

/** How to re-find an element in the live DOM without using an index. */
export interface FieldLocator {
  strategy: 'formControlName' | 'id' | 'aria-label' | 'name-attr' | 'label-proximity';
  selector: string;              // stable CSS/attribute selector
  labelText?: string;            // fallback anchor when selector is proximity-based
  sectionId: string;             // scopes the search to one section container
}

export interface FormField {
  id: string;                    // stable, e.g. "BR3_Antecedent" (assigned by Normalizer; '' from Scanner)
  fieldKey: string;              // canonical key, e.g. "Antecedent", "Prompts"
  label: string;                 // visible question text
  type: FieldType;
  options?: FieldOption[];       // for select | radio | checkbox
  value: string | string[] | null;
  required: boolean;
  visible: boolean;              // offsetParent !== null at scan time
  conditional: boolean;          // revealed by another field's value
  revealedBy?: string;           // fieldId of the trigger, when conditional
  locator: FieldLocator;
}

export interface FormSection {
  id: string;                    // stable, e.g. "BR3", "Goal2", "DailyLog"
  type: SectionType;
  ordinal: number;               // 1-based within type — DISPLAY ONLY, never used to locate
  title: string;                 // heading text
  fields: FormField[];
  locator: FieldLocator;         // how to re-find the section container
}

// ─────────────────────────── Scanner / Normalizer outputs ───────────────────────────

export interface FormSchema {           // raw, from Scanner (no stable IDs, types provisional)
  platform: string;                     // e.g. "abamatrix"
  url: string;
  scannedAt: string;                    // ISO-8601
  sections: FormSection[];
}

export interface NormalizedForm {       // from Normalizer (IDs assigned, types detected)
  platform: string;
  url: string;
  sections: FormSection[];
  fieldIndex: Record<string, FormField>; // id -> field, O(1) lookup
}

// ─────────────────────────── Clinical facts (the single AI reasoning output) ───────────────────────────

export type BehaviorFunction = 'Attention' | 'Escape' | 'Tangible' | 'Automatic';

export interface DailyLog {
  presentationStart: string;
  evidencedByStart: string;
  presentationEnd: string;
  evidencedByEnd: string;
  participation: string;
}

export interface Behavior {
  name: string;
  evidencedBy: string;
  function: BehaviorFunction;
  antecedent: string;
  antecedentInterventions: string[];
  consequenceInterventions: string[];
  mainFocus: string;
  result: string;
}

export interface Skill {
  name: string;
  medicalBarriers: string[];
  activities: string[];
  teachingProcedure: string;
  usedPrompts: boolean;
  promptsUsed: string[];               // populated iff usedPrompts
  reinforcers: string[];
  reinforcementSchedule: string;       // canonical schedule label (see schedules enum)
}

export interface ClinicalFacts {
  client: { firstName?: string; profileId: string };
  session: { date: string };
  dailyLog: DailyLog;
  behaviors: Behavior[];
  skills: Skill[];
  caregiversPresent: string[];
  incidents: string | null;
  medicalConcerns: string | null;
  extractedAt: string;                 // ISO-8601
  raw: Record<string, unknown>;        // anything not modeled, preserved verbatim
}

// ─────────────────────────── Plan / Execution / Validation ───────────────────────────

export type FillActionKind =
  | 'setText' | 'selectOption' | 'selectRadio'
  | 'addChip' | 'toggleCheckbox' | 'clickAdd';

export interface FillAction {
  fieldId: string;                     // NormalizedForm field id (or section id for clickAdd)
  kind: FillActionKind;
  value: string | string[];
  confidence: number;                  // 0..1 — Planner/LocalResolver match confidence
  source: string;                      // fact path, e.g. "behaviors[2].antecedent"
  requiresHumanReview: boolean;        // true when confidence < CONFIDENCE_THRESHOLD (0.65)
  reveals: boolean;                    // may expose conditional fields -> Watcher arms after
}

export interface FillPlan {
  formUrl: string;
  createdAt: string;
  structuralActions: FillAction[];     // clickAdd actions, run first to materialize rows
  fieldActions: FillAction[];          // the field fills, in safe execution order
  flaggedForReview: FillAction[];      // confidence < 0.65 — surfaced to the user, not auto-filled
  aiCallsUsed: number;                 // 1 after planning (extractor's call counted separately)
}

export type ActionStatus = 'filled' | 'skipped' | 'failed' | 'deferred';

export interface ActionOutcome {
  fieldId: string;
  attempted: FillActionKind;
  status: ActionStatus;
  reason?: string;                     // why skipped/failed/deferred
}

export interface ExecutionResult {
  outcomes: ActionOutcome[];
  filledCount: number;
  skippedCount: number;
  failedCount: number;
  newFieldsDetected: string[];         // locators/ids surfaced by the Watcher during the run
  completedAt: string;
}

export interface RequiredGap {
  fieldId: string;
  label: string;
  sectionId: string;
  reason: 'empty' | 'invalid';
}

export interface ValidationResult {
  ok: boolean;                         // no required gaps remain
  gaps: RequiredGap[];
  resolvedLocally: number;             // gaps closed by LocalResolver without AI
  needsEscalation: boolean;            // true -> Validator triggers the (max) 3rd AI call
}
```

---

## 4. AI Call Strategy

| Stage | AI calls | Purpose |
|---|---|---|
| **ClinicalExtractor** | **1** (always) | Turn the note into `ClinicalFacts`. The only clinical reasoning. |
| **Planner** | **1** (always) | Semantic matching of facts → fields/options. No clinical reasoning. |
| **LocalResolver** | **0** | Resolve conditional fields from already-extracted facts. |
| **Validator escalation** | **≤ 1** (only if needed) | Fill required fields still empty after all local resolution. |

- **Target: 2 calls** (Extractor + Planner) — the happy path, when LocalResolver closes every conditional field and no required gaps remain.
- **Maximum: 3 calls** — the extra call fires **only** when `Validator.needsEscalation === true`, i.e. required fields remain **and** LocalResolver already failed on them.
- **The AI is never inside the fill loop.** Watcher→LocalResolver iterations are unbounded in DOM churn but **bounded at 0 AI calls**. Cost is decoupled from form size and from how many conditional fields appear.
- **Caching / idempotency:** `ClinicalFacts` is computed once and reused for the entire session (including re-runs and the Validator escalation, which receives the same facts + only the gap list). Same note → same facts → deterministic plan.

**Guardrail:** a hard per-fill counter caps AI calls at 3; the Executor/Watcher/LocalResolver path is statically incapable of issuing an AI call (no network client injected), so the cap cannot be breached by a runaway conditional-field loop.

---

## 5. Flow Diagram

```
  ┌────────────┐        ┌──────────────────┐
  │ Session    │        │ Client profile   │
  │ note (text)│        │ (goals/behaviors)│
  └─────┬──────┘        └────────┬─────────┘
        │                        │
        └──────────┬─────────────┘
                   ▼
        ╔══════════════════════╗   AI CALL #1
        ║  ClinicalExtractor   ║  ── reason once ──►  ClinicalFacts ──────────────┐
        ╚══════════════════════╝                                                  │
                                                                                  │ (cached, reused everywhere)
  ┌──────────┐   scan (stable      ┌──────────────┐   assign IDs                  │
  │ Live DOM │ ─  locators, no ──► │   Scanner    │ ─► FormSchema ─► ┌──────────┐ │
  │ (form)   │    indexes)         └──────────────┘                 │Normalizer│ │
  └──────────┘                                                       └────┬─────┘ │
                                                                          ▼       ▼
                                                              NormalizedForm + ClinicalFacts
                                                                          │
                                                                          ▼
                                                              ╔═══════════════════╗  AI CALL #2
                                                              ║      Planner      ║  (semantic match only)
                                                              ╚═════════┬═════════╝
                                                                        ▼
                                                        FillPlan (actions + confidence)
                                            confidence < 0.65 ──► flaggedForReview ──► (human)
                                                                        │
                                                                        ▼
                                                              ┌───────────────────┐
                                                              │     Executor      │◄──────────────┐
                                                              │ Angular events    │               │
                                                              └─────────┬─────────┘               │
                                                    radio/select action │ (reveals=true)          │
                                                                        ▼                         │
                                                              ┌───────────────────┐               │
                                                              │  Watcher (Mut.Obs)│               │
                                                              └─────────┬─────────┘               │
                                                       new field appears │                        │
                                                                        ▼                         │
                                                              ┌───────────────────┐   FillAction  │
                                                              │  LocalResolver    │───────────────┘
                                                              │ (facts, 0 AI)     │  resolved
                                                              └─────────┬─────────┘
                                                          null (unknown)│
                                                                        ▼
                                                              ┌───────────────────┐
                                                              │     Validator     │
                                                              └─────────┬─────────┘
                                                    all required filled │ gaps + LocalResolver failed
                                                          ┌─────────────┴─────────────┐
                                                          ▼                            ▼
                                                   ✅ DONE (2 AI calls)      ╔══════════════════╗ AI CALL #3
                                                   human reviews & submits   ║ Planner (escalate)║ (only outstanding
                                                                             ╚═════════┬════════╝  required fields)
                                                                                       └──► back to Executor
```

---

## 6. Platform Adapter Interface

Every platform implements this contract. The core calls only these methods; it never queries platform-specific selectors directly.

```ts
export interface PlatformAdapter {
  /** Stable identifier, e.g. "abamatrix". */
  readonly platform: string;

  /** True if the current page/URL is a fillable form for this platform. */
  isFormPage(): boolean;

  /** Partition the DOM into raw sections (before ID assignment). */
  detectSections(): FormSection[];

  /** Map a raw label to a canonical FieldKey, e.g. "What prompted the behavior?" -> "Antecedent". */
  normalizeFieldKey(label: string, section: FormSection): string;

  /** CSS selector for the "add row" button of a given section type. */
  getAddButtonSelector(sectionType: SectionType): string;

  /** Click "add row" for a section type (materializes a new BR/Goal row). */
  clickAddButton(sectionType: SectionType): Promise<void>;

  /** Re-find a section container in the live DOM from its locator (no index). */
  resolveSection(section: FormSection): Element | null;

  /** Re-find a field element in the live DOM from its locator (no index). */
  resolveField(field: FormField): Element | null;

  /** Optional platform-specific tweaks to the raw schema (e.g. mark known conditionals). */
  refineSchema?(schema: FormSchema): FormSchema;
}
```

**`ABAMatrixAdapter` (the first implementation) encapsulates today's hard-won knowledge:**
- `detectSections()` — Angular Material `mat-card`s; card 0 = Daily Log, then Behavior Reduction cards, then Goal Implementation cards; caregiver chip section by placeholder `Caregiver(s)`.
- `getAddButtonSelector('BehaviorReduction' | 'GoalImplementation')` — the `.add-event-button` set (first = behavior, second = goal; ignores the duplicate pair).
- `normalizeFieldKey()` — the label→key table (`"What prompted the behavior? (Antecedent)"` → `Antecedent`, `"What was the main focus…"` → `MainFocus`, etc.), which removes the label-guessing fragility from the current script.
- `resolveField()` — prefers `formControlName`/`id`, falls back to label-proximity **within the section container**, never a global index.

All the brittle constants that are scattered through `abamatrix-autofill.js` today (`selectBase=i*3`, `tBase=4+i*3`, radio-group offsets) collapse into this one adapter as *named, testable* mappings.

---

## 7. File Structure

```
extension/
  engine/
    core/
      scanner.js            # DOM -> FormSchema (stable locators only)
      normalizer.js         # FormSchema -> NormalizedForm (stable IDs, section types, conditionals)
      planner-client.js     # calls backend Planner via background proxy; assembles FillPlan
      executor.js           # FillPlan -> DOM (Angular-compatible events, idempotent)
      watcher.js            # MutationObserver module; arms around reveals actions
      local-resolver.js     # conditional field + ClinicalFacts -> FillAction | null (0 AI)
      validator.js          # final DOM -> ValidationResult; decides escalation
      orchestrator.js       # wires the pipeline; owns the AI-call budget/counter
    adapters/
      platform-adapter.js   # PlatformAdapter interface + adapter registry
      abamatrix-adapter.js  # ABAMatrixAdapter (first implementation)
      # future: centralreach-adapter.js, catalyst-adapter.js, rethink-adapter.js
    types.d.ts              # shared data contracts (mirror of lib/formEngine/types.ts)
    index.js                # content-script entry: pick adapter, run orchestrator
  abamatrix-autofill.js     # LEGACY — kept until engine reaches parity, then removed
  background.js             # service worker: Bearer-token fetch proxy to backend routes
  popup.js / popup.html
  manifest.json

app/api/extension/
  extract-facts/route.ts    # ClinicalExtractor endpoint  — AI call #1
  plan-fill/route.ts        # Planner endpoint (semantic matching) — AI call #2
  resolve-gaps/route.ts     # Validator escalation endpoint — AI call #3 (conditional)
  fill-aba-matrix/route.ts  # LEGACY — superseded by extract-facts + plan-fill

lib/
  formEngine/
    clinicalExtractor.ts    # note + profile -> ClinicalFacts (Azure OpenAI prompt + schema validate)
    planner.ts              # facts + NormalizedForm -> FillPlan (local match + AI remainder)
    schedules.ts            # canonical reinforcement-schedule enum + inference rules
    confidence.ts           # CONFIDENCE_THRESHOLD (0.65) + scoring helpers
    types.ts                # shared data contracts (source of truth)
  extensionAuth.ts          # getExtensionAuth() — Bearer token -> user (existing)
```

**Placement rationale**
- **Core + adapters in `extension/engine/`.** Pure-DOM modules (Scanner/Normalizer/Adapters) are world-agnostic and load in the **MAIN world** in Phase 1 (console reachability); API-driven modules run **ISOLATED** in Phase 2+. All modules issue **no** cross-origin fetches directly. Angular expando props (`__ngContext__`) are not visible from the ISOLATED world, so the Executor relies on native-setter events — an explicit design constraint, not an accident.
- **AI work server-side in `app/api/extension/` + `lib/formEngine/`.** Content-script→backend calls go through `background.js` (host-permission fetches are CORS-exempt; content-script fetches are not) with the existing `getExtensionAuth()` Bearer pattern — no new auth surface.
- **`types.ts` is the single source of truth**, re-declared as `types.d.ts` for the extension so both sides compile against one contract.

---

## Open Questions (remaining)

The approval resolved the four prior questions — captured in **Approved Decisions** above (2-call model fixed; in-memory-only PHI; legacy stays as fallback; `FORM_ENGINE_BETA` gate). One minor item stays open:

1. **Confidence threshold granularity:** `0.65` is the committed global default. Still open: whether to add per-field-type thresholds (e.g. stricter for `select`, where a wrong option is worse than an empty text field). Deferred until the Planner exists and we have real confidence distributions to tune against.
