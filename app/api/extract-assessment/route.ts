import { NextRequest, NextResponse } from "next/server";
import PDFParser from "pdf2json";
import { extractAssessment, ExtractedAssessment } from "@/lib/extractAssessment";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export const maxDuration = 60;

export const runtime = "nodejs";

function safeDecode(text: string) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function parsePdf(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();

    pdfParser.on(
      "pdfParser_dataError",
      (errData: any) => {
        reject(
          errData?.parserError || errData
        );
      }
    );

    pdfParser.on(
      "pdfParser_dataReady",
      (pdfData: any) => {
        try {
          const pages =
            pdfData?.Pages || [];

          const text = pages
            .map((page: any) => {
              const texts =
                page?.Texts || [];

              return texts
                .map(
                  (textItem: any) => {
                    const runs =
                      textItem?.R || [];

                    return runs
                      .map((r: any) =>
                        safeDecode(
                          r?.T || ""
                        )
                      )
                      .join(" ");
                  }
                )
                .join(" ");
            })
            .join("\n");

          resolve(text);
        } catch (error) {
          reject(error);
        }
      }
    );

    pdfParser.parseBuffer(buffer);
  });
}

function hasBlockedTerm(text: string) {
  const blockedTerms = [
    "speech therapy",
    "speech/language therapy",
    "speech-language therapy",
    "occupational therapy",
    "physical therapy",
    "counseling",
    "tutoring",
    "homework",
    "academic tutoring",
    "feeding therapy",
    "response blocking",
    "response block",
    "restraint",
    "punishment",
    "response cost",
    "overcorrection",
    "aversive",
    "escape independent response delivery",
    "attention independent response delivery",
  ];

  const lower = text.toLowerCase();

  return blockedTerms.some((term) =>
    lower.includes(term)
  );
}

function cleanText(text: string) {
  return text
    .replace(
      /Summer program/gi,
      "classroom activity"
    )
    .replace(
      /Learning\/Academics/gi,
      "classroom activity"
    )
    .replace(
      /Speech\/language therapy/gi,
      "classroom activity"
    )
    .replace(
      /Response Block/gi,
      ""
    )
    .replace(
      /Response Blocking/gi,
      ""
    )
    .replace(
      /Escape Independent Response Delivery/gi,
      ""
    )
    .replace(
      /Attention Independent Response Delivery/gi,
      ""
    )
    .replace(
      /being rude to others when things do not go his way/gi,
      "using a loud voice toward peers"
    )
    .replace(
      /turns his head/gi,
      "turning his head away"
    )
    .replace(
      /throwing any item against any hard surface/gi,
      "throwing nearby materials"
    )
    .replace(
      /occurs when ignored by adults/gi,
      "crying or vocalizing when attention is unavailable"
    )
    .replace(
      /by occurs/gi,
      "by engaging in"
    )
    .replace(
      /by engages/gi,
      "by engaging in"
    )
    .replace(
      /by turns/gi,
      "by turning"
    )
    .replace(
      /following during/gi,
      "during"
    )
    .replace(
      /following waiting/gi,
      "while waiting"
    )
    .replace(
      /following after/gi,
      "after"
    )
    .replace(
      /after during/gi,
      "during"
    )
    .replace(
      /during participating/gi,
      "while participating"
    )
    .replace(
      /during following/gi,
      "while following"
    )
    .replace(/\s+/g, " ")
    .trim();
}

function mapToLegacyFormat(extracted: ExtractedAssessment) {
  return {
    maladaptiveBehaviors: extracted.maladaptiveBehaviors
      .filter(b => !hasBlockedTerm(b.name))
      .map(b => ({
        name: cleanText(b.name),
        status: "active",
        topographies: [cleanText(b.topography)].filter(
          t => t && !hasBlockedTerm(t)
        ),
        functions: Array.isArray(b.function) ? b.function : b.function ? [b.function] : [],
      })),
    interventions: extracted.approvedInterventions
      .filter(i => !hasBlockedTerm(i))
      .map(i => ({ name: cleanText(i), status: "active" })),
    skillAcquisition: extracted.replacementSkills
      .filter(s => s.status?.toLowerCase() === "mastered" && !hasBlockedTerm(s.name))
      .map(s => ({ name: cleanText(s.name), status: "active", targetFunction: s.targetFunction || "" })),
    replacementBehaviors: extracted.replacementSkills
      .filter(s => s.status?.toLowerCase() !== "mastered" && !hasBlockedTerm(s.name))
      .map(s => ({ name: cleanText(s.name), status: "active", targetFunction: s.targetFunction || "" })),
    reinforcers: [
      extracted.reinforcers.tangibles,
      extracted.reinforcers.activities,
      extracted.reinforcers.social,
      extracted.reinforcers.people,
    ]
      .filter(Boolean)
      .flatMap(r => {
        const str = Array.isArray(r) ? r.join(", ") : String(r);
        return str.split(",").map(s => s.trim());
      })
      .filter(r => r && !hasBlockedTerm(r))
      .map(cleanText),
    homeActivities: [],
    schoolActivities: [],
    parentTrainingGoals: extracted.parentTrainingGoals ||
                         (extracted as any).caregiverTrainingGoals ||
                         (extracted as any).familyTrainingGoals ||
                         (extracted as any).parentEducationGoals ||
                         (extracted as any).caregiverObjectives || [],
    diagnosis: extracted.diagnosis || [],
    caregivers: extracted.caregivers || [],
  };
}

async function saveKnowledgeBase(extracted: ExtractedAssessment) {
  // Behaviors + topographies
  for (const behavior of extracted.maladaptiveBehaviors) {
    if (!behavior.name || hasBlockedTerm(behavior.name)) continue;

    const cleanName = cleanText(behavior.name);

    const existing = await prisma.behaviors.findFirst({
      where: { name: { equals: cleanName, mode: "insensitive" } },
      select: { id: true },
    });

    let behaviorId = existing?.id;

    if (!behaviorId) {
      const inserted = await prisma.behaviors.create({
        data: {
          name: cleanName,
          category: behavior.function?.[0] || "unknown",
        },
        select: { id: true },
      });
      behaviorId = inserted.id;
    }

    if (behaviorId && behavior.topography) {
      const cleanTop = cleanText(behavior.topography);
      if (!hasBlockedTerm(cleanTop)) {
        const existingTop = await prisma.topographies.findFirst({
          where: {
            behavior_id: behaviorId,
            description: { equals: cleanTop, mode: "insensitive" },
          },
          select: { id: true },
        });

        if (!existingTop) {
          await prisma.topographies.create({
            data: {
              behavior_id: behaviorId,
              description: cleanTop,
              measurable_unit: behavior.measurableUnit || "frequency",
              severity_level: behavior.intensity || 3,
            },
          });
        }
      }
    }
  }

  // Replacement skills
  for (const skill of extracted.replacementSkills) {
    if (!skill.name || hasBlockedTerm(skill.name)) continue;

    const cleanName = cleanText(skill.name);

    const existing = await prisma.replacement_skills.findFirst({
      where: { skill_description: { equals: cleanName, mode: "insensitive" } },
      select: { id: true },
    });

    if (!existing) {
      const matchingBehavior = await prisma.behaviors.findFirst({
        where: { category: { equals: skill.targetFunction, mode: "insensitive" } },
        select: { id: true },
      });

      await prisma.replacement_skills.create({
        data: {
          skill_description: cleanName,
          function_targeted: skill.targetFunction || "unknown",
          behavior_id: matchingBehavior?.id || null,
        },
      });
    }
  }
}

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
