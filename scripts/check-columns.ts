import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const tables = ['clients', 'behaviors', 'topographies',
  'replacement_skills', 'fieldwork_profiles', 'bcba_notes']

async function main() {
  for (const table of tables) {
    const { data, error } = await supabase.from(table).select('*').limit(1)
    if (error) {
      console.log(`${table}: ERROR - ${error.message}`)
    } else if (!data?.length) {
      console.log(`${table}: EMPTY`)
    } else {
      console.log(`\n${'─'.repeat(50)}`)
      console.log(`${table} columns:`, Object.keys(data[0]))
      console.log(`${table} sample:`, JSON.stringify(data[0], null, 2))
    }
  }
}

main()
