"use client";

export const dynamic = "force-dynamic";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";

type BCBATab = "overview" | "notes" | "schedule" | "97153xp" | "supervision" | "parent_training" | "reassessment" | "treatment_map" | "progress_report" | "clinical_timeline";

const SUPERVISION_TYPE_LABELS: Record<string, string> = {
  face_to_face: "Face-to-Face",
  remote: "Remote",
  individual_supervision: "Individual Supervision",
  group_supervision: "Group Supervision",
  client_observation: "Client Observation",
};

const XP_BCBA_ACTIONS = [
  "BCBA observed RBT implementation",
  "Live coaching was provided",
  "Corrective feedback was provided",
  "BCBA modeled correct procedure",
  "RBT rehearsed modified procedure",
  "Treatment integrity was monitored",
  "Protocol implementation was reviewed",
  "Data collection was reviewed",
  "Reinforcement delivery was reviewed",
  "Prompting procedures were reviewed",
  "Error correction procedures were reviewed",
  "Transition procedures were reviewed",
  "Other",
];

const XP_CLIENT_RESPONSE_OPTIONS = [
  "Increased compliance observed",
  "Reduced problem behavior observed",
  "Improved engagement during activities",
  "Increased independent responding",
  "Improved transition tolerance",
  "No notable change during overlap",
  "Increased behavior during overlap",
  "Other",
];

const XP_BEHAVIORS = ["Tantrum","Aggression","Elopement","Noncompliance","Property Destruction","Off Task"];
const XP_INTERVENTIONS = ["DRA","DRI","DRO","FCT","Redirection","Token Economy","Prompt Fading","Premack Principle"];
const XP_PROGRAMS = ["Request Break","Following Instructions","Waiting","Accepting No","Transition Skills","Social Skills","Functional Play"];
const XP_INTEGRITY_OPTIONS = ["Meets Expectations","Needs Improvement","Not Observed"];
const XP_BCBA_ACTIONS_NEW = ["Observed RBT Implementation","Modeled Procedures","Conducted BST","Provided Verbal Feedback","Reviewed Data","Demonstrated Intervention","Trained RBT on Procedures"];
const XP_FEEDBACK_TO_RBT = ["Prompting Procedures","Reinforcement Procedures","Data Collection","Skill Acquisition Programs","Behavior Reduction Procedures","Session Structure","Professional Conduct"];
const XP_CLIENT_RESPONSE_NEW = ["Cooperative","Required Minimal Redirection","Required Moderate Redirection","Engaged with Programs","Demonstrated Progress","Demonstrated Challenging Behaviors"];
const XP_RECOMMENDATIONS = ["Continue Current Procedures","Additional Monitoring Recommended","Additional Training Recommended","Follow-Up Overlap Recommended","Protocol Modification May Be Needed"];
const XP_NARRATIVE_STYLES = ["Insurance-Friendly","Clinical","Detailed Clinical","Audit-Ready"];
const XP_SUPERVISION_FOCUS = ["Prompting Procedures","Reinforcement Procedures","Behavior Reduction Procedures","Data Collection","Skill Acquisition Programs","Professional Conduct"];


function ConfidenceBadge({ level }: { level?: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    high:     { bg: "#DCFCE7", color: "#16A34A", label: "High Confidence" },
    moderate: { bg: "#FEF9C3", color: "#854D0E", label: "Moderate" },
    low:      { bg: "#FEE2E2", color: "#DC2626", label: "Low Confidence" },
  }
  const s = map[level ?? ""] ?? { bg: "#F3F4F6", color: "#6B7280", label: "BCBA Review Required" }
  return (
    <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: s.bg, color: s.color }}>
      {s.label}
    </span>
  )
}

function TrendBadge({ trend, type }: { trend: string; type: "behavior" | "skill" }) {
  const improving = trend === "improving"
  const worsening = trend === "worsening"
  const insufficient = trend === "insufficient_data"
  const bg = improving ? "#DCFCE7" : worsening ? "#FEE2E2" : insufficient ? "#FEF3C7" : "#F3F4F6"
  const color = improving ? "#16A34A" : worsening ? "#DC2626" : insufficient ? "#92400E" : "#6B7280"
  const label = improving
    ? (type === "behavior" ? "↓ Improving" : "↑ Improving")
    : worsening
    ? (type === "behavior" ? "↑ Worsening" : "↓ Declining")
    : insufficient ? "Insufficient Data" : "Stable"
  return (
    <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: bg, color }}>
      {label}
    </span>
  )
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <p className="text-[11px] uppercase tracking-widest font-semibold whitespace-nowrap" style={{ color: "var(--text3)" }}>
        {title}
      </p>
      <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
    </div>
  );
}

function Topbar({ clientName }: { clientName: string }) {
  return (
    <div className="flex items-center gap-2 px-8 h-14 bg-white text-[13px]" style={{ borderBottom: "1px solid var(--border)" }}>
      <Link href="/bcba" className="hover:underline" style={{ color: "var(--text3)" }}>My Clients</Link>
      <span style={{ color: "var(--border2)" }}>/</span>
      <span className="font-medium" style={{ color: "var(--text1)" }}>{clientName || "Client"}</span>
    </div>
  );
}

function TabBar({ active, onChange, isBCBAPro }: { active: BCBATab; onChange: (t: BCBATab) => void; isBCBAPro: boolean | null }) {
  const tabs: { id: BCBATab; label: string; proOnly?: boolean }[] = [
    { id: "overview",       label: "Overview" },
    { id: "notes",          label: "RBT Notes" },
    { id: "schedule",       label: "Schedule" },
    { id: "97153xp",        label: "97153XP" },
    { id: "supervision",    label: "Supervision Notes" },
    { id: "parent_training",  label: "Parent Training" },
    { id: "treatment_map",    label: "Treatment Map" },
    { id: "progress_report",  label: "Progress Report" },
    { id: "clinical_timeline", label: "Clinical Timeline" },
    { id: "reassessment",     label: "Assessment Tools" },
  ];
  return (
    <div className="flex border-b bg-white px-8 overflow-x-auto" style={{ borderColor: "var(--border)" }}>
      {tabs.map(t => {
        const isDisabled = t.proOnly && isBCBAPro === false;
        return (
          <button
            key={t.id}
            onClick={() => !isDisabled && onChange(t.id)}
            disabled={isDisabled}
            className="flex items-center gap-1.5 px-4 py-3 text-[13px] font-medium border-b-2 transition-colors whitespace-nowrap disabled:cursor-not-allowed"
            style={{
              borderColor: active === t.id ? "var(--teal)" : "transparent",
              color: isDisabled ? "var(--text3)" : active === t.id ? "var(--teal)" : "var(--text3)",
              opacity: isDisabled ? 0.6 : 1,
            }}
          >
            {t.label}
            {t.proOnly && isBCBAPro === false && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(27,168,160,0.12)", color: "var(--teal)" }}>
                Pro
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}


export default function BCBAClientPage() {
  const params = useParams();
  const router = useRouter();
  const clientId = params.clientId as string;
  const { data: session, status } = useSession();

  const [activeTab, setActiveTab] = useState<BCBATab>("overview");
  const [isBCBAPro, setIsBCBAPro] = useState<boolean | null>(null);

  const [client, setClient] = useState<any>(null);
  const [notes, setNotes] = useState<any[]>([]);
  const [supervisionNotes, setSupervisionNotes] = useState<any[]>([]);
  const [parentTrainingNotes, setParentTrainingNotes] = useState<any[]>([]);
  const [missingHours, setMissingHours] = useState<any[]>([]);
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 97153XP tab state
  const [xp97153Notes, setXp97153Notes] = useState<any[]>([]);
  const [xpSubTab, setXpSubTab] = useState<"generate" | "history">("generate");
  const [xpDate, setXpDate] = useState(new Date().toISOString().split("T")[0]);
  const [xpLocation, setXpLocation] = useState("");
  const [xpRbtContext, setXpRbtContext] = useState<{ empty: boolean; behaviors?: string[]; skills?: string[]; interventions?: string[]; activities?: string[] } | null>(null);
  const [xpContextLoading, setXpContextLoading] = useState(false);
  const [xpBcbaActions, setXpBcbaActions] = useState<string[]>([]);
  const [xpBcbaActionsOther, setXpBcbaActionsOther] = useState("");
  const [xpIntegrityConcerns, setXpIntegrityConcerns] = useState("");
  const [xpClientResponse, setXpClientResponse] = useState("");
  const [xpClientResponseOther, setXpClientResponseOther] = useState("");
  const [xpGenerating, setXpGenerating] = useState(false);
  const [xpGeneratedNote, setXpGeneratedNote] = useState("");
  const [xpGenError, setXpGenError] = useState("");
  const [xpNoteCopied, setXpNoteCopied] = useState(false);
  const [xpSaved, setXpSaved] = useState(false);
  const [xpExpandedNoteId, setXpExpandedNoteId] = useState<string | null>(null);

  // 97153XP new form state
  const [rbtBehaviorsReported, setRbtBehaviorsReported] = useState<string[]>([]);
  const [rbtInterventionsUsed, setRbtInterventionsUsed] = useState<string[]>([]);
  const [rbtProgramsWorked, setRbtProgramsWorked] = useState<string[]>([]);
  const [bcbaObservedPrograms, setBcbaObservedPrograms] = useState<string[]>([]);
  const [bcbaObservedBehaviors, setBcbaObservedBehaviors] = useState<string[]>([]);
  const [supervisionFocus, setSupervisionFocus] = useState<string[]>([]);
  const [integrityPrompting, setIntegrityPrompting] = useState<string>('');
  const [integrityReinforcement, setIntegrityReinforcement] = useState<string>('');
  const [integrityBehaviorReduction, setIntegrityBehaviorReduction] = useState<string>('');
  const [integrityDataCollection, setIntegrityDataCollection] = useState<string>('');
  const [bcbaActionsNew, setBcbaActionsNew] = useState<string[]>([]);
  const [feedbackToRbt, setFeedbackToRbt] = useState<string[]>([]);
  const [clientResponseNew, setClientResponseNew] = useState<string[]>([]);
  const [recommendations, setRecommendations] = useState<string[]>([]);
  const [narrativeStyle, setNarrativeStyle] = useState<string>('Insurance-Friendly');

  // Clinical profile editing
  const [editingProfile, setEditingProfile] = useState(false);
  const [editBehaviors, setEditBehaviors] = useState<{ name: string; topography: string; function: string }[]>([]);
  const [editInterventions, setEditInterventions] = useState<string[]>([]);
  const [editSkills, setEditSkills] = useState<string[]>([]);
  const [newBehaviorName, setNewBehaviorName] = useState("");
  const [newBehaviorTopography, setNewBehaviorTopography] = useState("");
  const [newBehaviorFunction, setNewBehaviorFunction] = useState("");
  const [newIntervention, setNewIntervention] = useState("");
  const [newSkill, setNewSkill] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [profileSaved, setProfileSaved] = useState(false);
  const [treatmentMapApproved, setTreatmentMapApproved] = useState(false);
  const [savingTreatmentMap, setSavingTreatmentMap] = useState(false);
  const [tmData, setTmData] = useState<{ maladaptive: any[]; replacement: any[] }>({ maladaptive: [], replacement: [] });
  const [tmLoading, setTmLoading] = useState(false);
  const [tmSaving, setTmSaving] = useState(false);
  const [tmSaved, setTmSaved] = useState(false);
  const [newTmBehavior, setNewTmBehavior] = useState({ name: "", function: "escape", status: "active" });
  const [newTmSkill, setNewTmSkill] = useState({ name: "", targetFunction: "escape" });

  // Invite RBT flow
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteExpiresAt, setInviteExpiresAt] = useState<string | null>(null);
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  // Progress Report tab state
  const prNarrativeRef = useRef("");
  const [prReports, setPrReports] = useState<any[]>([]);
  const [prGenerating, setPrGenerating] = useState(false);
  const [prNarrative, setPrNarrative] = useState("");
  const [prBehaviorTrends, setPrBehaviorTrends] = useState<any[]>([]);
  const [prSkillTrends, setPrSkillTrends] = useState<any[]>([]);
  const [prGoalProgress, setPrGoalProgress] = useState<any[]>([]);
  const [prServiceUtilization, setPrServiceUtilization] = useState<any>(null);
  const [prBehaviorWeeklyTable, setPrBehaviorWeeklyTable] = useState<any>({});
  const [prSkillWeeklyTable, setPrSkillWeeklyTable] = useState<any>({});
  const [prActiveTreatmentAreas, setPrActiveTreatmentAreas] = useState<any>(null);
  const [prClinicalBarriers, setPrClinicalBarriers] = useState<string[]>([]);
  const [prExpandedReport, setPrExpandedReport] = useState<string | null>(null);
  const [prStatus, setPrStatus] = useState("");
  const [prError, setPrError] = useState("");
  const [prSelectedMonth, setPrSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  // Reassessment tab state
  const [reassessStart, setReassessStart] = useState("");
  const [reassessEnd, setReassessEnd] = useState("");
  const [reassessNarrative, setReassessNarrative] = useState("");
  const [reassessGenerating, setReassessGenerating] = useState(false);
  const [reassessMeta, setReassessMeta] = useState<any>(null);
  const [reassessError, setReassessError] = useState("");
  const [reassessCopied, setReassessCopied] = useState(false);

  // Assessment Builder state
  const [abPeriodStart, setAbPeriodStart] = useState("");
  const [abPeriodEnd, setAbPeriodEnd] = useState("");
  const [abDocType, setAbDocType] = useState<"reassessment" | "assessment_update" | "medical_necessity_letter">("reassessment");
  const [abLoading, setAbLoading] = useState(false);
  const [abData, setAbData] = useState<any>(null);
  const [abError, setAbError] = useState("");
  const [abNarrative, setAbNarrative] = useState("");
  const [abNarrativeGenerating, setAbNarrativeGenerating] = useState(false);
  const [abNarrativeCopied, setAbNarrativeCopied] = useState(false);
  const [abNarrativeError, setAbNarrativeError] = useState("");

  // Clinical Timeline tab state
  const [timelineEntries, setTimelineEntries] = useState<any[]>([]);
  const [timelineFilter, setTimelineFilter] = useState("all");
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [expandedTimelineId, setExpandedTimelineId] = useState<string | null>(null);

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user) { router.push("/login"); return; }

    fetch('/api/bcba/subscription-status')
      .then(r => r.json())
      .then(d => setIsBCBAPro(!!d.isBCBAPro))
      .catch(() => setIsBCBAPro(false));

    loadAll();
  }, [clientId, status]);

  useEffect(() => {
    if (!clientId) return;
    if (activeTab === "progress_report") fetchPrReports();
    if (activeTab === "clinical_timeline") fetchTimeline();
    if (activeTab === "treatment_map" && tmData.maladaptive.length === 0) loadTreatmentMap();
  }, [activeTab, clientId]);

  async function loadAll() {
    const clientRes = await fetch(`/api/bcba/client/${clientId}`);
    if (!clientRes.ok) { router.push("/bcba"); return; }
    const { client: clientData } = await clientRes.json();
    setClient(clientData);

    const notesRes = await fetch(`/api/bcba/rbt-notes?clientId=${clientId}`);
    if (notesRes.ok) { const d = await notesRes.json(); setNotes(d.notes || []); }

    const supRes = await fetch(`/api/bcba/supervision-notes?clientId=${clientId}`);
    if (supRes.ok) { const d = await supRes.json(); setSupervisionNotes(d.notes || []); }

    const ptRes = await fetch(`/api/bcba/parent-training-notes?clientId=${clientId}`);
    if (ptRes.ok) { const d = await ptRes.json(); setParentTrainingNotes(d.notes || []); }

    const hoursRes = await fetch(`/api/bcba/missing-hours?clientId=${clientId}`);
    if (hoursRes.ok) { const d = await hoursRes.json(); setMissingHours(d.entries || []); }

    const xpRes = await fetch(`/api/bcba/97153xp-notes?clientId=${clientId}`);
    if (xpRes.ok) { const d = await xpRes.json(); setXp97153Notes(d.notes || []); }

    const tmRes = await fetch(`/api/bcba/treatment-map?clientId=${clientId}`);
    if (tmRes.ok) { const d = await tmRes.json(); setTreatmentMapApproved(!!d.treatmentMapApproved); }

    setLoading(false);
  }

  async function handleGenerateInvite() {
    setGeneratingInvite(true);
    try {
      const res = await fetch('/api/bcba/clients/generate-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      });
      const data = await res.json();
      if (res.ok) {
        setInviteCode(data.code);
        setInviteExpiresAt(data.expiresAt);
        setShowInviteModal(true);
      }
    } catch (err) {
      console.error('[bcba] generate invite error:', err);
    }
    setGeneratingInvite(false);
  }

  async function fetchPrReports() {
    try {
      const res = await fetch(`/api/progress-report?clientId=${clientId}`);
      if (res.ok) { const data = await res.json(); setPrReports(data.reports || []); }
    } catch {}
  }

  async function handleGenerateReassessment() {
    if (!reassessStart || !reassessEnd) return;
    setReassessGenerating(true);
    setReassessNarrative("");
    setReassessMeta(null);
    setReassessError("");
    try {
      const res = await fetch("/api/progress-report/reassessment-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, periodStart: reassessStart, periodEnd: reassessEnd }),
      });
      if (!res.ok) throw new Error("Failed to generate");
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        full += chunk;
        const metaIdx = full.indexOf("__REASSESS_META__");
        if (metaIdx !== -1) {
          setReassessNarrative(full.slice(0, metaIdx));
          try { setReassessMeta(JSON.parse(full.slice(metaIdx + "__REASSESS_META__".length))); } catch {}
          break;
        } else {
          setReassessNarrative(full);
        }
      }
    } catch {
      setReassessError("Failed to generate reassessment summary. Please try again.");
    } finally {
      setReassessGenerating(false);
    }
  }

  async function handleLoadAssessmentBuilder() {
    if (!abPeriodStart || !abPeriodEnd) return;
    setAbLoading(true);
    setAbData(null);
    setAbError("");
    try {
      const res = await fetch("/api/bcba/assessment-builder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, periodStart: abPeriodStart, periodEnd: abPeriodEnd, documentType: abDocType }),
      });
      if (!res.ok) throw new Error("Failed to load data");
      const json = await res.json();
      setAbData(json);
    } catch {
      setAbError("Failed to load assessment data. Please try again.");
    } finally {
      setAbLoading(false);
    }
  }

  async function handleGenerateAssessmentNarrative() {
    if (!abPeriodStart || !abPeriodEnd) return;
    setAbNarrativeGenerating(true);
    setAbNarrative("");
    setAbNarrativeError("");
    try {
      const res = await fetch("/api/progress-report/reassessment-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, periodStart: abPeriodStart, periodEnd: abPeriodEnd }),
      });
      if (!res.ok) throw new Error("Failed to generate");
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        full += chunk;
        const metaIdx = full.indexOf("__REASSESS_META__");
        if (metaIdx !== -1) {
          setAbNarrative(full.slice(0, metaIdx));
          break;
        } else {
          setAbNarrative(full);
        }
      }
    } catch {
      setAbNarrativeError("Failed to generate narrative. Please try again.");
    } finally {
      setAbNarrativeGenerating(false);
    }
  }

  async function handlePrGenerate() {
    const [year, month] = prSelectedMonth.split("-").map(Number);
    const periodStart = new Date(year, month - 1, 1).toISOString().split("T")[0];
    const periodEnd   = new Date(year, month, 0).toISOString().split("T")[0];
    const periodLabel = new Date(year, month - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });

    setPrGenerating(true); setPrNarrative(""); setPrBehaviorTrends([]); setPrSkillTrends([]);
    setPrGoalProgress([]); setPrStatus("Analyzing clinical data…"); setPrError("");
    prNarrativeRef.current = "";

    try {
      const res = await fetch("/api/progress-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, periodStart, periodEnd, periodLabel }),
      });
      if (!res.ok || !res.body) {
        const errData = await res.json().catch(() => ({}));
        setPrError(errData.error || "Generation failed."); return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (chunk.includes("__META__")) {
          const [text, metaStr] = chunk.split("__META__");
          if (text) { prNarrativeRef.current += text; setPrNarrative(prNarrativeRef.current); }
          try {
            const meta = JSON.parse(metaStr);
            if (meta.behaviorTrends)    setPrBehaviorTrends(meta.behaviorTrends);
            if (meta.skillTrends)       setPrSkillTrends(meta.skillTrends);
            if (meta.goalProgress)      setPrGoalProgress(meta.goalProgress);
            if (meta.serviceUtilization) setPrServiceUtilization(meta.serviceUtilization);
            if (meta.behaviorWeeklyTable) setPrBehaviorWeeklyTable(meta.behaviorWeeklyTable);
            if (meta.skillWeeklyTable)  setPrSkillWeeklyTable(meta.skillWeeklyTable);
            if (meta.activeTreatmentAreas) setPrActiveTreatmentAreas(meta.activeTreatmentAreas);
            if (meta.clinicalBarriers)  setPrClinicalBarriers(meta.clinicalBarriers);
            if (meta.error) setPrError(meta.error);
          } catch {}
        } else {
          prNarrativeRef.current += chunk;
          setPrNarrative(prNarrativeRef.current);
          setPrStatus("Generating clinical narrative…");
        }
      }
      setPrStatus(""); fetchPrReports();
    } catch { setPrError("Network error. Please try again."); }
    finally { setPrGenerating(false); }
  }

  async function fetchTimeline() {
    setTimelineLoading(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/timeline`);
      if (res.ok) { const data = await res.json(); setTimelineEntries(data.entries || []); }
    } catch {}
    setTimelineLoading(false);
  }

  function enterEditMode() {
    const cp = client?.clinical_profile || {};
    setEditBehaviors(
      (cp.maladaptiveBehaviors || []).map((b: any) =>
        typeof b === "string"
          ? { name: b, topography: "", function: "" }
          : { name: b?.name || "", topography: b?.topography || "", function: b?.function || b?.behaviorFunction || "" }
      )
    );
    setEditInterventions(
      (cp.interventions || []).map((i: any) => typeof i === "string" ? i : (i?.name || ""))
    );
    setEditSkills([
      ...(cp.replacementBehaviors || []).map((s: any) => typeof s === "string" ? s : (s?.name || "")),
      ...(cp.skillAcquisition || []).map((s: any) => typeof s === "string" ? s : (s?.name || "")),
    ]);
    setNewBehaviorName(""); setNewBehaviorTopography(""); setNewBehaviorFunction("");
    setNewIntervention(""); setNewSkill("");
    setSaveError(""); setProfileSaved(false);
    setEditingProfile(true);
  }

  function addBehavior() {
    if (!newBehaviorName.trim()) return;
    setEditBehaviors(prev => [...prev, { name: newBehaviorName.trim(), topography: newBehaviorTopography.trim(), function: newBehaviorFunction.trim() }]);
    setNewBehaviorName(""); setNewBehaviorTopography(""); setNewBehaviorFunction("");
  }

  function addIntervention() {
    if (!newIntervention.trim()) return;
    setEditInterventions(prev => [...prev, newIntervention.trim()]);
    setNewIntervention("");
  }

  function addSkill() {
    if (!newSkill.trim()) return;
    setEditSkills(prev => [...prev, newSkill.trim()]);
    setNewSkill("");
  }

  async function handleSaveProfile() {
    setSaving(true); setSaveError(""); setProfileSaved(false);
    try {
      const res = await fetch(`/api/bcba/client/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clinicalProfile: {
            maladaptiveBehaviors: editBehaviors,
            interventions: editInterventions,
            replacementBehaviors: editSkills,
            skillAcquisition: [],
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) { setSaveError(data.error || "Save failed"); return; }
      setClient((prev: any) => ({ ...prev, clinical_profile: data.client.clinical_profile }));
      setProfileSaved(true);
      setEditingProfile(false);
    } catch {
      setSaveError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleTreatmentMapApproval() {
    setSavingTreatmentMap(true);
    const newValue = !treatmentMapApproved;
    try {
      await fetch('/api/bcba/treatment-map', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, treatmentMapApproved: newValue }),
      });
      setTreatmentMapApproved(newValue);
    } catch {}
    finally { setSavingTreatmentMap(false); }
  }

  async function loadTreatmentMap() {
    setTmLoading(true);
    try {
      const res = await fetch(`/api/bcba/treatment-map?clientId=${clientId}`);
      if (res.ok) {
        const d = await res.json();
        setTmData(d.treatmentMapData || { maladaptive: [], replacement: [] });
        setTreatmentMapApproved(!!d.treatmentMapApproved);
      }
    } catch {}
    finally { setTmLoading(false); }
  }

  async function saveTreatmentMap(data: { maladaptive: any[]; replacement: any[] }) {
    setTmSaving(true);
    try {
      await fetch('/api/bcba/treatment-map', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, treatmentMapData: data, treatmentMapApproved }),
      });
      setTmSaved(true);
      setTimeout(() => setTmSaved(false), 2000);
    } catch {}
    finally { setTmSaving(false); }
  }

  async function fetchRbtSessionContext(date: string) {
    if (!date) return;
    setXpContextLoading(true);
    setXpRbtContext(null);
    try {
      const res = await fetch(`/api/bcba/rbt-session-context?clientId=${clientId}&date=${date}`);
      if (!res.ok) { setXpRbtContext({ empty: true }); return; }
      const json = await res.json();
      setXpRbtContext(json);
      if (!json.empty) {
        setRbtBehaviorsReported(Array.isArray(json.behaviors) ? json.behaviors : []);
        setRbtInterventionsUsed(Array.isArray(json.interventions) ? json.interventions : []);
        setRbtProgramsWorked(Array.isArray(json.skills) ? json.skills : []);
      }
    } catch {
      setXpRbtContext({ empty: true });
    } finally {
      setXpContextLoading(false);
    }
  }

  async function handleGenerate97153XP() {
    setXpGenerating(true);
    setXpGenError("");
    setXpGeneratedNote("");
    setXpSaved(false);
    try {
      const res = await fetch("/api/bcba/generate-97153xp-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          sessionDate: xpDate,
          location: xpLocation,
          rbtSessionContext: xpRbtContext,
          rbtBehaviorsReported,
          rbtInterventionsUsed,
          rbtProgramsWorked,
          bcbaObservedPrograms,
          bcbaObservedBehaviors,
          supervisionFocus,
          integrityReview: {
            prompting: integrityPrompting,
            reinforcement: integrityReinforcement,
            behaviorReduction: integrityBehaviorReduction,
            dataCollection: integrityDataCollection,
          },
          bcbaActionsPerformed: bcbaActionsNew,
          feedbackToRbt,
          clientResponseDuringOverlap: clientResponseNew,
          recommendations,
          narrativeStyle,
        }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setXpGenError(data.error || "Generation failed.");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (chunk.includes("__META__")) {
          const parts = chunk.split("__META__");
          if (parts[0]) { fullText += parts[0]; setXpGeneratedNote(fullText); }
          try { const meta = JSON.parse(parts[1]); if (meta.error) { setXpGenError(meta.error); return; } setXpSaved(!!meta.saved); } catch {}
          break outer;
        }
        fullText += chunk;
        setXpGeneratedNote(fullText);
      }
    } catch {
      setXpGenError("Network error. Please try again.");
    } finally {
      setXpGenerating(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen" style={{ background: "var(--bg)" }}>
        <Topbar clientName="" />
        <div className="px-8 py-8"><p className="text-[13px]" style={{ color: "var(--text3)" }}>Loading…</p></div>
      </main>
    );
  }

  const cp = client?.clinical_profile || {};
  const prHasData = prBehaviorTrends.length > 0 || prSkillTrends.length > 0 || prGoalProgress.length > 0;
  const prImproving = prBehaviorTrends.filter((b: any) => b.trend === "improving").length;
  const prWorsening = prBehaviorTrends.filter((b: any) => b.trend === "worsening").length;
  const prSkillsImproving = prSkillTrends.filter((s: any) => s.trend === "improving").length;
  const filteredTimelineEntries = timelineFilter === "all"
    ? timelineEntries
    : timelineEntries.filter((e: any) => {
        const typeMap: Record<string, string> = {
          progress_reports: "monthly_progress_report",
          assessments: "assessment",
          reassessments: "reassessment_summary",
          protocol_changes: "protocol_change",
        };
        return e.type === typeMap[timelineFilter];
      });

  return (
    <main className="min-h-screen" style={{ background: "var(--bg)", fontFamily: "var(--font-dm-sans, sans-serif)" }}>
      <Topbar clientName={client?.client_name || "Client"} />

      {/* Client header */}
      <div className="px-8 py-5 bg-white border-b" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-4">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold text-white"
            style={{ background: "linear-gradient(135deg, var(--teal), var(--sky))" }}
          >
            {(client?.client_name || client?.internal_code || "?")[0].toUpperCase()}
          </div>
          <div className="flex-1">
            <p className="text-[16px] font-semibold" style={{ color: "var(--text1)" }}>{client?.client_name || client?.internal_code}</p>
            <p className="text-[13px]" style={{ color: "var(--text3)" }}>
              {cp.diagnosis?.join(", ") || ""}
            </p>
          </div>
          {!client?.rbt_id && (
            <button
              onClick={handleGenerateInvite}
              disabled={generatingInvite}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-60 hover:opacity-90 transition-opacity"
              style={{ background: "var(--teal)" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
              </svg>
              {generatingInvite ? "Generating…" : "Invite RBT"}
            </button>
          )}
        </div>
      </div>

      <TabBar active={activeTab} onChange={setActiveTab} isBCBAPro={isBCBAPro} />

      <div className="px-8 py-6 max-w-5xl">

        {/* ── Overview Tab ── */}
        {activeTab === "overview" && (
          <div>

            {/* Edit mode */}
            {editingProfile ? (
              <div className="space-y-5 max-w-[700px]">
                <div className="flex items-center justify-between">
                  <p className="text-[15px] font-semibold" style={{ color: "var(--text1)" }}>Edit Clinical Profile</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setEditingProfile(false)}
                      className="px-4 py-2 rounded-lg text-[13px] font-medium border transition-colors hover:border-gray-400"
                      style={{ borderColor: "var(--border)", color: "var(--text2)" }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveProfile}
                      disabled={saving}
                      className="px-4 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-60 hover:opacity-90 transition-opacity"
                      style={{ background: "var(--teal)" }}
                    >
                      {saving ? "Saving…" : "Save Changes"}
                    </button>
                  </div>
                </div>
                {saveError && <p className="text-[13px] text-red-500">{saveError}</p>}

                {/* Section 1: Maladaptive Behaviors */}
                <div className="bg-white rounded-[10px] border p-5" style={{ borderColor: "var(--border)" }}>
                  <SectionHeader title="Maladaptive Behaviors" />
                  <div className="space-y-2 mb-4">
                    {editBehaviors.length === 0 && (
                      <p className="text-[13px]" style={{ color: "var(--text3)" }}>No behaviors yet.</p>
                    )}
                    {editBehaviors.map((b, i) => (
                      <div key={i} className="flex items-start gap-2 px-4 py-3 rounded-xl" style={{ background: "#FEF3E2", border: "1px solid #F6AD5580" }}>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold" style={{ color: "#92400E" }}>{b.name}</p>
                          {b.topography && <p className="text-[12px]" style={{ color: "#B7791F" }}>Topography: {b.topography}</p>}
                          {b.function && <p className="text-[12px]" style={{ color: "#B7791F" }}>Function: {b.function}</p>}
                        </div>
                        <button
                          onClick={() => setEditBehaviors(prev => prev.filter((_, idx) => idx !== i))}
                          className="text-[18px] leading-none flex-shrink-0 hover:opacity-60 transition-opacity"
                          style={{ color: "#B7791F" }}
                        >×</button>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2 p-3 rounded-lg border border-dashed" style={{ borderColor: "var(--border)" }}>
                    <p className="text-[11px] uppercase tracking-wide font-semibold mb-1" style={{ color: "var(--text3)" }}>Add Behavior</p>
                    <input
                      placeholder="Behavior name (required)"
                      value={newBehaviorName}
                      onChange={e => setNewBehaviorName(e.target.value)}
                      className="w-full border rounded-lg px-3 py-2 text-[13px] focus:outline-none"
                      style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                    />
                    <input
                      placeholder="Topography (optional)"
                      value={newBehaviorTopography}
                      onChange={e => setNewBehaviorTopography(e.target.value)}
                      className="w-full border rounded-lg px-3 py-2 text-[13px] focus:outline-none"
                      style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                    />
                    <input
                      placeholder="Function (optional)"
                      value={newBehaviorFunction}
                      onChange={e => setNewBehaviorFunction(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && addBehavior()}
                      className="w-full border rounded-lg px-3 py-2 text-[13px] focus:outline-none"
                      style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                    />
                    <button
                      onClick={addBehavior}
                      disabled={!newBehaviorName.trim()}
                      className="px-4 py-1.5 rounded-lg text-[12px] font-semibold text-white disabled:opacity-40"
                      style={{ background: "var(--teal)" }}
                    >
                      Add Behavior
                    </button>
                  </div>
                </div>

                {/* Section 2: Approved Interventions */}
                <div className="bg-white rounded-[10px] border p-5" style={{ borderColor: "var(--border)" }}>
                  <SectionHeader title="Approved Interventions" />
                  <div className="flex flex-wrap gap-2 mb-4">
                    {editInterventions.length === 0 && (
                      <p className="text-[13px]" style={{ color: "var(--text3)" }}>No interventions yet.</p>
                    )}
                    {editInterventions.map((item, i) => (
                      <span key={i} className="flex items-center gap-1 text-[12px] font-medium px-2.5 py-1 rounded-full" style={{ background: "var(--teal-light)", color: "var(--teal)" }}>
                        {item}
                        <button onClick={() => setEditInterventions(prev => prev.filter((_, idx) => idx !== i))} className="ml-0.5 text-[14px] leading-none hover:opacity-60">×</button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      placeholder="Add intervention"
                      value={newIntervention}
                      onChange={e => setNewIntervention(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && addIntervention()}
                      className="flex-1 border rounded-lg px-3 py-2 text-[13px] focus:outline-none"
                      style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                    />
                    <button
                      onClick={addIntervention}
                      disabled={!newIntervention.trim()}
                      className="px-4 py-2 rounded-lg text-[12px] font-semibold text-white disabled:opacity-40"
                      style={{ background: "var(--teal)" }}
                    >Add</button>
                  </div>
                </div>

                {/* Section 3: Replacement Skills */}
                <div className="bg-white rounded-[10px] border p-5" style={{ borderColor: "var(--border)" }}>
                  <SectionHeader title="Replacement Skills &amp; Skill Acquisition" />
                  <div className="flex flex-wrap gap-2 mb-4">
                    {editSkills.length === 0 && (
                      <p className="text-[13px]" style={{ color: "var(--text3)" }}>No skills yet.</p>
                    )}
                    {editSkills.map((s, i) => (
                      <span key={i} className="flex items-center gap-1 text-[12px] font-medium px-2.5 py-1 rounded-full" style={{ background: "#EFF6FF", color: "#1D4ED8" }}>
                        {s}
                        <button onClick={() => setEditSkills(prev => prev.filter((_, idx) => idx !== i))} className="ml-0.5 text-[14px] leading-none hover:opacity-60">×</button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      placeholder="Add skill"
                      value={newSkill}
                      onChange={e => setNewSkill(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && addSkill()}
                      className="flex-1 border rounded-lg px-3 py-2 text-[13px] focus:outline-none"
                      style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                    />
                    <button
                      onClick={addSkill}
                      disabled={!newSkill.trim()}
                      className="px-4 py-2 rounded-lg text-[12px] font-semibold text-white disabled:opacity-40"
                      style={{ background: "var(--teal)" }}
                    >Add</button>
                  </div>
                </div>
              </div>
            ) : (

              /* Read mode */
              <div>
                <div className="flex items-center justify-end gap-2 mb-4">
                  {profileSaved && (
                    <span className="mr-1 text-[13px] font-medium" style={{ color: "#16A34A" }}>Saved ✓</span>
                  )}
                  <Link
                    href={`/upload-assessment?clientId=${clientId}`}
                    className="px-4 py-2 rounded-lg text-[13px] font-semibold border hover:opacity-80 transition-opacity"
                    style={{ borderColor: "var(--teal)", color: "var(--teal)", background: "white" }}
                  >
                    Upload / Update Assessment
                  </Link>
                  <button
                    onClick={enterEditMode}
                    className="px-4 py-2 rounded-lg text-[13px] font-semibold text-white hover:opacity-90 transition-opacity"
                    style={{ background: "var(--teal)" }}
                  >
                    Edit Clinical Profile
                  </button>
                </div>
                <div className="grid grid-cols-[280px_1fr] gap-5">

                  {/* Left column */}
                  <div className="space-y-5">

                    {/* Clinical Snapshot */}
                    <div className="bg-white rounded-[10px] border p-5" style={{ borderColor: "var(--border)" }}>
                      <SectionHeader title="Clinical Snapshot" />
                      <div className="space-y-3">
                        {[
                          { label: "Diagnosis", value: cp.diagnosis?.join(", ") || "—" },
                          { label: "Maladaptive Behaviors", value: cp.maladaptiveBehaviors?.length || 0 },
                          { label: "Approved Interventions", value: cp.interventions?.length || 0 },
                          { label: "Replacement Behaviors", value: (cp.replacementBehaviors?.length || 0) + (cp.skillAcquisition?.length || 0) },
                          { label: "Reinforcers", value: cp.reinforcers?.length || 0 },
                        ].map(({ label, value }) => (
                          <div key={label} className="flex justify-between items-start gap-4">
                            <span className="text-[13px]" style={{ color: "var(--text2)" }}>{label}</span>
                            <span className="text-[13px] font-medium text-right" style={{ color: "var(--text1)" }}>{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Reinforcers */}
                    <div className="bg-white rounded-[10px] border p-5" style={{ borderColor: "var(--border)" }}>
                      <SectionHeader title="Reinforcers" />
                      {cp.reinforcers?.length ? (
                        <div className="mb-3">
                          <p className="text-[11px] uppercase tracking-wide font-semibold mb-1.5" style={{ color: "var(--text3)" }}>Tangibles</p>
                          <div className="flex flex-wrap gap-1.5">
                            {cp.reinforcers.map((r: string, i: number) => (
                              <span key={i} className="text-[12px] px-2.5 py-1 rounded-full" style={{ background: "var(--teal-light)", color: "var(--teal)" }}>{r}</span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {cp.homeActivities?.length ? (
                        <div>
                          <p className="text-[11px] uppercase tracking-wide font-semibold mb-1.5" style={{ color: "var(--text3)" }}>Activities</p>
                          <div className="flex flex-wrap gap-1.5">
                            {cp.homeActivities.map((a: string, i: number) => (
                              <span key={i} className="text-[12px] px-2.5 py-1 rounded-full" style={{ background: "var(--teal-light)", color: "var(--teal)" }}>{a}</span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {!cp.reinforcers?.length && !cp.homeActivities?.length && (
                        <p className="text-[13px]" style={{ color: "var(--text3)" }}>No reinforcers in profile.</p>
                      )}
                    </div>

                  </div>

                  {/* Right column */}
                  <div className="space-y-5">

                    {/* Maladaptive Behaviors */}
                    <div className="bg-white rounded-[10px] border p-5" style={{ borderColor: "var(--border)" }}>
                      <SectionHeader title="Maladaptive Behaviors" />
                      {!cp.maladaptiveBehaviors?.length ? (
                        <p className="text-[13px]" style={{ color: "var(--text3)" }}>No behaviors recorded.</p>
                      ) : (
                        <div className="space-y-2">
                          {cp.maladaptiveBehaviors.map((b: any, i: number) => {
                            const name = typeof b === "string" ? b : (b?.name || "");
                            const topography = typeof b === "object" ? (b?.topography || "") : "";
                            const fn = typeof b === "object" ? (b?.function || b?.behaviorFunction || "") : "";
                            return (
                              <div key={i} className="px-4 py-3 rounded-xl" style={{ background: "#FEF3E2", border: "1px solid #F6AD5580" }}>
                                <p className="text-[13px] font-semibold" style={{ color: "#92400E" }}>{name}</p>
                                {topography && <p className="text-[12px] mt-0.5" style={{ color: "#B7791F" }}><span className="font-medium">Topography:</span> {topography}</p>}
                                {fn && <p className="text-[12px]" style={{ color: "#B7791F" }}><span className="font-medium">Function:</span> {fn}</p>}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Approved Interventions */}
                    <div className="bg-white rounded-[10px] border p-5" style={{ borderColor: "var(--border)" }}>
                      <SectionHeader title="Approved Interventions" />
                      {!cp.interventions?.length ? (
                        <p className="text-[13px]" style={{ color: "var(--text3)" }}>No interventions in profile.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {cp.interventions.map((item: any, i: number) => (
                            <span key={i} className="text-[12px] font-medium px-2.5 py-1 rounded-full" style={{ background: "var(--teal-light)", color: "var(--teal)" }}>
                              {typeof item === "string" ? item : (item?.name || "")}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Replacement Skills */}
                    {(cp.replacementBehaviors?.length || cp.skillAcquisition?.length) ? (
                      <div className="bg-white rounded-[10px] border p-5" style={{ borderColor: "var(--border)" }}>
                        <SectionHeader title="Replacement Skills &amp; Skill Acquisition" />
                        <div className="flex flex-wrap gap-2">
                          {[...(cp.replacementBehaviors || []), ...(cp.skillAcquisition || [])].map((s: any, i: number) => (
                            <span key={i} className="text-[12px] font-medium px-2.5 py-1 rounded-full" style={{ background: "#EFF6FF", color: "#1D4ED8" }}>
                              {typeof s === "string" ? s : (s?.name || "")}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                  </div>
                </div>
              </div>
            )}

          </div>
        )}

        {/* ── RBT Notes Tab ── */}
        {activeTab === "notes" && (
          <div className="space-y-4">
            {notes.length === 0 ? (
              <p className="text-[13px]" style={{ color: "var(--text3)" }}>No session notes from the RBT yet.</p>
            ) : notes.map(note => {
              const isExpanded = expandedNoteId === note.id;
              const dateLabel = note.session_date
                ? new Date(note.session_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                : new Date(note.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
              const reviewed = note.review_status === "reviewed";
              const behaviors: string[] = Array.isArray(note.behaviors_addressed)
                ? note.behaviors_addressed.map((b: any) => typeof b === "string" ? b : (b?.name || "")).filter(Boolean)
                : [];
              const skills: string[] = Array.isArray(note.skills_addressed)
                ? note.skills_addressed.map((s: any) => typeof s === "string" ? s : (s?.name || "")).filter(Boolean)
                : [];
              return (
                <div key={note.id} className="bg-white rounded-xl border p-5" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>{dateLabel}</p>
                      <span
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={reviewed
                          ? { background: "#DCFCE7", color: "#15803D" }
                          : { background: "#FEF3C7", color: "#92400E" }
                        }
                      >
                        {reviewed ? "Reviewed" : "Pending"}
                      </span>
                    </div>
                    <button
                      onClick={() => setExpandedNoteId(isExpanded ? null : note.id)}
                      className="text-[12px] font-medium hover:underline flex-shrink-0"
                      style={{ color: "var(--teal)" }}
                    >
                      {isExpanded ? "Collapse" : "Expand"}
                    </button>
                  </div>
                  {(behaviors.length > 0 || skills.length > 0) && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {behaviors.map((b, i) => (
                        <span key={i} className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: "#FEF3E2", color: "#92400E" }}>{b}</span>
                      ))}
                      {skills.map((s, i) => (
                        <span key={i} className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: "#EFF6FF", color: "#1D4ED8" }}>{s}</span>
                      ))}
                    </div>
                  )}
                  {!isExpanded && (
                    <p className="text-[12px] line-clamp-2" style={{ color: "var(--text3)" }}>
                      {(note.note_text || "").slice(0, 120)}…
                    </p>
                  )}
                  {isExpanded && (
                    <p className="text-[13px] leading-7 whitespace-pre-wrap mt-2" style={{ color: "var(--text2)" }}>
                      {note.note_text}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Schedule Tab ── */}
        {activeTab === "schedule" && (
          <div>
            {missingHours.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-[14px] font-medium mb-1" style={{ color: "var(--text1)" }}>No missed hours recorded</p>
                <p className="text-[13px]" style={{ color: "var(--text3)" }}>Missed session data will appear here as the RBT records it.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {missingHours.map(entry => (
                  <div key={entry.id} className="bg-white rounded-xl border p-4" style={{ borderColor: "var(--border)" }}>
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>{entry.date}</p>
                        <p className="text-[12px] mt-0.5" style={{ color: "var(--text3)" }}>{entry.reason}</p>
                        {entry.notes && <p className="text-[12px] mt-1" style={{ color: "var(--text2)" }}>{entry.notes}</p>}
                      </div>
                      <span className="text-[13px] font-semibold" style={{ color: "#DC2626" }}>{entry.hours}h missed</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── 97153XP Tab ── */}
        {activeTab === "97153xp" && (
          <div>
            <div className="flex gap-1 mb-5 border-b" style={{ borderColor: "var(--border)" }}>
              {(["generate", "history"] as const).map(st => (
                <button
                  key={st}
                  onClick={() => setXpSubTab(st)}
                  className="px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors -mb-px"
                  style={{
                    borderColor: xpSubTab === st ? "var(--teal)" : "transparent",
                    color: xpSubTab === st ? "var(--teal)" : "var(--text3)",
                  }}
                >
                  {st === "generate" ? "Generate Note" : "Note History"}
                </button>
              ))}
            </div>

            {xpSubTab === "generate" && (
              <div className="space-y-5 max-w-[700px]">
                <div className="bg-white rounded-xl border p-6 space-y-8" style={{ borderColor: "var(--border)" }}>
                  <p className="text-[15px] font-semibold" style={{ color: "var(--text1)" }}>New 97153XP Note — BCBA Overlap / Implementation Support</p>

                  {/* SECTION 1 — Session Information */}
                  <div>
                    <SectionHeader title="Section 1 — Session Information" />
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Date</label>
                        <input
                          type="date"
                          value={xpDate}
                          onChange={e => { setXpDate(e.target.value); setXpRbtContext(null); setRbtBehaviorsReported([]); setRbtInterventionsUsed([]); setRbtProgramsWorked([]); fetchRbtSessionContext(e.target.value); }}
                          className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
                          style={{ borderColor: "var(--border)", color: "var(--text1)" }}
                        />
                      </div>
                      <div>
                        <label className="block text-[12px] font-medium mb-1.5" style={{ color: "var(--text2)" }}>Location</label>
                        <select
                          value={xpLocation}
                          onChange={e => setXpLocation(e.target.value)}
                          className="w-full border rounded-xl px-4 py-2.5 text-[13px] focus:outline-none"
                          style={{ borderColor: "var(--border)", color: xpLocation ? "var(--text1)" : "var(--text3)" }}
                        >
                          <option value="">Select location…</option>
                          <option value="home">Home</option>
                          <option value="clinic">Clinic</option>
                          <option value="school">School</option>
                          <option value="telehealth">Telehealth</option>
                          <option value="community">Community</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* SECTION 2 — Shared Information (auto-populated from RBT) */}
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-[11px] uppercase tracking-widest font-semibold" style={{ color: "var(--text3)" }}>Section 2 — Shared Information</p>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "#FEF3C7", color: "#92400E" }}>✦ Auto-filled</span>
                    </div>
                    <div className="flex-1 h-px mb-4" style={{ background: "var(--border)" }} />
                    {xpContextLoading && <p className="text-[12px] mb-3" style={{ color: "var(--text3)" }}>Loading RBT session data…</p>}
                    {!xpContextLoading && xpRbtContext === null && (
                      <p className="text-[12px] mb-3 px-3 py-2 rounded-lg" style={{ background: "#F9FAFB", color: "var(--text3)", border: "1px dashed var(--border)" }}>
                        Select a date above to auto-fill from the RBT's session note
                      </p>
                    )}
                    {!xpContextLoading && xpRbtContext?.empty && (
                      <p className="text-[12px] mb-3" style={{ color: "var(--text3)" }}>No RBT session note found for this date — enter manually below.</p>
                    )}

                    <div className="space-y-5">
                      <div>
                        <p className="text-[12px] font-medium mb-2" style={{ color: "var(--text2)" }}>Behaviors Reported by RBT</p>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                          {XP_BEHAVIORS.map(opt => (
                            <label key={opt} className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={rbtBehaviorsReported.includes(opt)}
                                onChange={() => setRbtBehaviorsReported(prev => prev.includes(opt) ? prev.filter(x => x !== opt) : [...prev, opt])}
                                className="flex-shrink-0"
                                style={{ accentColor: "var(--teal)" }}
                              />
                              <span className="text-[13px]" style={{ color: "var(--text1)" }}>
                                {opt}
                                {rbtBehaviorsReported.includes(opt) && <span className="text-xs text-amber-400 ml-1">✦ Reported by RBT</span>}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-[12px] font-medium mb-2" style={{ color: "var(--text2)" }}>Interventions Used by RBT</p>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                          {XP_INTERVENTIONS.map(opt => (
                            <label key={opt} className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={rbtInterventionsUsed.includes(opt)}
                                onChange={() => setRbtInterventionsUsed(prev => prev.includes(opt) ? prev.filter(x => x !== opt) : [...prev, opt])}
                                className="flex-shrink-0"
                                style={{ accentColor: "var(--teal)" }}
                              />
                              <span className="text-[13px]" style={{ color: "var(--text1)" }}>
                                {opt}
                                {rbtInterventionsUsed.includes(opt) && <span className="text-xs text-amber-400 ml-1">✦ Used by RBT</span>}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-[12px] font-medium mb-2" style={{ color: "var(--text2)" }}>Programs Worked on by RBT</p>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                          {XP_PROGRAMS.map(opt => (
                            <label key={opt} className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={rbtProgramsWorked.includes(opt)}
                                onChange={() => setRbtProgramsWorked(prev => prev.includes(opt) ? prev.filter(x => x !== opt) : [...prev, opt])}
                                className="flex-shrink-0"
                                style={{ accentColor: "var(--teal)" }}
                              />
                              <span className="text-[13px]" style={{ color: "var(--text1)" }}>
                                {opt}
                                {rbtProgramsWorked.includes(opt) && <span className="text-xs text-amber-400 ml-1">✦ Worked on by RBT</span>}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* SECTION 3 — BCBA Observation */}
                  <div>
                    <SectionHeader title="Section 3 — BCBA Observation" />
                    <div className="space-y-5">
                      <div>
                        <p className="text-[12px] font-medium mb-2" style={{ color: "var(--text2)" }}>Programs Observed</p>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                          {XP_PROGRAMS.map(opt => (
                            <label key={opt} className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={bcbaObservedPrograms.includes(opt)}
                                onChange={() => setBcbaObservedPrograms(prev => prev.includes(opt) ? prev.filter(x => x !== opt) : [...prev, opt])}
                                className="flex-shrink-0"
                                style={{ accentColor: "var(--teal)" }}
                              />
                              <span className="text-[13px]" style={{ color: "var(--text1)" }}>
                                {opt}
                                {bcbaObservedPrograms.includes(opt) && <span className="text-xs text-teal-400 ml-1">✦ Observed by BCBA</span>}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-[12px] font-medium mb-2" style={{ color: "var(--text2)" }}>Behaviors Observed</p>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                          {XP_BEHAVIORS.map(opt => (
                            <label key={opt} className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={bcbaObservedBehaviors.includes(opt)}
                                onChange={() => setBcbaObservedBehaviors(prev => prev.includes(opt) ? prev.filter(x => x !== opt) : [...prev, opt])}
                                className="flex-shrink-0"
                                style={{ accentColor: "var(--teal)" }}
                              />
                              <span className="text-[13px]" style={{ color: "var(--text1)" }}>
                                {opt}
                                {bcbaObservedBehaviors.includes(opt) && <span className="text-xs text-teal-400 ml-1">✦ Observed by BCBA</span>}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* SECTION 4 — Supervision Focus */}
                  <div>
                    <SectionHeader title="Section 4 — Supervision Focus" />
                    <p className="text-[12px] mb-3" style={{ color: "var(--text3)" }}>What did the BCBA specifically come to observe or address?</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                      {XP_SUPERVISION_FOCUS.map(opt => (
                        <label key={opt} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={supervisionFocus.includes(opt)}
                            onChange={() => setSupervisionFocus(prev => prev.includes(opt) ? prev.filter(x => x !== opt) : [...prev, opt])}
                            className="flex-shrink-0"
                            style={{ accentColor: "var(--teal)" }}
                          />
                          <span className="text-[13px]" style={{ color: "var(--text1)" }}>{opt}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* SECTION 5 — Treatment Integrity Review */}
                  <div>
                    <SectionHeader title="Section 5 — Treatment Integrity Review" />
                    <div className="space-y-3">
                      {[
                        { label: "Prompting Procedures", value: integrityPrompting, set: setIntegrityPrompting },
                        { label: "Reinforcement Procedures", value: integrityReinforcement, set: setIntegrityReinforcement },
                        { label: "Behavior Reduction Procedures", value: integrityBehaviorReduction, set: setIntegrityBehaviorReduction },
                        { label: "Data Collection", value: integrityDataCollection, set: setIntegrityDataCollection },
                      ].map(({ label, value, set }) => (
                        <div key={label} className="flex items-center gap-4">
                          <span className="text-[13px] w-52 flex-shrink-0" style={{ color: "var(--text1)" }}>{label}</span>
                          <div className="flex gap-2">
                            {XP_INTEGRITY_OPTIONS.map(opt => (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => set(value === opt ? '' : opt)}
                                className="px-3 py-1.5 rounded-lg border text-[11px] font-medium transition-colors"
                                style={{
                                  background: value === opt ? (opt === "Needs Improvement" ? "#FEF3C7" : opt === "Meets Expectations" ? "#DCFCE7" : "var(--teal-light)") : "white",
                                  borderColor: value === opt ? (opt === "Needs Improvement" ? "#F59E0B" : opt === "Meets Expectations" ? "#16A34A" : "var(--teal)") : "var(--border)",
                                  color: value === opt ? (opt === "Needs Improvement" ? "#92400E" : opt === "Meets Expectations" ? "#15803D" : "var(--teal)") : "var(--text3)",
                                }}
                              >
                                {opt}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* SECTION 6 — BCBA Actions Performed */}
                  <div>
                    <SectionHeader title="Section 6 — BCBA Actions Performed" />
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                      {XP_BCBA_ACTIONS_NEW.map(opt => (
                        <label key={opt} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={bcbaActionsNew.includes(opt)}
                            onChange={() => setBcbaActionsNew(prev => prev.includes(opt) ? prev.filter(x => x !== opt) : [...prev, opt])}
                            className="flex-shrink-0"
                            style={{ accentColor: "var(--teal)" }}
                          />
                          <span className="text-[13px]" style={{ color: "var(--text1)" }}>{opt}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* SECTION 7 — Feedback Provided to RBT */}
                  <div>
                    <SectionHeader title="Section 7 — Feedback Provided to RBT" />
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                      {XP_FEEDBACK_TO_RBT.map(opt => (
                        <label key={opt} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={feedbackToRbt.includes(opt)}
                            onChange={() => setFeedbackToRbt(prev => prev.includes(opt) ? prev.filter(x => x !== opt) : [...prev, opt])}
                            className="flex-shrink-0"
                            style={{ accentColor: "var(--teal)" }}
                          />
                          <span className="text-[13px]" style={{ color: "var(--text1)" }}>{opt}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* SECTION 8 — Client Response During Overlap */}
                  <div>
                    <SectionHeader title="Section 8 — Client Response During Overlap" />
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                      {XP_CLIENT_RESPONSE_NEW.map(opt => (
                        <label key={opt} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={clientResponseNew.includes(opt)}
                            onChange={() => setClientResponseNew(prev => prev.includes(opt) ? prev.filter(x => x !== opt) : [...prev, opt])}
                            className="flex-shrink-0"
                            style={{ accentColor: "var(--teal)" }}
                          />
                          <span className="text-[13px]" style={{ color: "var(--text1)" }}>{opt}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* SECTION 9 — Recommendations */}
                  <div>
                    <SectionHeader title="Section 9 — Recommendations" />
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                      {XP_RECOMMENDATIONS.map(opt => (
                        <label key={opt} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={recommendations.includes(opt)}
                            onChange={() => setRecommendations(prev => prev.includes(opt) ? prev.filter(x => x !== opt) : [...prev, opt])}
                            className="flex-shrink-0"
                            style={{ accentColor: "var(--teal)" }}
                          />
                          <span className="text-[13px]" style={{ color: "var(--text1)" }}>
                            {opt}
                            {recommendations.includes(opt) && <span className="text-xs text-teal-400 ml-1">✦ Recommended by BCBA</span>}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* SECTION 10 — Notes Generator Settings */}
                  <div>
                    <SectionHeader title="Section 10 — Notes Generator Settings" />
                    <div className="flex flex-wrap gap-2">
                      {XP_NARRATIVE_STYLES.map(opt => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => setNarrativeStyle(opt)}
                          className="px-4 py-2 rounded-xl border text-[12px] font-medium transition-colors"
                          style={{
                            background: narrativeStyle === opt ? "var(--teal)" : "white",
                            borderColor: narrativeStyle === opt ? "var(--teal)" : "var(--border)",
                            color: narrativeStyle === opt ? "white" : "var(--text2)",
                          }}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>

                  {xpGenError && (
                    <p className="text-[12px] px-3 py-2 rounded-lg border" style={{ background: "#FEF2F2", borderColor: "#FECACA", color: "#DC2626" }}>
                      {xpGenError}
                    </p>
                  )}

                  <button
                    onClick={handleGenerate97153XP}
                    disabled={!xpDate || !xpLocation || bcbaActionsNew.length === 0 || clientResponseNew.length === 0 || xpGenerating}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: "var(--teal)" }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/>
                    </svg>
                    {xpGenerating ? "Generating…" : "Generate 97153XP Note"}
                  </button>
                  {(!xpDate || !xpLocation || bcbaActionsNew.length === 0 || clientResponseNew.length === 0) && !xpGenerating && (
                    <p className="text-[12px]" style={{ color: "var(--text3)" }}>
                      Complete: date, location, at least one BCBA action, and client response.
                    </p>
                  )}
                </div>

                {xpGeneratedNote && (
                  <div className="bg-white rounded-xl border p-6" style={{ borderColor: "var(--border)" }}>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>Generated Note (97153XP)</p>
                      <div className="flex items-center gap-3">
                        {xpSaved && (
                          <span className="text-[12px] font-medium" style={{ color: "#16A34A" }}>✓ Saved</span>
                        )}
                        <button
                          onClick={() => { navigator.clipboard.writeText(xpGeneratedNote); setXpNoteCopied(true); setTimeout(() => setXpNoteCopied(false), 2000); }}
                          className="px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors"
                          style={{ borderColor: xpNoteCopied ? "#16A34A" : "var(--border)", color: xpNoteCopied ? "#16A34A" : "var(--text2)" }}
                        >
                          {xpNoteCopied ? "✓ Copied" : "Copy"}
                        </button>
                      </div>
                    </div>
                    <textarea
                      value={xpGeneratedNote}
                      onChange={e => setXpGeneratedNote(e.target.value)}
                      className="w-full border p-4 rounded-xl text-[13px] leading-7 resize-none focus:outline-none"
                      style={{ borderColor: "var(--border)", color: "var(--text1)", minHeight: 280 }}
                    />
                  </div>
                )}
              </div>
            )}

            {xpSubTab === "history" && (
              <div className="space-y-4 max-w-[700px]">
                {xp97153Notes.length === 0 ? (
                  <p className="text-[13px]" style={{ color: "var(--text3)" }}>No 97153XP notes yet.</p>
                ) : xp97153Notes.map(note => {
                  const isExpanded = xpExpandedNoteId === note.id;
                  const dateLabel = new Date(note.session_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                  return (
                    <div key={note.id} className="bg-white rounded-xl border p-5" style={{ borderColor: "var(--border)" }}>
                      <div className="flex items-start justify-between mb-2">
                        <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>{dateLabel}</p>
                        <button
                          onClick={() => setXpExpandedNoteId(isExpanded ? null : note.id)}
                          className="text-[12px] font-medium hover:underline"
                          style={{ color: "var(--teal)" }}
                        >
                          {isExpanded ? "Collapse" : "View"}
                        </button>
                      </div>
                      {!isExpanded && (
                        <p className="text-[12px] line-clamp-2" style={{ color: "var(--text3)" }}>
                          {(note.note_text || "").slice(0, 120)}…
                        </p>
                      )}
                      {isExpanded && (
                        <p className="text-[13px] leading-7 whitespace-pre-wrap mt-2" style={{ color: "var(--text2)" }}>
                          {note.note_text}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Supervision Notes Tab ── */}
        {activeTab === "supervision" && (
          <div>
            <div className="flex justify-end mb-4">
              <Link
                href={`/bcba/${clientId}/supervision-note`}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white hover:opacity-90 transition-opacity"
                style={{ background: "var(--teal)" }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                New Supervision Note
              </Link>
            </div>
            {supervisionNotes.length === 0 ? (
              <p className="text-[13px]" style={{ color: "var(--text3)" }}>No supervision notes yet.</p>
            ) : (
              <div className="space-y-4">
                {supervisionNotes.map(sn => {
                  const isExpanded = expandedNoteId === sn.id;
                  const dateLabel = new Date(sn.session_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                  const typeLabel = SUPERVISION_TYPE_LABELS[sn.supervision_type] || sn.supervision_type || "Supervision";
                  return (
                    <div key={sn.id} className="bg-white rounded-xl border p-5" style={{ borderColor: "var(--border)" }}>
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>{dateLabel}</p>
                          <p className="text-[11px] mt-0.5" style={{ color: "var(--text3)" }}>{typeLabel}</p>
                        </div>
                        <button
                          onClick={() => setExpandedNoteId(isExpanded ? null : sn.id)}
                          className="text-[12px] font-medium hover:underline"
                          style={{ color: "var(--teal)" }}
                        >
                          {isExpanded ? "Collapse" : "View"}
                        </button>
                      </div>
                      {!isExpanded && (
                        <p className="text-[12px] line-clamp-2" style={{ color: "var(--text3)" }}>
                          {(sn.note_text || "").slice(0, 120)}…
                        </p>
                      )}
                      {isExpanded && (
                        <p className="text-[13px] leading-7 whitespace-pre-wrap mt-2" style={{ color: "var(--text2)" }}>
                          {sn.note_text}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Parent Training Tab ── */}
        {activeTab === "parent_training" && (
          <div>
            <div className="flex justify-end mb-4">
              <Link
                href={`/bcba/${clientId}/parent-training-note`}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white hover:opacity-90 transition-opacity"
                style={{ background: "var(--teal)" }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                New Parent Training Note
              </Link>
            </div>
            {parentTrainingNotes.length === 0 ? (
              <p className="text-[13px]" style={{ color: "var(--text3)" }}>No parent training notes yet.</p>
            ) : (
              <div className="space-y-4">
                {parentTrainingNotes.map(pt => {
                  const isExpanded = expandedNoteId === pt.id;
                  const dateLabel = new Date(pt.session_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                  return (
                    <div key={pt.id} className="bg-white rounded-xl border p-5" style={{ borderColor: "var(--border)" }}>
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="text-[13px] font-semibold" style={{ color: "var(--text1)" }}>{dateLabel}</p>
                          {pt.caregiver_name && (
                            <p className="text-[11px] mt-0.5" style={{ color: "var(--text3)" }}>
                              {pt.caregiver_name}{pt.caregiver_relation ? ` · ${pt.caregiver_relation}` : ""}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => setExpandedNoteId(isExpanded ? null : pt.id)}
                          className="text-[12px] font-medium hover:underline"
                          style={{ color: "var(--teal)" }}
                        >
                          {isExpanded ? "Collapse" : "View"}
                        </button>
                      </div>
                      {!isExpanded && (
                        <p className="text-[12px] line-clamp-2" style={{ color: "var(--text3)" }}>
                          {(pt.note_text || "").slice(0, 120)}…
                        </p>
                      )}
                      {isExpanded && (
                        <p className="text-[13px] leading-7 whitespace-pre-wrap mt-2" style={{ color: "var(--text2)" }}>
                          {pt.note_text}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Treatment Map Tab ── */}
        {activeTab === "treatment_map" && (() => {
          const funcBadge: Record<string, { bg: string; color: string }> = {
            escape:    { bg: "#FEE2E2", color: "#DC2626" },
            attention: { bg: "#EFF6FF", color: "#2563EB" },
            tangible:  { bg: "#F0FDF4", color: "#16A34A" },
            automatic: { bg: "#FEF3C7", color: "#D97706" },
          };
          const statusBadge: Record<string, { bg: string; color: string }> = {
            active:   { bg: "#FEE2E2", color: "#DC2626" },
            reducing: { bg: "#FEF3C7", color: "#D97706" },
            resolved: { bg: "#F0FDF4", color: "#16A34A" },
          };
          const funcOptions = ["escape", "attention", "tangible", "automatic"];
          const statusOptions = ["active", "reducing", "resolved"];
          return (
          <div className="space-y-4">
            {/* ── Section 1: Header ── */}
            <div className="bg-white rounded-[10px] border p-5 flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
              <div>
                <p className="text-[14px] font-semibold" style={{ color: "var(--text1)" }}>Treatment Map</p>
                <p className="text-[12px] mt-0.5" style={{ color: treatmentMapApproved ? "#16A34A" : "var(--text3)" }}>
                  {treatmentMapApproved ? "Approved — visible to the RBT" : "Not yet approved — hidden from RBT"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {tmSaved && <span className="text-[12px]" style={{ color: "#16A34A" }}>Saved</span>}
                {tmSaving && <span className="text-[12px]" style={{ color: "var(--text3)" }}>Saving…</span>}
                <button
                  onClick={handleToggleTreatmentMapApproval}
                  disabled={savingTreatmentMap}
                  className="px-4 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-60 transition-opacity hover:opacity-90"
                  style={{ background: treatmentMapApproved ? "#DC2626" : "var(--teal)" }}
                >
                  {savingTreatmentMap ? "Saving\u2026" : treatmentMapApproved ? "Revoke Approval" : "Approve for RBT"}
                </button>
              </div>
            </div>

            {tmLoading ? (
              <div className="bg-white rounded-[10px] border p-8 text-center" style={{ borderColor: "var(--border)" }}>
                <p className="text-[13px]" style={{ color: "var(--text3)" }}>Loading\u2026</p>
              </div>
            ) : (
              <>
                {/* ── Section 2: Maladaptive Behaviors ── */}
                <div className="bg-white rounded-[10px] border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                  <div className="px-5 py-3 border-b" style={{ borderColor: "var(--border)", background: "#FEF2F2" }}>
                    <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "#991B1B" }}>Maladaptive Behaviors</p>
                  </div>
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                        {["Behavior Name", "Function", "Status", ""].map(h => (
                          <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text3)" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tmData.maladaptive.map((b: any, i: number) => {
                        const fb = funcBadge[b.function] || funcBadge.escape;
                        const sb = statusBadge[b.status] || statusBadge.active;
                        return (
                          <tr key={i} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                            <td className="px-4 py-3 font-semibold" style={{ color: "var(--text1)" }}>{b.name}</td>
                            <td className="px-4 py-3">
                              <span className="text-[11px] px-2.5 py-1 rounded-full font-semibold capitalize" style={{ background: fb.bg, color: fb.color }}>{b.function}</span>
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-[11px] px-2.5 py-1 rounded-full font-semibold capitalize" style={{ background: sb.bg, color: sb.color }}>{b.status}</span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={() => {
                                  const updated = { ...tmData, maladaptive: tmData.maladaptive.filter((_: any, j: number) => j !== i) };
                                  setTmData(updated);
                                  saveTreatmentMap(updated);
                                }}
                                className="text-[15px] leading-none hover:text-red-600 transition-colors" style={{ color: "var(--text3)" }}>\u00d7</button>
                            </td>
                          </tr>
                        );
                      })}
                      <tr style={{ background: "var(--bg)" }}>
                        <td className="px-4 py-2.5">
                          <input value={newTmBehavior.name} onChange={e => setNewTmBehavior(p => ({ ...p, name: e.target.value }))}
                            placeholder="Behavior name"
                            className="w-full border rounded-lg px-3 py-1.5 text-[12px]"
                            style={{ borderColor: "var(--border)", color: "var(--text1)" }} />
                        </td>
                        <td className="px-4 py-2.5">
                          <select value={newTmBehavior.function} onChange={e => setNewTmBehavior(p => ({ ...p, function: e.target.value }))}
                            className="w-full border rounded-lg px-2 py-1.5 text-[12px]"
                            style={{ borderColor: "var(--border)", color: "var(--text2)" }}>
                            {funcOptions.map(f => <option key={f} value={f}>{f}</option>)}
                          </select>
                        </td>
                        <td className="px-4 py-2.5">
                          <select value={newTmBehavior.status} onChange={e => setNewTmBehavior(p => ({ ...p, status: e.target.value }))}
                            className="w-full border rounded-lg px-2 py-1.5 text-[12px]"
                            style={{ borderColor: "var(--border)", color: "var(--text2)" }}>
                            {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            onClick={() => {
                              if (!newTmBehavior.name.trim()) return;
                              const updated = { ...tmData, maladaptive: [...tmData.maladaptive, { name: newTmBehavior.name.trim(), function: newTmBehavior.function, status: newTmBehavior.status }] };
                              setTmData(updated);
                              saveTreatmentMap(updated);
                              setNewTmBehavior({ name: "", function: "escape", status: "active" });
                            }}
                            className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white hover:opacity-90 transition-opacity"
                            style={{ background: "var(--teal)" }}>Add</button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* ── Section 3: Replacement Skills ── */}
                <div className="bg-white rounded-[10px] border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                  <div className="px-5 py-3 border-b" style={{ borderColor: "var(--border)", background: "#F0FDF4" }}>
                    <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "#065F46" }}>Replacement Skills</p>
                  </div>
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                        {["Skill Name", "Target Function", ""].map(h => (
                          <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text3)" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tmData.replacement.map((s: any, i: number) => {
                        const fb = funcBadge[s.targetFunction] || funcBadge.escape;
                        return (
                          <tr key={i} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                            <td className="px-4 py-3 font-semibold" style={{ color: "var(--text1)" }}>{s.name}</td>
                            <td className="px-4 py-3">
                              <span className="text-[11px] px-2.5 py-1 rounded-full font-semibold capitalize" style={{ background: fb.bg, color: fb.color }}>{s.targetFunction}</span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={() => {
                                  const updated = { ...tmData, replacement: tmData.replacement.filter((_: any, j: number) => j !== i) };
                                  setTmData(updated);
                                  saveTreatmentMap(updated);
                                }}
                                className="text-[15px] leading-none hover:text-red-600 transition-colors" style={{ color: "var(--text3)" }}>\u00d7</button>
                            </td>
                          </tr>
                        );
                      })}
                      <tr style={{ background: "var(--bg)" }}>
                        <td className="px-4 py-2.5">
                          <input value={newTmSkill.name} onChange={e => setNewTmSkill(p => ({ ...p, name: e.target.value }))}
                            placeholder="Skill name"
                            className="w-full border rounded-lg px-3 py-1.5 text-[12px]"
                            style={{ borderColor: "var(--border)", color: "var(--text1)" }} />
                        </td>
                        <td className="px-4 py-2.5">
                          <select value={newTmSkill.targetFunction} onChange={e => setNewTmSkill(p => ({ ...p, targetFunction: e.target.value }))}
                            className="w-full border rounded-lg px-2 py-1.5 text-[12px]"
                            style={{ borderColor: "var(--border)", color: "var(--text2)" }}>
                            {funcOptions.map(f => <option key={f} value={f}>{f}</option>)}
                          </select>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            onClick={() => {
                              if (!newTmSkill.name.trim()) return;
                              const updated = { ...tmData, replacement: [...tmData.replacement, { name: newTmSkill.name.trim(), targetFunction: newTmSkill.targetFunction }] };
                              setTmData(updated);
                              saveTreatmentMap(updated);
                              setNewTmSkill({ name: "", targetFunction: "escape" });
                            }}
                            className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white hover:opacity-90 transition-opacity"
                            style={{ background: "var(--teal)" }}>Add</button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* ── Section 4: Function Map ── */}
                {(tmData.maladaptive.length > 0 || tmData.replacement.length > 0) && (
                  <div className="bg-white rounded-[10px] border p-5" style={{ borderColor: "var(--border)" }}>
                    <p className="text-[11px] font-semibold uppercase tracking-wide mb-4" style={{ color: "var(--text3)" }}>Function Map</p>
                    <div className="grid grid-cols-2 gap-3">
                      {funcOptions.map(func => {
                        const fc = funcBadge[func];
                        const behavsForFunc = tmData.maladaptive.filter((b: any) => b.function === func);
                        const skillsForFunc = tmData.replacement.filter((s: any) => s.targetFunction === func);
                        return (
                          <div key={func} className="rounded-xl p-4 border" style={{ background: fc.bg, borderColor: fc.color + "40" }}>
                            <p className="text-[12px] font-bold uppercase tracking-wide mb-3 capitalize" style={{ color: fc.color }}>{func}</p>
                            {behavsForFunc.length === 0 && skillsForFunc.length === 0 ? (
                              <p className="text-[11px]" style={{ color: "var(--text3)" }}>No items</p>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {behavsForFunc.map((b: any, i: number) => (
                                  <span key={i} className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background: "#FEE2E2", color: "#DC2626" }}>{b.name}</span>
                                ))}
                                {skillsForFunc.map((s: any, i: number) => (
                                  <span key={i} className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(27,168,160,0.12)", color: "var(--teal)" }}>{s.name}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          );
        })()}

        {/* ── Assessment Tools Tab ── */}
        {activeTab === "reassessment" && (
          <div style={{ padding: "24px", maxWidth: 800 }}>
            {/* Header */}
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text1)" }}>Reassessment Summary</h2>
              <p style={{ fontSize: 13, color: "var(--text3)", marginTop: 4 }}>
                Generate a clinical summary for a custom period to include in reassessment documentation.
              </p>
            </div>

            {/* Date range + Generate */}
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 24, flexWrap: "wrap" }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--text3)", display: "block", marginBottom: 4 }}>Period Start</label>
                <input
                  type="date" value={reassessStart} onChange={e => setReassessStart(e.target.value)}
                  style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--text1)", fontSize: 13 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--text3)", display: "block", marginBottom: 4 }}>Period End</label>
                <input
                  type="date" value={reassessEnd} onChange={e => setReassessEnd(e.target.value)}
                  style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--text1)", fontSize: 13 }}
                />
              </div>
              <button
                onClick={handleGenerateReassessment}
                disabled={reassessGenerating || !reassessStart || !reassessEnd}
                style={{
                  padding: "8px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                  background: reassessGenerating || !reassessStart || !reassessEnd ? "var(--border)" : "var(--teal)",
                  color: "white", cursor: reassessGenerating ? "wait" : "pointer", border: "none",
                }}
              >
                {reassessGenerating ? "Generating…" : "Generate Summary"}
              </button>
            </div>

            {/* Error */}
            {reassessError && (
              <p style={{ color: "#DC2626", fontSize: 13, marginBottom: 16 }}>{reassessError}</p>
            )}

            {/* Meta cards */}
            {reassessMeta && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
                <div style={{ background: "var(--card)", borderRadius: 12, padding: 16, border: "1px solid var(--border)" }}>
                  <p style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>BEHAVIORS TRACKED</p>
                  <p style={{ fontSize: 22, fontWeight: 700, color: "var(--text1)" }}>
                    {Object.keys(reassessMeta.behaviorSummary || {}).length}
                  </p>
                </div>
                <div style={{ background: "var(--card)", borderRadius: 12, padding: 16, border: "1px solid var(--border)" }}>
                  <p style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>SKILLS TRACKED</p>
                  <p style={{ fontSize: 22, fontWeight: 700, color: "var(--text1)" }}>
                    {Object.keys(reassessMeta.skillSummary || {}).length}
                  </p>
                </div>
                <div style={{ background: "var(--card)", borderRadius: 12, padding: 16, border: "1px solid var(--border)" }}>
                  <p style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>ATTENDANCE RATE</p>
                  <p style={{ fontSize: 22, fontWeight: 700, color: "var(--teal)" }}>
                    {reassessMeta.attendanceRate != null ? `${reassessMeta.attendanceRate}%` : "—"}
                  </p>
                </div>
              </div>
            )}

            {/* Behavior first→last table */}
            {reassessMeta?.behaviorSummary && Object.keys(reassessMeta.behaviorSummary).length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text1)", marginBottom: 8 }}>Behavior Trends (First → Last Period)</p>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "var(--card)" }}>
                      <th style={{ padding: "8px 12px", textAlign: "left", color: "var(--text3)", borderBottom: "1px solid var(--border)" }}>Behavior</th>
                      <th style={{ padding: "8px 12px", textAlign: "center", color: "var(--text3)", borderBottom: "1px solid var(--border)" }}>First Period Avg</th>
                      <th style={{ padding: "8px 12px", textAlign: "center", color: "var(--text3)", borderBottom: "1px solid var(--border)" }}>Last Period Avg</th>
                      <th style={{ padding: "8px 12px", textAlign: "center", color: "var(--text3)", borderBottom: "1px solid var(--border)" }}>Trend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(reassessMeta.behaviorSummary).map(([name, data]: [string, any]) => {
                      const improved = data.last < data.first;
                      return (
                        <tr key={name} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={{ padding: "8px 12px", color: "var(--text1)" }}>{name}</td>
                          <td style={{ padding: "8px 12px", textAlign: "center", color: "var(--text3)" }}>{data.first?.toFixed(1)}</td>
                          <td style={{ padding: "8px 12px", textAlign: "center", color: "var(--text3)" }}>{data.last?.toFixed(1)}</td>
                          <td style={{ padding: "8px 12px", textAlign: "center" }}>
                            <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: improved ? "#DCFCE7" : "#FEE2E2", color: improved ? "#16A34A" : "#DC2626" }}>
                              {improved ? "↓ Improving" : "↑ Worsening"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Skill first→last table */}
            {reassessMeta?.skillSummary && Object.keys(reassessMeta.skillSummary).length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text1)", marginBottom: 8 }}>Skill Acquisition (First → Last Period)</p>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "var(--card)" }}>
                      <th style={{ padding: "8px 12px", textAlign: "left", color: "var(--text3)", borderBottom: "1px solid var(--border)" }}>Skill</th>
                      <th style={{ padding: "8px 12px", textAlign: "center", color: "var(--text3)", borderBottom: "1px solid var(--border)" }}>First Period Avg</th>
                      <th style={{ padding: "8px 12px", textAlign: "center", color: "var(--text3)", borderBottom: "1px solid var(--border)" }}>Last Period Avg</th>
                      <th style={{ padding: "8px 12px", textAlign: "center", color: "var(--text3)", borderBottom: "1px solid var(--border)" }}>Trend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(reassessMeta.skillSummary).map(([name, data]: [string, any]) => {
                      const improved = data.last > data.first;
                      return (
                        <tr key={name} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={{ padding: "8px 12px", color: "var(--text1)" }}>{name}</td>
                          <td style={{ padding: "8px 12px", textAlign: "center", color: "var(--text3)" }}>{data.first?.toFixed(1)}%</td>
                          <td style={{ padding: "8px 12px", textAlign: "center", color: "var(--text3)" }}>{data.last?.toFixed(1)}%</td>
                          <td style={{ padding: "8px 12px", textAlign: "center" }}>
                            <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: improved ? "#DCFCE7" : "#FEE2E2", color: improved ? "#16A34A" : "#DC2626" }}>
                              {improved ? "↑ Improving" : "↓ Declining"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Narrative */}
            {(reassessNarrative || reassessGenerating) && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text1)" }}>Clinical Summary & Medical Necessity</p>
                  {reassessNarrative && !reassessGenerating && (
                    <button
                      onClick={() => { navigator.clipboard.writeText(reassessNarrative); setReassessCopied(true); setTimeout(() => setReassessCopied(false), 2000); }}
                      style={{ fontSize: 12, color: "var(--teal)", background: "none", border: "none", cursor: "pointer" }}
                    >
                      {reassessCopied ? "✓ Copied" : "Copy"}
                    </button>
                  )}
                </div>
                <textarea
                  value={reassessNarrative}
                  onChange={e => setReassessNarrative(e.target.value)}
                  rows={12}
                  style={{
                    width: "100%", padding: 16, borderRadius: 12, border: "1px solid var(--border)",
                    background: "var(--card)", color: "var(--text1)", fontSize: 13,
                    lineHeight: 1.7, resize: "vertical", fontFamily: "inherit",
                  }}
                />
                {reassessGenerating && (
                  <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 8 }}>Generating clinical summary…</p>
                )}
              </div>
            )}

            {/* ── Assessment Builder ── */}
            <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "32px 0" }} />

            <div style={{ marginBottom: 20 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text1)" }}>Assessment Builder</h2>
              <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>
                Aggregate clinical data for reassessment documentation. BCBA review required for all sections.
              </p>
            </div>

            {/* Form row */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 24 }}>
              <div>
                <label style={{ fontSize: 11, color: "var(--text3)", display: "block", marginBottom: 4 }}>Document Type</label>
                <select
                  value={abDocType}
                  onChange={e => setAbDocType(e.target.value as any)}
                  style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--text1)", fontSize: 13 }}
                >
                  <option value="reassessment">Reassessment</option>
                  <option value="assessment_update">Assessment Update</option>
                  <option value="medical_necessity_letter">Medical Necessity Letter</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: "var(--text3)", display: "block", marginBottom: 4 }}>Period Start</label>
                <input type="date" value={abPeriodStart} onChange={e => setAbPeriodStart(e.target.value)}
                  style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--text1)", fontSize: 13 }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "var(--text3)", display: "block", marginBottom: 4 }}>Period End</label>
                <input type="date" value={abPeriodEnd} onChange={e => setAbPeriodEnd(e.target.value)}
                  style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--text1)", fontSize: 13 }} />
              </div>
              <button
                onClick={handleLoadAssessmentBuilder}
                disabled={abLoading || !abPeriodStart || !abPeriodEnd}
                style={{
                  padding: "8px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                  background: abLoading || !abPeriodStart || !abPeriodEnd ? "var(--border)" : "var(--teal)",
                  color: "white", border: "none", cursor: abLoading ? "wait" : "pointer",
                }}
              >
                {abLoading ? "Loading…" : "Load Data"}
              </button>
            </div>

            {abError && <p style={{ color: "#DC2626", fontSize: 13, marginBottom: 16 }}>{abError}</p>}

            {abData && (
              <div>
                {/* Documents Available */}
                <div style={{ marginBottom: 24, background: "var(--card)", borderRadius: 12, padding: 16, border: "1px solid var(--border)" }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text1)", marginBottom: 12 }}>Documents Available</p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
                    {Object.entries(abData.documentsAvailable || {}).map(([key, available]: [string, any]) => (
                      <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                        <span style={{ color: available ? "#16A34A" : "var(--text3)", fontWeight: 700 }}>
                          {available ? "✓" : "—"}
                        </span>
                        <span style={{ color: available ? "var(--text1)" : "var(--text3)" }}>
                          {key.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase())}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Service Utilization */}
                {abData.serviceUtilization && (
                  <div style={{ marginBottom: 24, background: "var(--card)", borderRadius: 12, padding: 16, border: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text1)" }}>Service Utilization</p>
                      <ConfidenceBadge level={abData.dataConfidence} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                      {[
                        { label: "Authorized Hours", value: abData.serviceUtilization.authorizedTotal?.toFixed(0) ?? "—" },
                        { label: "Sessions Delivered", value: abData.serviceUtilization.deliveredSessions ?? "—" },
                        { label: "Missed Hours", value: abData.serviceUtilization.missedTotal?.toFixed(0) ?? "—" },
                        { label: "Utilization %", value: abData.serviceUtilization.utilizationPct != null ? `${abData.serviceUtilization.utilizationPct}%` : "—" },
                      ].map(item => (
                        <div key={item.label} style={{ textAlign: "center" }}>
                          <p style={{ fontSize: 20, fontWeight: 700, color: "var(--teal)" }}>{item.value}</p>
                          <p style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>{item.label}</p>
                        </div>
                      ))}
                    </div>
                    {abData.clinicalBarriers?.length > 0 && (
                      <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 12 }}>
                        Missed reasons: {abData.clinicalBarriers.map((b: any) => b.reason).join(", ")}
                      </p>
                    )}
                  </div>
                )}

                {/* Behavior Reduction Summary */}
                {abData.behaviorFirstLast?.length > 0 && (
                  <div style={{ marginBottom: 24, background: "var(--card)", borderRadius: 12, padding: 16, border: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text1)" }}>Behavior Reduction Summary</p>
                      <ConfidenceBadge level={abData.dataConfidence} />
                    </div>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr>
                          {["Behavior", "First", "Last", "Change", "Trend"].map(h => (
                            <th key={h} style={{ padding: "6px 10px", textAlign: h === "Behavior" ? "left" : "center", color: "var(--text3)", borderBottom: "1px solid var(--border)", fontWeight: 600 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {abData.behaviorFirstLast.map((b: any) => {
                          const change = b.lastValue != null && b.firstValue != null ? b.lastValue - b.firstValue : null;
                          const trend = b.dataPoints < 3 ? "insufficient_data" : change == null ? "insufficient_data" : change < 0 ? "improving" : change > 0 ? "worsening" : "stable";
                          return (
                            <tr key={b.behaviorName} style={{ borderBottom: "1px solid var(--border)" }}>
                              <td style={{ padding: "8px 10px", color: "var(--text1)" }}>{b.behaviorName}</td>
                              <td style={{ padding: "8px 10px", textAlign: "center", color: "var(--text3)" }}>
                                {b.firstValue != null ? b.firstValue.toFixed(1) : "—"}
                              </td>
                              <td style={{ padding: "8px 10px", textAlign: "center", color: "var(--text3)" }}>
                                {b.lastValue != null ? b.lastValue.toFixed(1) : "—"}
                              </td>
                              <td style={{ padding: "8px 10px", textAlign: "center", color: "var(--text3)" }}>
                                {change != null ? (change > 0 ? `+${change.toFixed(1)}` : change.toFixed(1)) : "—"}
                              </td>
                              <td style={{ padding: "8px 10px", textAlign: "center" }}>
                                <TrendBadge trend={trend} type="behavior" />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Skill Acquisition Summary */}
                {abData.skillFirstLast?.length > 0 && (
                  <div style={{ marginBottom: 24, background: "var(--card)", borderRadius: 12, padding: 16, border: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text1)" }}>Skill Acquisition Summary</p>
                      <ConfidenceBadge level={abData.dataConfidence} />
                    </div>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr>
                          {["Skill", "First %", "Last %", "Change", "Trend"].map(h => (
                            <th key={h} style={{ padding: "6px 10px", textAlign: h === "Skill" ? "left" : "center", color: "var(--text3)", borderBottom: "1px solid var(--border)", fontWeight: 600 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {abData.skillFirstLast.map((s: any) => {
                          const change = s.lastPct != null && s.firstPct != null ? s.lastPct - s.firstPct : null;
                          const trend = s.dataPoints < 3 ? "insufficient_data" : change == null ? "insufficient_data" : change > 0 ? "improving" : change < 0 ? "worsening" : "stable";
                          return (
                            <tr key={s.skillName} style={{ borderBottom: "1px solid var(--border)" }}>
                              <td style={{ padding: "8px 10px", color: "var(--text1)" }}>{s.skillName}</td>
                              <td style={{ padding: "8px 10px", textAlign: "center", color: "var(--text3)" }}>
                                {s.firstPct != null ? `${s.firstPct.toFixed(1)}%` : "—"}
                              </td>
                              <td style={{ padding: "8px 10px", textAlign: "center", color: "var(--text3)" }}>
                                {s.lastPct != null ? `${s.lastPct.toFixed(1)}%` : "—"}
                              </td>
                              <td style={{ padding: "8px 10px", textAlign: "center", color: "var(--text3)" }}>
                                {change != null ? (change > 0 ? `+${change.toFixed(1)}%` : `${change.toFixed(1)}%`) : "—"}
                              </td>
                              <td style={{ padding: "8px 10px", textAlign: "center" }}>
                                <TrendBadge trend={trend} type="skill" />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* BCBA Documentation Summary */}
                {abData.bcbaDocumentation && (
                  <div style={{ marginBottom: 24, background: "var(--card)", borderRadius: 12, padding: 16, border: "1px solid var(--border)" }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text1)", marginBottom: 12 }}>BCBA Documentation Summary</p>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                      {[
                        { label: "97155 Sessions", value: abData.bcbaDocumentation.supervisionNoteCount ?? 0 },
                        { label: "97153XP Sessions", value: abData.bcbaDocumentation.supervisionNotes97153xpCount ?? 0 },
                        { label: "Parent Training", value: abData.bcbaDocumentation.parentTrainingNoteCount ?? 0 },
                      ].map(item => (
                        <div key={item.label} style={{ textAlign: "center" }}>
                          <p style={{ fontSize: 20, fontWeight: 700, color: "var(--text1)" }}>{item.value}</p>
                          <p style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>{item.label}</p>
                        </div>
                      ))}
                    </div>
                    {abData.protocolModifications?.length > 0 && (
                      <p style={{ fontSize: 12, color: "#16A34A", marginTop: 12, fontWeight: 600 }}>
                        ✓ Protocol modifications documented ({abData.protocolModifications.length})
                      </p>
                    )}
                  </div>
                )}

                {/* Clinical Barriers */}
                {abData.clinicalBarriers?.length > 0 && (
                  <div style={{ marginBottom: 24, background: "var(--card)", borderRadius: 12, padding: 16, border: "1px solid var(--border)" }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text1)", marginBottom: 12 }}>Clinical Barriers to Service</p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {abData.clinicalBarriers.map((b: any, i: number) => (
                        <span key={i} style={{ padding: "4px 10px", borderRadius: 6, fontSize: 12, background: "#FEF3C7", color: "#92400E" }}>
                          {b.reason} ({b.count}×)
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Protocol Modifications */}
                {abData.protocolModifications?.length > 0 && (
                  <div style={{ marginBottom: 24, background: "var(--card)", borderRadius: 12, padding: 16, border: "1px solid var(--border)" }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text1)", marginBottom: 12 }}>Protocol Modifications</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {abData.protocolModifications.map((mod: any, i: number) => (
                        <div key={i} style={{ padding: "10px 12px", borderRadius: 8, background: "var(--bg)", border: "1px solid var(--border)", fontSize: 12 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                            <span style={{ fontWeight: 600, color: "var(--text1)" }}>{mod.title}</span>
                            <span style={{ color: "var(--text3)" }}>{mod.date}</span>
                          </div>
                          {mod.summary && (
                            <p style={{ color: "var(--text3)", marginTop: 4 }}>{mod.summary}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Clinical Narrative & Medical Necessity */}
                <div style={{ marginBottom: 24, padding: 16, background: "var(--card)", borderRadius: 12, border: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text1)" }}>Clinical Narrative & Medical Necessity</p>
                      <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
                        AI-generated 6-paragraph narrative using progress reports and clinical data.
                        BCBA review and editing required before use.
                      </p>
                    </div>
                    <button
                      onClick={handleGenerateAssessmentNarrative}
                      disabled={abNarrativeGenerating}
                      style={{
                        padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                        background: abNarrativeGenerating ? "var(--border)" : "var(--teal)",
                        color: "white", border: "none", cursor: abNarrativeGenerating ? "wait" : "pointer",
                        whiteSpace: "nowrap", flexShrink: 0, marginLeft: 12,
                      }}
                    >
                      {abNarrativeGenerating ? "Generating…" : "Generate Narrative"}
                    </button>
                  </div>
                  {abNarrativeError && (
                    <p style={{ color: "#DC2626", fontSize: 13, marginTop: 8 }}>{abNarrativeError}</p>
                  )}
                  {(abNarrative || abNarrativeGenerating) && (
                    <div style={{ marginTop: 12 }}>
                      {abNarrative && !abNarrativeGenerating && (
                        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
                          <button
                            onClick={() => { navigator.clipboard.writeText(abNarrative); setAbNarrativeCopied(true); setTimeout(() => setAbNarrativeCopied(false), 2000); }}
                            style={{ fontSize: 12, color: "var(--teal)", background: "none", border: "none", cursor: "pointer" }}
                          >
                            {abNarrativeCopied ? "✓ Copied" : "Copy"}
                          </button>
                        </div>
                      )}
                      <textarea
                        value={abNarrative}
                        onChange={e => setAbNarrative(e.target.value)}
                        rows={12}
                        style={{
                          width: "100%", padding: 16, borderRadius: 12, border: "1px solid var(--border)",
                          background: "var(--bg)", color: "var(--text1)", fontSize: 13,
                          lineHeight: 1.7, resize: "vertical", fontFamily: "inherit",
                        }}
                      />
                      {abNarrativeGenerating && (
                        <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 8 }}>Generating clinical narrative…</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Empty state */}
                {abData.behaviorFirstLast?.length === 0 && abData.skillFirstLast?.length === 0 && (
                  <div style={{ textAlign: "center", padding: 32, color: "var(--text3)", fontSize: 13 }}>
                    No behavior or skill data available for this period.
                    Data will appear after weekly data has been entered for this client.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Progress Report Tab ── */}
        {activeTab === "progress_report" && (
          <div className="space-y-5">
            {/* Controls */}
            <div className="flex items-center gap-3 flex-wrap">
              <input
                type="month" value={prSelectedMonth} onChange={e => setPrSelectedMonth(e.target.value)}
                className="border rounded-lg px-3 py-1.5 text-[13px]"
                style={{ borderColor: "var(--border)", color: "var(--text1)" }}
              />
              <button
                onClick={handlePrGenerate} disabled={prGenerating}
                className="px-4 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50 hover:opacity-90 transition-opacity"
                style={{ background: "var(--teal)" }}
              >
                {prGenerating ? "Generating…" : "Generate Report"}
              </button>
            </div>

            {/* Status / error */}
            {prStatus && (
              <div className="px-4 py-3 rounded-xl text-[13px]" style={{ background: "#EFF6FF", color: "#1E40AF" }}>{prStatus}</div>
            )}
            {prError && (
              <div className="px-4 py-3 rounded-xl text-[13px]" style={{ background: "#FEF2F2", color: "#991B1B" }}>{prError}</div>
            )}

            {/* Results */}
            {prHasData && (
              <>
                {/* Executive summary */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "Behaviors Improved", value: prImproving, color: "#16A34A", bg: "#DCFCE7" },
                    { label: "Need Attention", value: prWorsening, color: "#DC2626", bg: "#FEE2E2" },
                    { label: "Skills Improving", value: prSkillsImproving, color: "#2563EB", bg: "#EFF6FF" },
                  ].map(card => (
                    <div key={card.label} className="rounded-xl p-4 text-center" style={{ background: card.bg }}>
                      <p className="text-[28px] font-bold" style={{ color: card.color }}>{card.value}</p>
                      <p className="text-[11px] font-semibold mt-1" style={{ color: card.color }}>{card.label}</p>
                    </div>
                  ))}
                </div>

                {/* Service Utilization */}
                {prServiceUtilization && (
                  <div className="bg-white rounded-xl border p-5" style={{ borderColor: "var(--border)" }}>
                    <SectionHeader title="Service Utilization" />
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-4">
                      {[
                        { label: "Authorized Hours", value: prServiceUtilization.authorizedHoursTotal > 0 ? `${prServiceUtilization.authorizedHoursTotal}h` : "—" },
                        { label: "Delivered Hours", value: prServiceUtilization.deliveredHours > 0 ? `${prServiceUtilization.deliveredHours}h` : "—" },
                        { label: "Missed Hours", value: prServiceUtilization.missedHoursTotal > 0 ? `${prServiceUtilization.missedHoursTotal}h` : "0h" },
                        { label: "Attendance Rate", value: prServiceUtilization.attendanceRate !== null ? `${prServiceUtilization.attendanceRate}%` : "—" },
                      ].map(item => (
                        <div key={item.label} className="text-center p-3 rounded-xl" style={{ background: "var(--bg)" }}>
                          <p className="text-[20px] font-bold" style={{ color: "var(--text1)" }}>{item.value}</p>
                          <p className="text-[11px] mt-0.5" style={{ color: "var(--text3)" }}>{item.label}</p>
                        </div>
                      ))}
                    </div>
                    {prServiceUtilization.missedHoursTotal > 0 && (
                      <div className="px-4 py-2.5 rounded-lg" style={{ background: "#FEF3C7", border: "1px solid #FCD34D" }}>
                        <p className="text-[12px]" style={{ color: "#92400E" }}>
                          The client missed {prServiceUtilization.missedHoursTotal} authorized treatment hours. Reduced treatment exposure may limit skill acquisition and generalization.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Maladaptive Behavior Table */}
                {Object.keys(prBehaviorWeeklyTable).length > 0 && (
                  <div className="bg-white rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                    <div className="px-5 py-3 border-b" style={{ borderColor: "var(--border)", background: "#FEF2F2" }}>
                      <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "#991B1B" }}>Maladaptive Behavior Summary</p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[13px]">
                        <thead>
                          <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                            {["Behavior", "Baseline", "Week 1", "Week 2", "Week 3", "Week 4", "Monthly Avg"].map(h => (
                              <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text3)" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(prBehaviorWeeklyTable).map(([name, data]: [string, any], i) => (
                            <tr key={i} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                              <td className="px-4 py-3 font-semibold" style={{ color: "var(--text1)" }}>{name}</td>
                              <td className="px-4 py-3 text-[12px]" style={{ color: "var(--text3)" }}>—</td>
                              {data.weeks.map((w: number | null, wi: number) => (
                                <td key={wi} className="px-4 py-3 text-[12px]" style={{ color: w !== null ? "var(--text1)" : "var(--text3)" }}>{w !== null ? w : "—"}</td>
                              ))}
                              <td className="px-4 py-3 text-[12px] font-semibold" style={{ color: "var(--teal)" }}>{data.monthlyAvg !== null ? data.monthlyAvg : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Replacement Skill Table */}
                {Object.keys(prSkillWeeklyTable).length > 0 && (
                  <div className="bg-white rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                    <div className="px-5 py-3 border-b" style={{ borderColor: "var(--border)", background: "#F0FDF4" }}>
                      <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "#065F46" }}>Replacement Skill Summary</p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[13px]">
                        <thead>
                          <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                            {["Skill", "Baseline", "Week 1", "Week 2", "Week 3", "Week 4", "Monthly Avg"].map(h => (
                              <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text3)" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(prSkillWeeklyTable).map(([name, data]: [string, any], i) => (
                            <tr key={i} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                              <td className="px-4 py-3 font-semibold" style={{ color: "var(--text1)" }}>{name}</td>
                              <td className="px-4 py-3 text-[12px]" style={{ color: "var(--text3)" }}>—</td>
                              {data.weeks.map((w: number | null, wi: number) => (
                                <td key={wi} className="px-4 py-3 text-[12px]" style={{ color: w !== null ? "var(--text1)" : "var(--text3)" }}>{w !== null ? `${w}%` : "—"}</td>
                              ))}
                              <td className="px-4 py-3 text-[12px] font-semibold" style={{ color: "var(--teal)" }}>{data.monthlyAvg !== null ? `${data.monthlyAvg}%` : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Active Treatment Areas */}
                {prActiveTreatmentAreas && (
                  <div className="bg-white rounded-xl border p-5" style={{ borderColor: "var(--border)" }}>
                    <SectionHeader title="Active Treatment Areas" />
                    <div className="grid gap-4 sm:grid-cols-3">
                      {[
                        { label: "Behavior Reduction Targets", items: prActiveTreatmentAreas.behaviorReductionTargets },
                        { label: "Replacement Programs", items: prActiveTreatmentAreas.replacementPrograms },
                        { label: "Interventions Used", items: prActiveTreatmentAreas.frequentlyUsedInterventions },
                      ].map(col => (
                        <div key={col.label}>
                          <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text3)" }}>{col.label}</p>
                          {col.items?.length > 0 ? col.items.map((item: string, i: number) => (
                            <p key={i} className="text-[12px] py-0.5" style={{ color: "var(--text2)" }}>• {item}</p>
                          )) : <p className="text-[12px]" style={{ color: "var(--text3)" }}>None documented</p>}
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 pt-4 border-t flex gap-6" style={{ borderColor: "var(--border)" }}>
                      <p className="text-[12px]" style={{ color: "var(--text3)" }}>RBT Sessions: <span className="font-semibold" style={{ color: "var(--text1)" }}>{prActiveTreatmentAreas.rbtSessionCount}</span></p>
                      {prActiveTreatmentAreas.bcbaSessionCount > 0 && (
                        <p className="text-[12px]" style={{ color: "var(--text3)" }}>BCBA Sessions: <span className="font-semibold" style={{ color: "var(--text1)" }}>{prActiveTreatmentAreas.bcbaSessionCount}</span></p>
                      )}
                    </div>
                  </div>
                )}

                {/* Clinical Barriers */}
                {prClinicalBarriers.length > 0 && (
                  <div className="bg-white rounded-xl border p-5" style={{ borderColor: "var(--border)" }}>
                    <SectionHeader title="Clinical Barriers" />
                    <div className="space-y-1.5">
                      {prClinicalBarriers.map((barrier, i) => (
                        <div key={i} className="flex items-center gap-2 text-[12px]" style={{ color: "var(--text2)" }}>
                          <span style={{ color: "#D97706" }}>•</span><span>{barrier}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Narrative */}
                {prNarrative && (
                  <div className="bg-white rounded-xl border p-5" style={{ borderColor: "var(--border)" }}>
                    <SectionHeader title="Clinical Narrative & Medical Necessity" />
                    <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text2)" }}>{prNarrative}</p>
                  </div>
                )}
              </>
            )}

            {/* Previous Reports */}
            {prReports.length > 0 && (
              <div className="bg-white rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                <div className="px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
                  <SectionHeader title="Previous Reports" />
                </div>
                {prReports.map(report => (
                  <div key={report.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                    <div className="px-5 py-3 flex items-center justify-between">
                      <button
                        onClick={() => setPrExpandedReport(prExpandedReport === report.id ? null : report.id)}
                        className="text-[13px] font-medium text-left hover:opacity-70"
                        style={{ color: "var(--text1)" }}
                      >
                        {report.period_label}
                      </button>
                      <span className="text-[12px]" style={{ color: "var(--text3)" }}>
                        {prExpandedReport === report.id ? "▲" : "▼"}
                      </span>
                    </div>
                    {prExpandedReport === report.id && (
                      <div className="px-5 pb-5">
                        <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text2)" }}>{report.narrative}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Clinical Timeline Tab ── */}
        {activeTab === "clinical_timeline" && (
          <div className="space-y-4">
            {/* Filter row */}
            <div className="flex items-center gap-2 flex-wrap">
              {[
                { id: "all", label: "All" },
                { id: "progress_reports", label: "Progress Reports" },
                { id: "assessments", label: "Assessments" },
                { id: "reassessments", label: "Reassessments" },
                { id: "protocol_changes", label: "Protocol Changes" },
              ].map(f => (
                <button
                  key={f.id}
                  onClick={() => setTimelineFilter(f.id)}
                  className="px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors"
                  style={{
                    background: timelineFilter === f.id ? "var(--teal)" : "var(--bg)",
                    color: timelineFilter === f.id ? "white" : "var(--text2)",
                    border: `1px solid ${timelineFilter === f.id ? "var(--teal)" : "var(--border)"}`,
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {timelineLoading && (
              <p className="text-[13px]" style={{ color: "var(--text3)" }}>Loading…</p>
            )}

            {!timelineLoading && filteredTimelineEntries.length === 0 && (
              <div className="bg-white rounded-xl border p-8 text-center" style={{ borderColor: "var(--border)" }}>
                <p className="text-[14px] font-semibold mb-1" style={{ color: "var(--text1)" }}>No timeline entries yet</p>
                <p className="text-[12px]" style={{ color: "var(--text3)" }}>Entries are created automatically when progress reports and reassessment summaries are generated.</p>
              </div>
            )}

            {filteredTimelineEntries.map((entry: any) => {
              const typeConfig: Record<string, { bg: string; color: string; label: string }> = {
                monthly_progress_report: { bg: "#E6F9F5", color: "#0D8A6A", label: "Progress Report" },
                reassessment_summary:    { bg: "#EFF6FF", color: "#1D4ED8", label: "Reassessment" },
                assessment:              { bg: "#FEF3C7", color: "#92400E", label: "Assessment" },
                protocol_change:         { bg: "#F3E8FF", color: "#6D28D9", label: "Protocol Change" },
              };
              const importanceConfig: Record<string, string> = {
                low: "#16A34A", medium: "#2563EB", high: "#D97706", critical: "#DC2626",
              };
              const tc = typeConfig[entry.type] || { bg: "var(--bg)", color: "var(--text3)", label: entry.type };
              const importanceColor = importanceConfig[entry.importance || "medium"] || "#2563EB";
              const isExpanded = expandedTimelineId === entry.id;
              const summary = entry.summary || "";
              const truncated = summary.length > 150 && !isExpanded;
              const formattedDate = entry.created_at
                ? new Date(entry.created_at).toLocaleString("en-US", { month: "long", year: "numeric" })
                : entry.date;

              return (
                <div key={entry.id} className="bg-white rounded-xl border" style={{ borderColor: "var(--border)" }}>
                  <div className="px-5 py-4 flex items-start gap-3">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 mt-0.5" style={{ background: tc.bg, color: tc.color }}>
                      {tc.label}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[14px] font-semibold" style={{ color: "var(--text1)" }}>{entry.title}</p>
                        <div className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ background: importanceColor }} title={entry.importance || "medium"} />
                      </div>
                      <p className="text-[12px] mt-0.5" style={{ color: "var(--text3)" }}>{formattedDate}</p>
                      {summary && (
                        <p className="text-[13px] mt-1.5 leading-relaxed" style={{ color: "var(--text2)" }}>
                          {truncated ? `${summary.slice(0, 150)}…` : summary}
                        </p>
                      )}
                      {summary.length > 150 && (
                        <button
                          onClick={() => setExpandedTimelineId(isExpanded ? null : entry.id)}
                          className="text-[12px] mt-1 hover:underline"
                          style={{ color: "var(--teal)" }}
                        >
                          {isExpanded ? "Show less" : "Show more"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>

      {/* Invite RBT modal */}
      {showInviteModal && inviteCode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md mx-4">
            <p className="text-[16px] font-semibold mb-2" style={{ color: "var(--text1)" }}>Invite RBT</p>
            <p className="text-[13px] mb-5" style={{ color: "var(--text3)" }}>
              Share this code with your RBT. They can use it to connect to this client.
            </p>
            <div className="flex items-center gap-3 p-4 rounded-xl mb-2" style={{ background: "var(--bg)", border: "1px solid var(--border)" }}>
              <span className="flex-1 text-[22px] font-mono font-bold tracking-widest text-center" style={{ color: "var(--text1)" }}>
                {inviteCode}
              </span>
              <button
                onClick={() => { navigator.clipboard.writeText(inviteCode); setCodeCopied(true); setTimeout(() => setCodeCopied(false), 2000); }}
                className="px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors"
                style={{ background: codeCopied ? "#E6F9F5" : "var(--teal)", color: codeCopied ? "#0D8A6A" : "white" }}
              >
                {codeCopied ? "Copied!" : "Copy"}
              </button>
            </div>
            <p className="text-[11px] mb-6 text-center" style={{ color: "var(--text3)" }}>
              Expires in 7 days
              {inviteExpiresAt ? ` · ${new Date(inviteExpiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}
            </p>
            <button
              onClick={() => setShowInviteModal(false)}
              className="w-full py-2.5 rounded-xl text-[13px] font-semibold border hover:bg-gray-50 transition-colors"
              style={{ borderColor: "var(--border)", color: "var(--text2)" }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
