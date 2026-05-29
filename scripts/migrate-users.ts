/**
 * Migrate users from Supabase Auth → Azure PostgreSQL users table
 *
 * Run with:
 *   npx tsx scripts/migrate-users.ts
 *
 * Passwords are set to NULL — users must use "Forgot Password" to set one.
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

async function main() {
  console.log('='.repeat(60))
  console.log('Migrating Supabase Auth users → Azure PostgreSQL')
  console.log('='.repeat(60))

  // 1. Fetch all users from Supabase Auth
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  if (error) {
    console.error('Failed to fetch Supabase users:', error.message)
    process.exit(1)
  }

  const users = data.users
  console.log(`\nFound ${users.length} user(s) in Supabase Auth\n`)

  const client = await pool.connect()
  let inserted = 0
  let skipped = 0

  try {
    for (const user of users) {
      // 2. Check if already exists in Azure
      const existing = await client.query(
        'SELECT id FROM users WHERE id = $1 OR email = $2 LIMIT 1',
        [user.id, user.email]
      )

      if (existing.rowCount && existing.rowCount > 0) {
        console.log(`  SKIP  ${user.email} (already exists)`)
        skipped++
        continue
      }

      // 3. Insert with NULL password
      const name =
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        null

      const role =
        user.user_metadata?.role ||
        user.user_metadata?.profession?.toLowerCase() ||
        'rbt'

      const emailVerified = user.email_confirmed_at || null
      const createdAt = user.created_at || new Date().toISOString()

      await client.query(
        `INSERT INTO users (id, email, password, name, role, "emailVerified", created_at)
         VALUES ($1, $2, NULL, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [user.id, user.email, name, role, emailVerified, createdAt]
      )

      console.log(`  OK    ${user.email}  role=${role}  name=${name ?? '(none)'}`)
      inserted++
    }
  } finally {
    client.release()
  }

  console.log('\n' + '='.repeat(60))
  console.log(`Done. Inserted: ${inserted}  Skipped: ${skipped}`)
  console.log('='.repeat(60))
  console.log('\nNOTE: All migrated users have NULL passwords.')
  console.log('They must use "Forgot Password" to set a new password.')
}

main()
  .catch((err) => {
    console.error('\nFatal error:', err)
    process.exit(1)
  })
  .finally(() => pool.end())
