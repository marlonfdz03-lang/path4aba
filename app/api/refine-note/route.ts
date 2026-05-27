import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { NOTE_PERFECTOR_PROMPT } from '@/app/prompts/notePerfectorPrompt';
import { supabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';

const openai = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/gpt-4o`,
  defaultQuery: { 'api-version': '2025-01-01-preview' },
  defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY },
});

function calculateSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  return intersection.size / union.size;
}

export async function POST(req: NextRequest) {
  try {
    const { originalNote, clientProfile, clientId } = await req.json();

    if (!originalNote || originalNote.trim().length < 50) {
      return NextResponse.json(
        { error: 'Note is too short to refine' },
        { status: 400 }
      );
    }

    // Fetch previous notes for similarity check (only if clientId provided)
    let previousTexts: string[] = [];
    if (clientId) {
      const { data: prevNotes } = await supabaseServer
        .from('session_notes')
        .select('note_text')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(10);
      previousTexts = (prevNotes || []).map((r: any) => r.note_text as string).filter(Boolean);
    }

    const userMessage = (noteText: string, variationHint = '') =>
      `Refine this ABA session note. Preserve all clinical facts. Apply all quality rules.${variationHint}

CLIENT PROFILE CONTEXT (use to ensure interventions match approved list):
Approved interventions: ${clientProfile?.approvedInterventions?.join(', ') || 'DRA, DRI, FCT, NCR, Redirection, Behavior Momentum, Premack, Choices'}
Prohibited interventions: ${clientProfile?.prohibitedInterventions?.join(', ') || 'Punishment, ResponseCost, Restraint, TimeOut, Extinction'}
Reinforcers: ${JSON.stringify(clientProfile?.reinforcers || {})}

ORIGINAL NOTE TO REFINE:
${noteText}`;

    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        try {
          // First pass
          const stream1 = await openai.chat.completions.create({
            model: 'gpt-4o', temperature: 0.3, max_tokens: 1500, stream: true,
            messages: [
              { role: 'system', content: NOTE_PERFECTOR_PROMPT },
              { role: 'user', content: userMessage(originalNote) }
            ]
          });
          let refinedNote = '';
          for await (const chunk of stream1) {
            const delta = chunk.choices[0]?.delta?.content || '';
            if (delta) { refinedNote += delta; controller.enqueue(encoder.encode(delta)); }
          }

          // Similarity check against previous session notes
          const tooSimilar = previousTexts.length > 0 &&
            previousTexts.some(prev => calculateSimilarity(refinedNote, prev) > 0.60);

          if (tooSimilar) {
            controller.enqueue(encoder.encode('\n__REGEN__\n'));
            const variationHint = '\n\nIMPORTANT: The refined note is too similar to a previous session note for this client. You must significantly vary the sentence starters, narrative structure, intervention descriptions, and behavior topographies. The note must read as a distinctly different session.';
            const stream2 = await openai.chat.completions.create({
              model: 'gpt-4o', temperature: 0.3, max_tokens: 1500, stream: true,
              messages: [
                { role: 'system', content: NOTE_PERFECTOR_PROMPT },
                { role: 'user', content: userMessage(originalNote, variationHint) }
              ]
            });
            let regenNote = '';
            for await (const chunk of stream2) {
              const delta = chunk.choices[0]?.delta?.content || '';
              if (delta) { regenNote += delta; controller.enqueue(encoder.encode(delta)); }
            }
            const stillSimilar = previousTexts.some(prev => calculateSimilarity(regenNote, prev) > 0.60);
            controller.enqueue(encoder.encode(`\n__META__${JSON.stringify({ similarityWarning: stillSimilar })}`));
          } else {
            controller.enqueue(encoder.encode('\n__META__{}'));
          }
        } catch (e) {
          controller.enqueue(encoder.encode(`\n__META__${JSON.stringify({ error: 'Stream error' })}`));
        } finally {
          controller.close();
        }
      }
    });

    return new Response(readable, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });

  } catch (error) {
    console.error('Note refinement error:', error);
    return NextResponse.json(
      { error: 'Failed to refine note' },
      { status: 500 }
    );
  }
}