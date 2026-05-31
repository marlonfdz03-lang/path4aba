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

const VISION_PROMPT = `Analyze these ABA assessment PDF pages for behavior/skill progress charts.

For EACH chart found on ANY of these pages, extract:
- name: the behavior or skill name (from chart title, axis label, or nearest heading)
- category: "maladaptive" if tracking a behavior to REDUCE, "replacement" if tracking a skill to INCREASE
  Clues for maladaptive: section headings like "Maladaptive Behaviors", "Problem Behavior", "Target Behaviors"; Y-axis values decreasing toward goal; frequency/rate units
  Clues for replacement: section headings like "Skill Acquisition", "Communication Goals", "Replacement"; Y-axis shows percentages or accuracy; values increasing toward goal
- baseline: the numeric baseline value if visible (red marker, dotted line, "B" label, or phase before intervention). null if unclear.
- dataPoints: ALL visible data points as { "date": "...", "value": number }
  Date format rules:
  - If MM/DD/YYYY or MM/DD/YY visible: convert to YYYY-MM-DD
  - If only Month Year (e.g. "Jul 2024"): use first day — "2024-07-01"
  - If only relative labels (e.g. "Week 1", "Session 3"): use the label as-is
  Extract EVERY data point you can read. Do not skip any.

Return ONLY valid JSON — no markdown, no explanation:
{
  "charts": [
    {
      "name": "Tantrums",
      "category": "maladaptive",
      "baseline": 85,
      "dataPoints": [
        { "date": "2024-07-01", "value": 85 },
        { "date": "2024-07-08", "value": 78 }
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
      const viewport = page.getViewport({ scale: 2.0 })
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
