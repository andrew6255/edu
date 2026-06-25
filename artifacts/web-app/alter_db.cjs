require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await supabase.rpc('exec_sql', { sql: 'ALTER TABLE logic_game_progress ADD COLUMN IF NOT EXISTS node_queues jsonb;' });
  
  if (error) {
    console.log('rpc failed, error:', error.message);
  } else {
    console.log('Success:', data);
  }
}
main();
