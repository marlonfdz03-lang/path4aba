import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { NOTE_PERFECTOR_PROMPT } from '@/app/prompts/notePerfectorPrompt';

export const runtime = 'nodejs';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { originalNote, clientProfile } = await req.json();

    if (!originalNote || originalNote.trim().length < 50) {
      return NextResponse.json(
        { error: 'Note is too short to refine' },
        { status: 400 }
      );
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.3,
      max_tokens: 1500,
      messages: [
        {
          role: 'system',
          content: NOTE_PERFECTOR_PROMPT
        },
        {
          role: 'user',
          content: `Refine this ABA session note. Preserve all clinical facts. Apply all quality rules.

CLIENT PROFILE CONTEXT (use to ensure interventions match approved list):
Approved interventions: ${clientProfile?.approvedInterventions?.join(', ') || 'DRA, DRI, FCT, NCR, Redirection, Behavior Momentum, Premack, Choices'}
Prohibited interventions: ${clientProfile?.prohibitedInterventions?.join(', ') || 'Punishment, ResponseCost, Restraint, TimeOut, Extinction'}
Reinforcers: ${JSON.stringify(clientProfile?.reinforcers || {})}

ORIGINAL NOTE TO REFINE:
${originalNote}`
        }
      ]
    });

    const note = response.choices[0].message.content || '';

    return NextResponse.json({ note });

  } catch (error) {
    console.error('Note refinement error:', error);
    return NextResponse.json(
      { error: 'Failed to refine note' },
      { status: 500 }
    );
  }
}