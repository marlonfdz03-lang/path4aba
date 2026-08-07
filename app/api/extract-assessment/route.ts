import { NextRequest, NextResponse } from "next/server";
import { extractAssessment, ExtractedAssessment } from "@/lib/extractAssessment";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { parsePdf, mapToLegacyFormat, saveKnowledgeBase, buildAssessmentProfile } from "@/lib/assessmentPipeline";
import { isPdf, MAX_FILE_BYTES, storeClientFile, userOwnsClient } from "@/lib/clientFiles";
import { validateAssessmentProfile, buildRefreshedProfile } from "@/lib/assessmentRefresh";
import { diagnosisColumn } from "@/lib/diagnosis";
import { parsePositioned, clusterRows } from "@/lib/pdfGeometry";
import { assembleCommit1 } from "@/lib/assembleRefreshProfile";

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

    const extracted = await extractAssessment(text.slice(0, 90000));

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

      // Keep the SOURCE PDF now — stored even if extraction fails below, so a rejected new-format PDF can be
      // debugged and the RBT need not re-upload. STORING THE FILE DOES NOT MEAN THE PROFILE WAS UPDATED.
      await storeClientFile(clientId, (session.user as any).id, file, buffer);

      // Assessment-sourced keys, built wholesale (no cleanText/hasBlockedTerm — see buildAssessmentProfile).
      const llmProfile = buildAssessmentProfile(extracted);
      // FAST/MAS Commit 1: overlay GEOMETRY-AUTHORITATIVE diagnosis + mastered-skills (structured read; F82
      // and other differentials excluded at source). LLM value kept as a FLAGGED fallback where geometry
      // could not read the structure. Same one PDF parse feeds text (LLM) and positioned rows (geometry).
      const geomRows = clusterRows(await parsePositioned(buffer));
      const { profile: assessmentProfile, reviewFlags } = assembleCommit1(llmProfile, geomRows);

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

      // GUARD 2 — the refresh merge (pure, unit-tested): preserves non-assessment keys (observedCatalog,
      // blockedNarrativeTerms, continuityContext, …), replaces assessment-sourced keys wholesale, and
      // snapshots the pre-refresh profile as `previousProfile` for one-level undo (restored by
      // /api/clients/[id]/profile/restore). A whole-profile snapshot, so it also covers any future key.
      const existingProfile = (existing.clinical_profile as any) || {};
      const refreshed = buildRefreshedProfile(existingProfile, assessmentProfile);
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
