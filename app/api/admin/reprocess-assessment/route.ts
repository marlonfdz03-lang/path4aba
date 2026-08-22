import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { extractAssessment } from "@/lib/extractAssessment";
import { parsePdf, saveKnowledgeBase, buildAssessmentProfile } from "@/lib/assessmentPipeline";
import { validateAssessmentProfile, buildRefreshedProfile } from "@/lib/assessmentRefresh";
import { assembleRefreshProfile } from "@/lib/assembleRefreshProfile";
import { parsePositioned, clusterRows } from "@/lib/pdfGeometry";
import { diagnosisColumn } from "@/lib/diagnosis";
import { buildClinicalPacket } from "@/lib/clinicalPacket";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Which pipeline produced the current profile. Bumped when the extraction pipeline changes materially, so it
// is visible (in clinical_profile.reprocessedWith) which clients have been through the current pipeline. This
// value corresponds to the credible-LLM-on-UNREAD + discontinued-authority fix (commit 45f4a2a).
const PIPELINE_VERSION = "behavior-credibility-v1";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) return null;
  if ((session.user as any).role !== "admin") return null;
  return session;
}

// POST /api/admin/reprocess-assessment  { clientId }
// Re-runs the CURRENT extraction pipeline against the client's ALREADY-STORED source PDF (client_files) — no
// re-upload, no duplicate file versions. Same steps as the upload path (parse → extract → assembleRefresh →
// validate → buildRefreshed), so buildRefreshedProfile takes the previousProfile snapshot and /profile/restore
// one-level undo still protects the client. Admin-only. Reports the new behavior set for verification; does
// NOT auto-approve anything (the admin compares against the source document).
export async function POST(req: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const clientId = String(body?.clientId || "");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const client = await prisma.clients.findUnique({ where: { id: clientId }, select: { clinical_profile: true } });
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  const existingProfile = (client.clinical_profile as any) || {};

  // The CURRENT stored source PDF (most recent, not superseded). No new file is stored.
  const fileRow = await (prisma as any).client_files.findFirst({
    where: { client_id: clientId, superseded_at: null, mime_type: "application/pdf" },
    orderBy: { uploaded_at: "desc" },
    select: { data: true, filename: true },
  });
  if (!fileRow?.data) return NextResponse.json({ error: "No stored source PDF for this client — a re-upload is required." }, { status: 404 });
  const buffer = Buffer.from(fileRow.data);

  try {
    const text = await parsePdf(buffer);
    if (!text.trim()) return NextResponse.json({ error: "Stored PDF parsed to empty text." }, { status: 422 });

    // Clinical Extraction Packet — same as the live upload path (locate clinical regions across the WHOLE doc).
    const { packet, hasFunctionalAssessment, behaviorDomainFound, manifest } = buildClinicalPacket(text);
    const extracted = await extractAssessment(packet);
    saveKnowledgeBase(extracted).catch((e) => console.error("KB save error (reprocess):", e));

    const llmProfile = buildAssessmentProfile(extracted);
    const geomRows = clusterRows(await parsePositioned(buffer));
    const { profile: assessmentProfile, reviewFlags, confidence } = assembleRefreshProfile(llmProfile, geomRows, existingProfile);

    const problems = validateAssessmentProfile(assessmentProfile, extracted);
    if (problems.length) {
      return NextResponse.json(
        { error: `Re-process did not apply — could not read: ${problems.join("; ")}. The stored profile is unchanged.`, applied: false },
        { status: 422 },
      );
    }

    const refreshed = buildRefreshedProfile(existingProfile, assessmentProfile);

    // Function provenance (see extract-assessment): FA source present → documented; absent → inferred.
    const functionEvidence = hasFunctionalAssessment ? "documented-functional-assessment" : "inferred";
    for (const b of ((refreshed as any).maladaptiveBehaviors || [])) {
      if (b && b.functionsSource !== "human-edited") b.functionsEvidence = functionEvidence;
    }
    if (!hasFunctionalAssessment) reviewFlags.push({ field: "functions", source: "llm-fallback", reason: "no functional-assessment (FAST/MAS) source located — functions inferred, verify" });
    if (!behaviorDomainFound) reviewFlags.push({ field: "behaviors", source: "guard-preserved", reason: "maladaptive-behavior section not located — behaviors not refreshed" });

    (refreshed as any).reviewFlags = reviewFlags;
    // MARKER — visible which clients have been through the current pipeline (survives the refresh spread).
    (refreshed as any).reprocessedWith = {
      pipelineVersion: PIPELINE_VERSION,
      at: new Date().toISOString(),
      by: (session.user as any).email || (session.user as any).id || "admin",
      sourceFile: fileRow.filename || null,
    };

    await prisma.clients.update({
      where: { id: clientId },
      data: { clinical_profile: refreshed, diagnosis: diagnosisColumn((refreshed as any).diagnosis) },
    });

    // Verification summary — the admin compares this against the source document (no auto-approval).
    const behaviors = ((refreshed as any).maladaptiveBehaviors || []).map((b: any) => ({ name: b?.name, status: b?.status }));
    return NextResponse.json({
      applied: true,
      pipelineVersion: PIPELINE_VERSION,
      confidence: confidence.level,
      packetChars: packet.length,
      behaviorDomainFound,
      hasFunctionalAssessment,
      functionEvidence,
      sectionsMissing: manifest.filter((m) => !m.found).map((m) => m.label),
      behaviorSource: (reviewFlags.find((f) => f.field === "behaviors")?.source) || "geometry",
      previousBehaviorCount: (existingProfile.maladaptiveBehaviors || []).length,
      behaviorCount: behaviors.length,
      behaviors,
      skillCount: ((refreshed as any).replacementBehaviors || []).length,
      reviewFlags,
    });
  } catch (e: any) {
    // A 429 (Azure rate limit on the large prompt) or any pipeline error — the profile is left unchanged.
    const rateLimited = e?.status === 429;
    return NextResponse.json(
      { error: rateLimited ? "Azure rate-limited (429) — retry off-peak. Nothing changed." : (e?.message || String(e)), applied: false, rateLimited },
      { status: rateLimited ? 429 : 500 },
    );
  }
}
