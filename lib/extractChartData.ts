import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY || 'azure-openai',
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/gpt-4o`,
  defaultQuery: { 'api-version': '2025-01-01-preview' },
  defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY },
})

export interface ChartHistoricalPoint {
  name: string
  targetType: 'replacement' | 'maladaptive'
  weekStart: string
  weekEnd: string | null
  value: number
}

interface PageChart {
  name: string
  category: 'maladaptive' | 'replacement'
  baseline: number | null
  dataPoints: { date: string; value: number }[]
}

const VISION_PROMPT = `You are analyzing ABA behavior and skill progress charts. These images are pages from an ABA assessment PDF.

TASK: Find every line chart or dot plot and extract ALL data points from EACH chart.

THERE ARE TWO TYPES OF CHARTS — read both:

TYPE 1 — MALADAPTIVE BEHAVIOR CHARTS (category: "maladaptive"):
- Y-axis shows raw frequency counts (e.g. 0, 10, 20, 30 … 85)
- Tracks a behavior that should DECREASE over time (tantrums, aggression, etc.)
- Section headings: "Maladaptive Behaviors", "Problem Behavior", "Target Behaviors", "Behaviors to Reduce"
- Values are whole numbers representing occurrences per week

TYPE 2 — REPLACEMENT SKILL CHARTS (category: "replacement"):
- Y-axis shows PERCENTAGE values (0%, 10%, 20% … 100%) or decimal accuracy (0.0–1.0)
- Tracks a skill that should INCREASE over time (communication, social skills, etc.)
- Section headings: "Skill Acquisition", "Replacement Behaviors", "Communication Goals", "Social Skills", "Academic Skills"
- Values represent accuracy percentage — a dot at 75% height on a 0–100% chart = value 75
- IMPORTANT: If the Y-axis goes from 0 to 100 with a "%" label, each dot's value IS its percentage (0–100). Do not multiply.

HOW TO READ EACH CHART:
1. Find the chart title or nearest heading above/beside the chart — that is the skill or behavior name.
2. Read the Y-axis scale: note the min, max, and grid line intervals.
3. Look at EVERY dot on the line. There may be 5–40 dots. Count them before extracting.
4. For each dot: read the date from the X-axis label below it, and estimate the Y value by comparing the dot's height to the Y-axis gridlines.
5. Do NOT skip dots that are close together.

DATE READING RULES:
- X-axis dates shown as MM/DD or MM/DD/YY → convert to YYYY-MM-DD (assume 2024 or 2025 based on context)
- X-axis shows month labels ("Jul", "Aug 2025") → use first day: "2025-07-01"
- X-axis shows session or week numbers only → use the label as-is ("Week 1")

BASELINE: the value before intervention — often a dotted vertical line, "B" phase marker, or the first phase's data. null if unclear.

SELF-CHECK: before returning, count the dots in each chart. Your dataPoints array length should match.

Return ONLY valid JSON — no markdown, no explanation:
{
  "charts": [
    {
      "name": "Request a Break",
      "category": "replacement",
      "baseline": 20,
      "dataPoints": [
        { "date": "2025-07-07", "value": 20 },
        { "date": "2025-07-14", "value": 35 },
        { "date": "2025-07-21", "value": 48 },
        { "date": "2025-07-28", "value": 55 }
      ]
    },
    {
      "name": "Tantrums",
      "category": "maladaptive",
      "baseline": 85,
      "dataPoints": [
        { "date": "2025-07-07", "value": 85 },
        { "date": "2025-07-14", "value": 80 }
      ]
    }
  ]
}
If no ABA progress charts appear on any of these pages, return: { "charts": [] }`

function normalizeDateString(raw: string): string {
  // MM/DD/YYYY or MM/DD/YY
  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/)
  if (slashMatch) {
    const m = parseInt(slashMatch[1])
    const d = parseInt(slashMatch[2])
    let y = slashMatch[3] ? parseInt(slashMatch[3]) : new Date().getFullYear()
    if (y < 100) y += 2000
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  // Month Year like "Jul 2024" or "July 2024"
  const monthMap: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  }
  const monthMatch = raw.match(/^([a-z]{3})[a-z]*\.?\s+(\d{4})$/i)
  if (monthMatch) {
    const mon = monthMap[monthMatch[1].toLowerCase()]
    if (mon) return `${monthMatch[2]}-${mon}-01`
  }
  // Return as-is for relative labels like "Week 1"
  return raw
}

function chartsToHistoricalPoints(charts: PageChart[]): ChartHistoricalPoint[] {
  const points: ChartHistoricalPoint[] = []
  for (const chart of charts) {
    if (!chart.name?.trim() || !Array.isArray(chart.dataPoints)) continue
    for (const dp of chart.dataPoints) {
      if (dp.value == null || dp.date == null) continue
      points.push({
        name: chart.name.trim(),
        targetType: chart.category === 'maladaptive' ? 'maladaptive' : 'replacement',
        weekStart: normalizeDateString(String(dp.date)),
        weekEnd: null,
        value: Number(dp.value),
      })
    }
  }
  return points
}

async function analyzePageBatch(base64Pngs: string[]): Promise<PageChart[]> {
  const imageContent = base64Pngs.map(b64 => ({
    type: 'image_url' as const,
    image_url: { url: `data:image/png;base64,${b64}`, detail: 'high' as const },
  }))

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0,
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: VISION_PROMPT },
            ...imageContent,
          ],
        },
      ],
    })

    const content = response.choices[0].message.content || '{}'
    const clean = content.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)
    return Array.isArray(parsed.charts) ? parsed.charts : []
  } catch (err) {
    console.error('Chart Vision batch failed:', err)
    return []
  }
}

export async function extractChartDataFromPdf(buffer: Buffer): Promise<ChartHistoricalPoint[]> {
  // Dynamic imports — pdfjs-dist legacy build requires ESM, @napi-rs/canvas is prebuilt native
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs') as any
  const { createCanvas } = require('@napi-rs/canvas')

  const pdf = await getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise

  const numPages: number = Math.min(pdf.numPages, 25)

  // Render each page to PNG base64 at scale 2× for readability
  const base64Pages: string[] = []
  for (let i = 1; i <= numPages; i++) {
    try {
      const page = await pdf.getPage(i)
      const viewport = page.getViewport({ scale: 3.0 })
      const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height))
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport }).promise
      base64Pages.push((canvas.toBuffer('image/png') as Buffer).toString('base64'))
    } catch (err) {
      console.error(`PDF page ${i} render failed:`, err)
    }
  }

  if (base64Pages.length === 0) return []

  // Send pages to GPT-4o Vision in batches of 5 (reduces API calls, respects rate limits)
  const BATCH = 5
  const allCharts: PageChart[] = []

  for (let i = 0; i < base64Pages.length; i += BATCH) {
    const batch = base64Pages.slice(i, i + BATCH)
    const charts = await analyzePageBatch(batch)
    allCharts.push(...charts)
  }

  return chartsToHistoricalPoints(allCharts)
}
