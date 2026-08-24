import { NextRequest, NextResponse } from "next/server";
import { extractAssessment, ExtractedAssessment } from "@/lib/extractAssessment";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { parsePdf, mapToLegacyFormat, saveKnowledgeBase, buildAssessmentProfile } from "@/lib/assessmentPipeline";
import { isPdf, MAX_FILE_BYTES, storeClientFile, userOwnsClient } from "@/lib/clientFiles";
import { validateAssessmentProfile, buildRefreshedProfile } from "@/lib/assessmentRefresh";
import { diagnosisColumn } from "@/lib/diagnosis";
import { parsePositioned, clusterRows } from "@/lib/pdfGeometry";
import { assembleRefreshProfile } from "@/lib/assembleRefreshProfile";
import { buildClinicalPacket } from "@/lib/clinicalPacket";
import { assessReplacementCompleteness, assessInterventionCompleteness } from "@/lib/llmBehaviorCredibility";

export const maxDuration = 60;

export const runtime = "nodejs";


export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "No PDF file received" },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // We now KEEP the source PDF (client_files), so validate it up front: must be a real PDF (magic bytes —
    // browser MIME is spoofable) and <= 15 MB. Applies to every upload path.
    if (!isPdf(buffer)) {
      return NextResponse.json({ error: "Only PDF files are supported." }, { status: 415 });
    }
    if (buffer.length > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "File is too large (max 15 MB)." }, { status: 413 });
    }

    const text = await parsePdf(buffer);

    if (!text.trim()) {
      return NextResponse.json(
        { error: "PDF extraction returned empty text." },
        { status: 400 }
      );
    }

    // CLINICAL EXTRACTION PACKET — locate the clinically relevant regions across the WHOLE document (behaviors,
    // status blocks, FAST/MAS, replacement, reinforcers, …) instead of the first 90K chars, which never reached
    // the late FAST/MAS tables or late DISCONTINUED blocks in large assessments. Stays under 90K.
    const { packet, hasFunctionalAssessment, behaviorDomainFound, replacementDomainFound, interventionDomainFound } = buildClinicalPacket(text);
    const extracted = await extractAssessment(packet);

    saveKnowledgeBase(extracted).catch(err =>
      console.error("Knowledge base save error:", err)
    );

    // ── If clientId provided: REFRESH the clinical_profile from the assessment ─────
    // The assessment is the source of truth. Every assessment-sourced key is replaced wholesale from the
    // new PDF (no name-merge, no keep-the-old-object): new functions/topographies on an existing behavior
    // land; a behavior absent from the new assessment is gone; a mastered behavior leaves the active list.
    const clientId = formData.get("clientId") as string | null;
    if (clientId) {
      const session = await auth();
      if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

      // OWNERSHIP GATE (security/PHI). Refreshing a profile OVERWRITES a real clinical record, and
      // storeClientFile below attaches the source PDF — both must require that the caller owns this
      // client (its RBT, or a connected BCBA). Without this any authenticated user could overwrite (or
      // attach files to) ANY client — unacceptable once uploads open. Checked BEFORE the file store and
      // BEFORE the write, so an unauthorized caller changes nothing. userOwnsClient = rbt_id OR bcba_clients.
      const userId = (session.user as any).id as string;
      if (!(await userOwnsClient(userId, clientId))) {
        return NextResponse.json(
          { error: "Forbidden — you are not assigned to this client." },
          { status: 403 }
        );
      }

      // Confirm the client exists FIRST — we attach the source PDF below regardless of extraction outcome,
      // and the file's foreign key requires a real client.
      const existing = await prisma.clients.findUnique({
        where: { id: clientId },
        select: { clinical_profile: true },
      });
      if (!existing) return NextResponse.json({ error: "Client not found" }, { status: 404 });
      const existingProfile = (existing.clinical_profile as any) || {};

      // Keep the SOURCE PDF now — stored even if extraction fails below, so a rejected new-format PDF can be
      // debugged and the RBT need not re-upload. STORING THE FILE DOES NOT MEAN THE PROFILE WAS UPDATED.
      await storeClientFile(clientId, (session.user as any).id, file, buffer);

      // Assessment-sourced keys, built wholesale (no cleanText/hasBlockedTerm — see buildAssessmentProfile).
      const llmProfile = buildAssessmentProfile(extracted);
      // FAST/MAS overlay (one PDF parse feeds text→LLM and positioned rows→geometry):
      //  • Commit 1 — diagnosis + mastered-skills GEOMETRY-AUTHORITATIVE (F82/differentials excluded at
      //    source); LLM kept as a FLAGGED fallback where no structure is located.
      //  • Commit 2 — GUARDED behavior refresh: HIGH confidence → geometry behaviors (source of truth);
      //    LOW/UNREAD → PRESERVE existingProfile behaviors (never overwrite an incomplete read), flagged.
      const geomRows = clusterRows(await parsePositioned(buffer));
      const { profile: assessmentProfile, reviewFlags } = assembleRefreshProfile(llmProfile, geomRows, existingProfile);

      // GUARD 1 — required-field validation (pure, unit-tested in assessmentRefresh.test.mjs). A
      // clinically valid assessment must contain ALL required fields; an empty result for ANY means the
      // extraction failed (a scan, an unsupported agency format, or a bad LLM response) and must NEVER
      // wipe a real profile. The source PDF is already saved above; here we only refuse to touch the
      // profile. NOTE: teaching procedures are deliberately NOT required (the extractor doesn't capture
      // that field yet) — they should join the required set once extraction captures them.
      const problems = validateAssessmentProfile(assessmentProfile, extracted);

      if (problems.length) {
        return NextResponse.json(
          {
            error:
              `Extraction incomplete — the source PDF WAS SAVED to the client's Files, but the assessment ` +
              `was NOT applied and the existing profile is unchanged. Could not read from this file: ` +
              `${problems.join("; ")}. Check that the PDF contains these sections and is a text-based file ` +
              `(scanned or image-only PDFs aren't supported), then try again.`,
            fileStored: true,
          },
          { status: 422 }
        );
      }

      // REPLACEMENT COMPLETENESS GUARD — the second barrier the skills side lacked. If the replacement domain
      // wasn't located, or the new catalog is empty / a large unexplained drop, do NOT wholesale-overwrite the
      // programs (Felix: 18→9 slipped through because skills had no guard). Preserve the previous, flagged.
      const prevReplacements = (existingProfile.replacementBehaviors || []) as any[];
      const replCheck = assessReplacementCompleteness((assessmentProfile.replacementBehaviors || []).length, prevReplacements.length, replacementDomainFound);
      if (!replCheck.refresh && prevReplacements.length) {
        assessmentProfile.replacementBehaviors = existingProfile.replacementBehaviors;
        reviewFlags.push({ field: "replacementBehaviors", source: "guard-preserved", reason: replCheck.reason });
      }

      // INTERVENTIONS COMPLETENESS GUARD — note-critical (every ABC names one), wholesale-refreshed with only
      // empty-validation, so a partial drop (e.g. 33→3) would overwrite silently. Same shape as replacements.
      const prevInterventions = (existingProfile.interventions || []) as any[];
      const intCheck = assessInterventionCompleteness((assessmentProfile.interventions || []).length, prevInterventions.length, interventionDomainFound);
      if (!intCheck.refresh && prevInterventions.length) {
        assessmentProfile.interventions = existingProfile.interventions;
        reviewFlags.push({ field: "interventions", source: "guard-preserved", reason: intCheck.reason });
      }

      // GUARD 2 — the refresh merge (pure, unit-tested): preserves non-assessment keys (observedCatalog,
      // blockedNarrativeTerms, continuityContext, …), replaces assessment-sourced keys wholesale, and
      // snapshots the pre-refresh profile as `previousProfile` for one-level undo (restored by
      // /api/clients/[id]/profile/restore). A whole-profile snapshot, so it also covers any future key.
      const refreshed = buildRefreshedProfile(existingProfile, assessmentProfile);

      // FUNCTION PROVENANCE (packet-sourced): if a FAST/MAS/functional-assessment source was located and fed
      // to extraction, functions may be documented; otherwise they are INFERRED — never stored as documented.
      // Coarse (document-level presence of the source, not a per-row table match — that is a follow-up).
      const functionEvidence = hasFunctionalAssessment ? "documented-functional-assessment" : "inferred";
      for (const b of ((refreshed as any).maladaptiveBehaviors || [])) {
        if (b && b.functionsSource !== "human-edited") b.functionsEvidence = functionEvidence;
      }
      if (!hasFunctionalAssessment) reviewFlags.push({ field: "functions", source: "llm-fallback", reason: "no functional-assessment (FAST/MAS) source was located — behavior functions are inferred, not documented; verify with the BCBA" });
      if (!behaviorDomainFound) reviewFlags.push({ field: "behaviors", source: "guard-preserved", reason: "the maladaptive-behavior section could not be located in this upload — behaviors were not refreshed from it" });

      // reviewFlags is a non-clinical key (preserved by buildRefreshedProfile's spread) — surfaced to the
      // RBT/BCBA as a "Needs review" banner. A flagged field is an LLM fallback, never a verified read.
      (refreshed as any).reviewFlags = reviewFlags;

      // COLUMN SYNC: write the clients.diagnosis COLUMN from the SAME normalized diagnosis as the JSON, so
      // the column (set once at create, previously never updated on refresh) can no longer drift from
      // clinical_profile.diagnosis. diagnosisColumn re-normalizes defensively — no Z-code / suspected code
      // can reach the column even if a future caller passes a raw profile.
      await prisma.clients.update({
        where: { id: clientId },
        data: {
          clinical_profile: refreshed,
          diagnosis: diagnosisColumn((refreshed as any).diagnosis),
        },
      });

      return NextResponse.json({ ...refreshed, updated: true, fileStored: true });
    }

    // No clientId: return the extraction without writing (unchanged; still uses mapToLegacyFormat).
    return NextResponse.json({ ...mapToLegacyFormat(extracted) });
  } catch (error: any) {
    console.error(error);

    return NextResponse.json(
      {
        error: "Extraction failed",
        details: error?.message || String(error),
      },
      { status: 500 }
    );
  }
}
