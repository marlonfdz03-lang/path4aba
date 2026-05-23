import { NextRequest, NextResponse } from "next/server";
import PDFParser from "pdf2json";
import { extractAssessment, ExtractedAssessment } from "@/lib/extractAssessment";
import { supabaseServer } from "@/lib/supabaseServer";

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
      })),
    interventions: extracted.approvedInterventions
      .filter(i => !hasBlockedTerm(i))
      .map(i => ({ name: cleanText(i), status: "active" })),
    skillAcquisition: extracted.replacementSkills
      .filter(s => s.status === "mastered" && !hasBlockedTerm(s.name))
      .map(s => ({ name: cleanText(s.name), status: "active" })),
    replacementBehaviors: extracted.replacementSkills
      .filter(
        s =>
          ["acquisition", "new", "maintenance"].includes(s.status) &&
          !hasBlockedTerm(s.name)
      )
      .map(s => ({ name: cleanText(s.name), status: "active" })),
    reinforcers: [
      extracted.reinforcers.tangibles,
      extracted.reinforcers.activities,
      extracted.reinforcers.social,
      extracted.reinforcers.people,
    ]
      .filter(Boolean)
      .flatMap(r => r.split(",").map(s => s.trim()))
      .filter(r => r && !hasBlockedTerm(r))
      .map(cleanText),
    homeActivities: [],
    schoolActivities: [],
  };
}

async function saveKnowledgeBase(extracted: ExtractedAssessment) {
  // Behaviors + topographies
  for (const behavior of extracted.maladaptiveBehaviors) {
    if (!behavior.name || hasBlockedTerm(behavior.name)) continue;

    const cleanName = cleanText(behavior.name);

    const { data: existing } = await supabaseServer
      .from("behaviors")
      .select("id")
      .ilike("name", cleanName)
      .maybeSingle();

    let behaviorId = existing?.id;

    if (!behaviorId) {
      const { data: inserted } = await supabaseServer
        .from("behaviors")
        .insert({
          name: cleanName,
          category: behavior.function?.[0] || "unknown",
        })
        .select("id")
        .single();
      behaviorId = inserted?.id;
    }

    if (behaviorId && behavior.topography) {
      const cleanTop = cleanText(behavior.topography);
      if (!hasBlockedTerm(cleanTop)) {
        const { data: existingTop } = await supabaseServer
          .from("topographies")
          .select("id")
          .eq("behavior_id", behaviorId)
          .ilike("description", cleanTop)
          .maybeSingle();

        if (!existingTop) {
          await supabaseServer.from("topographies").insert({
            behavior_id: behaviorId,
            description: cleanTop,
            measurable_unit: behavior.measurableUnit || "frequency",
            severity_level: behavior.intensity || 3,
          });
        }
      }
    }
  }

  // Interventions
  for (const intervention of extracted.approvedInterventions) {
    if (!intervention || hasBlockedTerm(intervention)) continue;

    const cleanName = cleanText(intervention);

    const { data: existing } = await supabaseServer
      .from("interventions")
      .select("id")
      .ilike("name", cleanName)
      .maybeSingle();

    if (!existing) {
      await supabaseServer
        .from("interventions")
        .insert({ name: cleanName });
    }
  }

  // Replacement skills
  for (const skill of extracted.replacementSkills) {
    if (!skill.name || hasBlockedTerm(skill.name)) continue;

    const cleanName = cleanText(skill.name);

    const { data: existing } = await supabaseServer
      .from("replacement_skills")
      .select("id")
      .ilike("skill_description", cleanName)
      .maybeSingle();

    if (!existing) {
      const { data: matchingBehavior } = await supabaseServer
        .from("behaviors")
        .select("id")
        .ilike("category", skill.targetFunction)
        .maybeSingle();

      await supabaseServer.from("replacement_skills").insert({
        skill_description: cleanName,
        function_targeted: skill.targetFunction || "unknown",
        behavior_id: matchingBehavior?.id || null,
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

    return NextResponse.json(normalized);
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
