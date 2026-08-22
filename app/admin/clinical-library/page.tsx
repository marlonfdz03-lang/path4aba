"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// The Clinical Library: the deduplicated clinical vocabulary accumulated automatically from every ingested
// assessment, to power the future Assessment Builder's autocomplete. This panel is where an admin curates it —
// browse by kind, fix a name, prune a variant, merge near-dups the key missed, split a wrongly-collapsed row,
// and watch the PHI discard filter's hit counts. No note text or client data ever reaches here.

interface Entry {
  id: string;
  kind: string;
  canonicalKey: string;
  displayName: string;
  variants: string[];
  functions: string[];
  meta: any;
  updatedAt: string;
}
interface Suggestion { kind: string; a: { id: string; name: string }; b: { id: string; name: string }; }
interface Discard { kind: string; reason: string; count: number; }

const KIND_LABEL: Record<string, string> = {
  behavior: "Behaviors", skill: "Replacement skills", procedure: "Teaching procedures",
  reinforcer: "Reinforcers", activity: "Activities",
};
const REASON_LABEL: Record<string, string> = {
  "hipaa-id": "HIPAA identifier", date: "Date", age: "Age", location: "Location", "proper-name": "Proper name",
};
const teal = "#1BA8A0";

export default function AdminClinicalLibraryPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [discards, setDiscards] = useState<Discard[]>([]);
  const [discardTotal, setDiscardTotal] = useState(0);
  const [kinds, setKinds] = useState<string[]>([]);
  const [activeKind, setActiveKind] = useState("behavior");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [mergeMode, setMergeMode] = useState<{ sourceId: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setNotice("");
    try {
      const res = await fetch("/api/admin/clinical-library");
      const data = await res.json();
      if (data.pendingMigration) {
        setNotice("The clinical_library tables have not been created yet — run prisma/migrations/20260822000000_clinical_library/migration.sql. Assessment ingest and note generation are unaffected; the library simply accumulates nothing until the tables exist.");
        setEntries([]); setSuggestions([]); setDiscards([]); setDiscardTotal(0);
      } else if (data.error) {
        setNotice(data.error);
      } else {
        setEntries(data.entries || []);
        setSuggestions(data.suggestions || []);
        setDiscards(data.discards || []);
        setDiscardTotal(data.discardTotal || 0);
        setKinds(data.kinds || []);
      }
    } catch { setNotice("Failed to load the library."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const mutate = useCallback(async (payload: any) => {
    setBusy(true); setNotice("");
    try {
      const res = await fetch("/api/admin/clinical-library", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setNotice(data.error || "Action failed."); return false; }
      await load();
      return true;
    } catch { setNotice("Action failed."); return false; }
    finally { setBusy(false); }
  }, [load]);

  const inKind = useMemo(() => entries.filter((e) => e.kind === activeKind), [entries, activeKind]);
  const countByKind = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of entries) m[e.kind] = (m[e.kind] || 0) + 1;
    return m;
  }, [entries]);
  const kindSuggestions = useMemo(() => suggestions.filter((s) => s.kind === activeKind), [suggestions, activeKind]);

  return (
    <div style={{ padding: 24, maxWidth: 980 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Clinical Library</h1>
      <p style={{ fontSize: 13, color: "var(--text3, #6B7280)", marginBottom: 16 }}>
        Deduplicated clinical vocabulary accumulated from every ingested assessment — for the Assessment
        Builder. Curate names, prune variants, and merge near-dups. Identifiers are auto-discarded on ingest.
      </p>

      {notice && (
        <div style={{ padding: 12, borderRadius: 10, background: "#FEF3C7", color: "#92400E", fontSize: 13, marginBottom: 16 }}>
          {notice}
        </div>
      )}

      {/* Discard-log summary — the PHI filter working, count + reason only, never the text. */}
      <div style={{ border: "1px solid var(--border, #E5E7EB)", borderRadius: 10, padding: 12, background: "white", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: discards.length ? 8 : 0 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>PHI discards</span>
          <span style={{ fontSize: 12, color: "var(--text3, #6B7280)" }}>{discardTotal} total (reason category only — no text is ever stored)</span>
        </div>
        {discards.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {discards.map((d, i) => (
              <span key={i} style={{ fontSize: 12, padding: "3px 9px", borderRadius: 999, background: "#F1F5F9", color: "#475569" }}>
                {REASON_LABEL[d.reason] || d.reason} · {KIND_LABEL[d.kind]?.toLowerCase() || d.kind} · <b>{d.count}</b>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Kind tabs */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {(kinds.length ? kinds : Object.keys(KIND_LABEL)).map((k) => {
          const active = k === activeKind;
          return (
            <button key={k} onClick={() => { setActiveKind(k); setMergeMode(null); }}
              style={{
                padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                border: `1px solid ${active ? teal : "var(--border, #E5E7EB)"}`,
                background: active ? teal : "white", color: active ? "white" : "var(--text2, #4B5563)",
              }}>
              {KIND_LABEL[k] || k} <span style={{ opacity: 0.7 }}>({countByKind[k] || 0})</span>
            </button>
          );
        })}
      </div>

      {mergeMode && (
        <div style={{ padding: 10, borderRadius: 10, background: "#EFF6FF", color: "#1D4ED8", fontSize: 13, marginBottom: 12 }}>
          Merge mode — pick the entry to merge <b>“{entries.find((e) => e.id === mergeMode.sourceId)?.displayName}”</b> into. Its variants and functions fold in; it is then deleted.{" "}
          <button onClick={() => setMergeMode(null)} style={{ textDecoration: "underline", background: "none", border: "none", color: "#1D4ED8", cursor: "pointer" }}>Cancel</button>
        </div>
      )}

      {/* Merge suggestions for this kind */}
      {kindSuggestions.length > 0 && !mergeMode && (
        <div style={{ border: "1px solid #FDE68A", background: "#FFFBEB", borderRadius: 10, padding: 12, marginBottom: 16 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: "#92400E", marginBottom: 8 }}>
            Possible near-duplicates ({kindSuggestions.length}) — the key kept these separate, but their names overlap:
          </p>
          <div style={{ display: "grid", gap: 6 }}>
            {kindSuggestions.map((s, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <span>“{s.a.name}” ↔ “{s.b.name}”</span>
                <button disabled={busy} onClick={() => mutate({ action: "merge", sourceId: s.b.id, targetId: s.a.id })}
                  style={{ marginLeft: "auto", fontSize: 12, padding: "3px 10px", borderRadius: 7, border: `1px solid ${teal}`, background: "white", color: teal, cursor: "pointer" }}>
                  Merge B → A
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <p style={{ fontSize: 13, color: "var(--text3, #6B7280)" }}>Loading…</p>
      ) : inKind.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--text3, #6B7280)" }}>No {KIND_LABEL[activeKind]?.toLowerCase() || activeKind} yet.</p>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {inKind.map((e) => (
            <EntryCard key={e.id} entry={e} busy={busy} mergeMode={mergeMode}
              onEdit={(patch) => mutate({ action: "update", id: e.id, ...patch })}
              onDelete={() => { if (confirm(`Delete “${e.displayName}”? This removes it from the library corpus.`)) mutate({ action: "delete", id: e.id }); }}
              onStartMerge={() => setMergeMode({ sourceId: e.id })}
              onMergeInto={() => { if (mergeMode && mergeMode.sourceId !== e.id) mutate({ action: "merge", sourceId: mergeMode.sourceId, targetId: e.id }).then((ok) => ok && setMergeMode(null)); }}
              onSplit={(newName, variantsToMove) => mutate({ action: "split", id: e.id, newDisplayName: newName, variantsToMove })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EntryCard({ entry, busy, mergeMode, onEdit, onDelete, onStartMerge, onMergeInto, onSplit }: {
  entry: Entry; busy: boolean; mergeMode: { sourceId: string } | null;
  onEdit: (patch: any) => void; onDelete: () => void; onStartMerge: () => void; onMergeInto: () => void;
  onSplit: (newName: string, variantsToMove: string[]) => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(entry.displayName);
  const [splitting, setSplitting] = useState(false);
  const [splitName, setSplitName] = useState("");
  const [toMove, setToMove] = useState<Set<string>>(new Set());
  const isMergeTarget = mergeMode && mergeMode.sourceId !== entry.id;
  const isMergeSource = mergeMode && mergeMode.sourceId === entry.id;

  const removeVariant = (v: string) => onEdit({ variants: entry.variants.filter((x) => x !== v) });
  const removeFunction = (f: string) => onEdit({ functions: entry.functions.filter((x) => x !== f) });

  return (
    <div style={{
      border: `1px solid ${isMergeSource ? "#1D4ED8" : "var(--border, #E5E7EB)"}`,
      borderRadius: 10, padding: 12, background: isMergeSource ? "#EFF6FF" : "white",
      opacity: isMergeSource ? 0.7 : 1,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        {editingName ? (
          <>
            <input value={name} onChange={(ev) => setName(ev.target.value)} autoFocus
              style={{ fontSize: 14, fontWeight: 600, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--border, #E5E7EB)", flex: "0 1 320px" }} />
            <button disabled={busy} onClick={() => { onEdit({ displayName: name.trim() }); setEditingName(false); }}
              style={{ fontSize: 12, padding: "3px 10px", borderRadius: 7, border: `1px solid ${teal}`, background: teal, color: "white", cursor: "pointer" }}>Save</button>
            <button onClick={() => { setName(entry.displayName); setEditingName(false); }}
              style={{ fontSize: 12, padding: "3px 8px", borderRadius: 7, border: "1px solid var(--border, #E5E7EB)", background: "white", cursor: "pointer" }}>Cancel</button>
          </>
        ) : (
          <>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{entry.displayName}</span>
            <span style={{ fontSize: 11, color: "var(--text3, #9CA3AF)" }} title="canonical key">{entry.canonicalKey}</span>
            {entry.meta?.setting && <span style={{ fontSize: 11, padding: "1px 7px", borderRadius: 999, background: "#F1F5F9", color: "#475569" }}>{entry.meta.setting}</span>}
          </>
        )}
        {!editingName && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            {isMergeTarget ? (
              <button disabled={busy} onClick={onMergeInto}
                style={{ fontSize: 12, padding: "3px 10px", borderRadius: 7, border: "1px solid #1D4ED8", background: "#1D4ED8", color: "white", cursor: "pointer" }}>Merge into this</button>
            ) : !mergeMode ? (
              <>
                <IconBtn label="Rename" onClick={() => setEditingName(true)} />
                <IconBtn label="Merge…" onClick={onStartMerge} />
                {entry.variants.length > 0 && <IconBtn label="Split…" onClick={() => setSplitting((s) => !s)} />}
                <IconBtn label="Delete" danger onClick={onDelete} />
              </>
            ) : null}
          </div>
        )}
      </div>

      {entry.functions.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: entry.variants.length ? 6 : 0 }}>
          {entry.functions.map((f) => (
            <Chip key={f} text={f} tone="teal" onRemove={mergeMode ? undefined : () => removeFunction(f)} />
          ))}
        </div>
      )}

      {entry.variants.length > 0 && (
        <div>
          <p style={{ fontSize: 11, color: "var(--text3, #9CA3AF)", margin: "2px 0 4px" }}>Variants ({entry.variants.length})</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {entry.variants.map((v) => (
              splitting ? (
                <label key={v} style={{ fontSize: 12, padding: "3px 9px", borderRadius: 999, background: toMove.has(v) ? "#DBEAFE" : "#F1F5F9", color: "#334155", cursor: "pointer", display: "inline-flex", gap: 5, alignItems: "center" }}>
                  <input type="checkbox" checked={toMove.has(v)} onChange={() => setToMove((s) => { const n = new Set(s); n.has(v) ? n.delete(v) : n.add(v); return n; })} />
                  {v}
                </label>
              ) : (
                <Chip key={v} text={v} tone="gray" onRemove={mergeMode ? undefined : () => removeVariant(v)} />
              )
            ))}
          </div>
        </div>
      )}

      {splitting && (
        <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--text3, #6B7280)" }}>Move {toMove.size} variant(s) to a new entry named</span>
          <input value={splitName} onChange={(ev) => setSplitName(ev.target.value)} placeholder="New entry name"
            style={{ fontSize: 13, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--border, #E5E7EB)" }} />
          <button disabled={busy || !splitName.trim() || toMove.size === 0}
            onClick={() => { onSplit(splitName.trim(), [...toMove]); setSplitting(false); setSplitName(""); setToMove(new Set()); }}
            style={{ fontSize: 12, padding: "3px 10px", borderRadius: 7, border: `1px solid ${teal}`, background: teal, color: "white", cursor: "pointer", opacity: (!splitName.trim() || toMove.size === 0) ? 0.5 : 1 }}>Split out</button>
          <button onClick={() => { setSplitting(false); setToMove(new Set()); }}
            style={{ fontSize: 12, padding: "3px 8px", borderRadius: 7, border: "1px solid var(--border, #E5E7EB)", background: "white", cursor: "pointer" }}>Cancel</button>
        </div>
      )}
    </div>
  );
}

function Chip({ text, tone, onRemove }: { text: string; tone: "teal" | "gray"; onRemove?: () => void }) {
  const bg = tone === "teal" ? "#E6F7F5" : "#F1F5F9";
  const color = tone === "teal" ? "#0F766E" : "#475569";
  return (
    <span style={{ fontSize: 12, padding: "3px 9px", borderRadius: 999, background: bg, color, display: "inline-flex", gap: 6, alignItems: "center" }}>
      {text}
      {onRemove && <button onClick={onRemove} title="Remove" style={{ background: "none", border: "none", color, cursor: "pointer", fontWeight: 700, lineHeight: 1, padding: 0 }}>×</button>}
    </span>
  );
}

function IconBtn({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick}
      style={{ fontSize: 12, padding: "3px 10px", borderRadius: 7, border: `1px solid ${danger ? "#FCA5A5" : "var(--border, #E5E7EB)"}`, background: "white", color: danger ? "#DC2626" : "var(--text2, #4B5563)", cursor: "pointer" }}>
      {label}
    </button>
  );
}
