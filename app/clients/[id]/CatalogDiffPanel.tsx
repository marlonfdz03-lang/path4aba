"use client";

import { useMemo } from "react";
import { diffCatalog, type CatalogDiff } from "@/lib/catalogDiff";

// Phase 2 UI: surface how the saved clinical_profile compares to the live treatment plan captured
// from ABA Matrix. This is the INSTRUMENT that proves the matcher before Phase 3 depends on it, so
// it shows the reasoning (what matched what and by which method), lists unmatched items on BOTH
// sides even when counts are equal, and never modifies anything.

const asName = (x: any): string => (typeof x === "string" ? x : x?.name || "");
const uniq = (arr: string[]) => Array.from(new Set(arr.map((s) => String(s || "").trim()).filter(Boolean)));

function daysSince(iso?: string): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / 86400000);
}

function ageLabel(iso?: string): string {
  const d = daysSince(iso);
  return d === null ? "unknown" : d === 0 ? "today" : `${d}d ago`;
}

// Describe how populated the form was when this catalog was captured — the key filtering signal.
function formStateLabel(fs: any): string {
  if (!fs || typeof fs !== "object") return "form state not recorded";
  const total = Number(fs.goalsTotal) || 0;
  const pop = Number(fs.goalsPopulated) || 0;
  if (!total) return "no goal instances present";
  if (pop === 0) return `empty form (0/${total} goals populated)`;
  return `${pop}/${total} goals already populated`;
}

const METHOD_STYLE: Record<string, { bg: string; color: string }> = {
  exact: { bg: "#dcfce7", color: "#166534" },
  normalized: { bg: "#dbeafe", color: "#1e40af" },
  "token-overlap": { bg: "#fef3c7", color: "#92400e" },
};

function Empty() {
  return <p className="text-[11px]" style={{ color: "var(--text3)" }}>None</p>;
}

function DiffBlock({ title, diff }: { title: string; diff: CatalogDiff }) {
  return (
    <div>
      <p className="text-[12px] font-semibold mb-1" style={{ color: "var(--text2)" }}>{title}</p>

      {/* Matched — with the method (and score for the fuzzy tier) visible per pairing. */}
      <p className="text-[11px] mt-2 mb-1" style={{ color: "var(--text3)" }}>Matched ({diff.matched.length})</p>
      {diff.matched.length === 0 ? <Empty /> : (
        <div className="space-y-1">
          {diff.matched.map((m, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1.5 text-[11px]" style={{ color: "var(--text1)" }}>
              <span>{m.profile}</span>
              <span style={{ color: "var(--text3)" }}>↔</span>
              <span>{m.observed}</span>
              <span
                className="px-1.5 py-0.5 rounded-full text-[10px] font-medium"
                style={{ background: METHOD_STYLE[m.method].bg, color: METHOD_STYLE[m.method].color }}
                title={`normalized: "${m.normProfile}" vs "${m.normObserved}"`}
              >
                {m.method}{m.method === "token-overlap" ? ` ${m.score}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Unmatched — BOTH sides, always shown (even when empty). */}
      <p className="text-[11px] mt-3 mb-1 font-medium" style={{ color: "#92400e" }}>
        In profile, not offered ({diff.onlyInProfile.length}) — may have been mastered or discontinued
      </p>
      {diff.onlyInProfile.length === 0 ? <Empty /> : (
        <div className="flex flex-wrap gap-1">
          {diff.onlyInProfile.map((u, i) => (
            <span key={i} className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: "#fef3c7", color: "#92400e" }}>{u.item}</span>
          ))}
        </div>
      )}

      <p className="text-[11px] mt-3 mb-1 font-medium" style={{ color: "#1e40af" }}>
        Offered, not in profile ({diff.onlyInObserved.length}) — may have been added since the last reassessment
      </p>
      {diff.onlyInObserved.length === 0 ? <Empty /> : (
        <div className="flex flex-wrap gap-1">
          {diff.onlyInObserved.map((u, i) => (
            <span key={i} className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: "#dbeafe", color: "#1e40af" }}>{u.item}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function CatalogDiffPanel({ clinicalProfile }: { clinicalProfile: any }) {
  const cp = clinicalProfile || {};
  const cat = cp?.observedCatalog?.aba_matrix;
  const observed = cat?.current;
  const previous = cat?.previous;

  // Set `window.__p4CatalogDebug = true` in the console to log the normalized forms + every
  // decision (labels are treatment-plan names, not clinical content).
  const debug = typeof window !== "undefined" && (window as any).__p4CatalogDebug === true;

  const profilePrograms = uniq([
    ...(cp.replacementBehaviors || []),
    ...(cp.skillAcquisition || []),
    ...((cp.activePrograms?.replacementSkills) || []),
  ].map(asName));
  const profileBehaviors = uniq([
    ...(cp.maladaptiveBehaviors || []),
    ...((cp.activePrograms?.maladaptive) || []),
  ].map(asName));
  const obsPrograms = uniq((observed?.programs || []).map(asName));
  const obsBehaviors = uniq((observed?.behaviors || []).map(asName));

  const programDiff = useMemo(
    () => diffCatalog(profilePrograms, obsPrograms, { debug, label: "programs" }),
    [profilePrograms.join("|"), obsPrograms.join("|"), debug],
  );
  const behaviorDiff = useMemo(
    () => diffCatalog(profileBehaviors, obsBehaviors, { debug, label: "behaviors" }),
    [profileBehaviors.join("|"), obsBehaviors.join("|"), debug],
  );

  // No catalog captured yet -> nothing to show (it appears after the first AI Fill).
  if (!observed) return null;

  const disagree =
    programDiff.onlyInProfile.length || programDiff.onlyInObserved.length ||
    behaviorDiff.onlyInProfile.length || behaviorDiff.onlyInObserved.length;

  // Completeness / filtering signal: compare the current capture's counts against the previous
  // capture's. If the same client's observed count changes with no plan change, the dropdown may
  // be a filtered subset — which would make Phase 3's "restrict to observed" unsafe.
  const curP = obsPrograms.length, curB = obsBehaviors.length;
  const prevP = (previous?.programs || []).length, prevB = (previous?.behaviors || []).length;
  const countChanged = !!previous && (curP !== prevP || curB !== prevB);
  const popChanged = !!previous &&
    (Number(observed.formState?.goalsPopulated) || 0) !== (Number(previous.formState?.goalsPopulated) || 0);

  const Row = ({ label, val }: { label: string; val: string }) => (
    <div className="flex justify-between gap-3 text-[11px]">
      <span style={{ color: "var(--text3)" }}>{label}</span>
      <span className="text-right" style={{ color: "var(--text1)" }}>{val}</span>
    </div>
  );

  return (
    <div className="bg-white rounded-[10px] border p-5 mt-5" style={{ borderColor: "var(--border)" }}>
      <p className="text-[11px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--text3)" }}>
        Live Treatment Plan (ABA Matrix)
      </p>

      {/* ── Capture completeness — is the live list the full plan or a filtered subset? ── */}
      <div className="mb-4 pb-4 space-y-1" style={{ borderBottom: "1px solid var(--border)" }}>
        <p className="text-[12px] font-semibold mb-1" style={{ color: "var(--text2)" }}>
          Capture completeness
        </p>
        <Row label="Saved profile" val={`${profilePrograms.length} programs · ${profileBehaviors.length} behaviors`} />
        <Row label={`Live now · captured ${ageLabel(observed.capturedAt)}`} val={`${curP} programs · ${curB} behaviors · ${formStateLabel(observed.formState)}`} />
        {previous
          ? <Row label={`Live before · captured ${ageLabel(previous.capturedAt)}`} val={`${prevP} programs · ${prevB} behaviors · ${formStateLabel(previous.formState)}`} />
          : <Row label="Live before" val="no previous capture yet" />}

        {countChanged && (
          <div className="mt-2 p-2 rounded text-[11px]" style={{ background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca" }}>
            ⚠ Live catalog count changed between captures (programs {prevP}→{curP}, behaviors {prevB}→{curB}).
            If the treatment plan did not change, the dropdown may be a <strong>filtered subset</strong> — do not
            ship Phase 3 (restricting generation to the observed catalog) until the filtering rule is understood.
            {popChanged && (
              <> This capture was on a form with a different number of populated goals than the previous
              one ({formStateLabel(previous!.formState)} → {formStateLabel(observed.formState)}), which is
              consistent with population-dependent filtering.</>
            )}
          </div>
        )}
      </div>

      <p className="text-[12px] mb-4" style={{ color: disagree ? "#92400e" : "var(--text3)" }}>
        {disagree
          ? "The saved profile and the live plan disagree. Informational only — nothing here changes the profile."
          : "The saved profile matches the live plan."}
      </p>
      <div className="space-y-5">
        <DiffBlock title="Skill Programs" diff={programDiff} />
        <DiffBlock title="Behaviors" diff={behaviorDiff} />
      </div>
    </div>
  );
}
