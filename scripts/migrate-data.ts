/**
 * Data migration: Supabase → Azure PostgreSQL
 *
 * Run with:
 *   npx tsx scripts/migrate-data.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
config()

import { createClient } from '@supabase/supabase-js'
import { Pool } from 'pg'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const PAGE_SIZE = 1000
const BATCH_SIZE = 200

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchAll(table: string): Promise<any[]> {
  const rows: any[] = []
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      if (error.code === '42P01' || error.message.includes('does not exist') || error.message.includes('relation')) {
        console.log(`  ⚠  Table "${table}" not found in Supabase — skipping`)
      } else {
        console.error(`  ✗  Supabase read error: ${error.message}`)
      }
      return []
    }

    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  return rows
}

/**
 * Build a parameterized INSERT ... ON CONFLICT DO NOTHING for a batch of rows.
 * Handles arrays (text[]) and JSON columns automatically via pg's type coercion.
 */
function buildInsert(table: string, rows: any[]): { text: string; values: any[] } {
  const keys = Object.keys(rows[0])
  const values: any[] = []
  let paramIdx = 1

  const rowPlaceholders = rows.map((row) => {
    const placeholders = keys.map((k) => {
      const val = row[k]
      // pg needs JS arrays serialized for text[] columns
      if (Array.isArray(val)) {
        values.push(val)
      } else {
        values.push(val)
      }
      return `$${paramIdx++}`
    })
    return `(${placeholders.join(', ')})`
  })

  const cols = keys.map((k) => `"${k}"`).join(', ')
  const text = `INSERT INTO "${table}" (${cols}) VALUES ${rowPlaceholders.join(', ')} ON CONFLICT DO NOTHING`
  return { text, values }
}

async function insertBatches(table: string, rows: any[]): Promise<number> {
  let inserted = 0
  const client = await pool.connect()
  try {
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE)
      const { text, values } = buildInsert(table, batch)
      const result = await client.query(text, values)
      inserted += result.rowCount ?? 0
    }
  } finally {
    client.release()
  }
  return inserted
}

// ─── Per-table transforms ─────────────────────────────────────────────────────

function transformSessionNotes(row: any) {
  return {
    ...row,
    behaviors_addressed: row.behaviors_addressed ?? [],
    skills_addressed:    row.skills_addressed    ?? [],
    interventions_used:  row.interventions_used  ?? [],
    activities_used:     row.activities_used     ?? [],
  }
}

function transformFieldworkSessions(row: any) {
  return {
    ...row,
    independent_hours: row.independent_hours ?? 0,
    supervised_hours:  row.supervised_hours  ?? 0,
    total_hours:       row.total_hours       ?? 0,
  }
}

function transformFieldworkMonthlySummaries(row: any) {
  return {
    ...row,
    total_independent_hours: row.total_independent_hours ?? 0,
    total_supervised_hours:  row.total_supervised_hours  ?? 0,
    total_hours:             row.total_hours             ?? 0,
    supervision_pct:         row.supervision_pct         ?? 0,
    unrestricted_hours:      row.unrestricted_hours      ?? 0,
    restricted_hours:        row.restricted_hours        ?? 0,
    supervisor_contacts:     row.supervisor_contacts     ?? 0,
    individual_contacts:     row.individual_contacts     ?? 0,
    group_contacts:          row.group_contacts          ?? 0,
    client_observations:     row.client_observations     ?? 0,
    is_eligible:             row.is_eligible             ?? false,
    mvf_signed:              row.mvf_signed              ?? false,
  }
}

function transformFieldworkProfiles(row: any) {
  return { ...row, onboarding_complete: row.onboarding_complete ?? false }
}

function transformClientAccessCodes(row: any) {
  return { ...row, used: row.used ?? false }
}

// ─── Per-table migration ───────────────────────────────────────────────────────

async function migrate(
  tableName: string,
  transform?: (row: any) => any
): Promise<void> {
  console.log(`\nMigrating ${tableName}...`)

  const rows = await fetchAll(tableName)
  console.log(`  Found     ${rows.length} rows in Supabase`)

  if (rows.length === 0) return

  const data = transform ? rows.map(transform) : rows

  try {
    const inserted = await insertBatches(tableName, data)
    console.log(`  Inserted  ${inserted} rows into Azure`)
    if (inserted < data.length) {
      console.log(`  Skipped   ${data.length - inserted} (duplicates or conflicts)`)
    }
  } catch (err: any) {
    console.error(`  ✗  Insert error: ${err.message}`)
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60))
  console.log('Path4ABA — Supabase → Azure PostgreSQL data migration')
  console.log('='.repeat(60))
  console.log(`Source: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`)
  console.log(`Target: path4aba-db.postgres.database.azure.com`)

  await migrate('clients')
  await migrate('behaviors')
  await migrate('topographies', (r) => ({ ...r, vocabulary_variants: r.vocabulary_variants ?? [] }))
  await migrate('replacement_skills', (r) => ({ ...r, vocabulary_variants: r.vocabulary_variants ?? [] }))
  await migrate('subscriptions')
  await migrate('bcba_clients')
  await migrate('client_access_codes', transformClientAccessCodes)
  await migrate('session_notes', transformSessionNotes)
  await migrate('supervision_notes')
  await migrate('parent_training_notes')
  await migrate('missed_hours')
  await migrate('supervision_notes_97153xp')
  await migrate('fieldwork_profiles', transformFieldworkProfiles)
  await migrate('fieldwork_sessions', transformFieldworkSessions)
  await migrate('fieldwork_monthly_summaries', transformFieldworkMonthlySummaries)
  await migrate('promo_codes')
  await migrate('bcba_notes')

  console.log('\n' + '='.repeat(60))
  console.log('Migration complete.')
  console.log('='.repeat(60))
}

main()
  .catch((err) => {
    console.error('\nFatal error:', err)
    process.exit(1)
  })
  .finally(() => pool.end())
