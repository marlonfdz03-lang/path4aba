import { NextRequest, NextResponse } from "next/server";
import { extractAssessment, ExtractedAssessment } from "@/lib/extractAssessment";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { parsePdf, hasBlockedTerm, cleanText, mapToLegacyFormat, saveKnowledgeBase } from "@/lib/assessmentPipeline";

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

    const normalized = mapToLegacyFormat(extracted);

    // ── If clientId provided: merge into existing clinical_profile ─────────
    const clientId = formData.get("clientId") as string | null;
    if (clientId) {
      const session = await auth();
      if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

      const existing = await prisma.clients.findUnique({
        where: { id: clientId },
        select: { clinical_profile: true },
      });
      if (!existing) return NextResponse.json({ error: "Client not found" }, { status: 404 });

      const existingProfile = (existing.clinical_profile as any) || {};
      const existingBehaviors: any[] = existingProfile.maladaptiveBehaviors || [];
      const existingMastered: string[] = existingProfile.masteredBehaviors || [];

      // Names mastered in the new assessment
      const masteredNamesLower = new Set(
        normalized.maladaptiveBehaviors
          .filter((b: any) => b.status?.toLowerCase() === "mastered")
          .map((b: any) => b.name.toLowerCase())
      );

      // Keep existing behaviors unless newly mastered
      const keptExisting = existingBehaviors.filter(
        (b: any) => !masteredNamesLower.has(b.name.toLowerCase())
      );

      // Add new active behaviors not already present
      const existingNames = new Set(existingBehaviors.map((b: any) => b.name.toLowerCase()));
      const addedNew = normalized.maladaptiveBehaviors.filter(
        (b: any) => !existingNames.has(b.name.toLowerCase()) && b.status?.toLowerCase() !== "mastered"
      );

      // Accumulate mastered behavior names
      const allMastered = [
        ...existingMastered,
        ...Array.from(masteredNamesLower),
      ].filter((v, i, a) => a.indexOf(v) === i);

      const merged = {
        ...existingProfile,
        maladaptiveBehaviors: [...keptExisting, ...addedNew],
        masteredBehaviors: allMastered,
        interventions: normalized.interventions.length
          ? normalized.interventions
          : (existingProfile.interventions || []),
        replacementBehaviors: normalized.replacementBehaviors.length
          ? normalized.replacementBehaviors
          : (existingProfile.replacementBehaviors || []),
        skillAcquisition: normalized.skillAcquisition.length
          ? normalized.skillAcquisition
          : (existingProfile.skillAcquisition || []),
        reinforcers: normalized.reinforcers.length
          ? normalized.reinforcers
          : (existingProfile.reinforcers || []),
        // REFRESH activities: normalized already carries the curated baseline + the assessment's SPLIT
        // activities (mapToLegacyFormat → buildActivityLists), so it is ALWAYS populated and always wins.
        // A flat/untagged assessment list was discarded upstream, never misplaced. The read-time home/
        // school split (0d1b567) is untouched.
        homeActivities: normalized.homeActivities,
        schoolActivities: normalized.schoolActivities,
        parentTrainingGoals: normalized.parentTrainingGoals.length
          ? normalized.parentTrainingGoals
          : (existingProfile.parentTrainingGoals || []),
        diagnosis: normalized.diagnosis.length
          ? normalized.diagnosis
          : (existingProfile.diagnosis || []),
        caregivers: normalized.caregivers.length
          ? normalized.caregivers
          : (existingProfile.caregivers || []),
      };

      await prisma.clients.update({
        where: { id: clientId },
        data: { clinical_profile: merged },
      });

      return NextResponse.json({ ...merged, updated: true });
    }

    return NextResponse.json({ ...normalized });
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
