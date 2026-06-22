import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function run() {
  const { data: profiles, error } = await supabase.from('profiles').select('id, username, user_state');
  if (error) {
    console.error('Error fetching profiles:', error);
    process.exit(1);
  }

  let count = 0;
  for (const p of profiles) {
    const stateUsername = p.user_state?.username;
    if (stateUsername && stateUsername !== p.username) {
      const { error: updateError } = await supabase.from('profiles')
        .update({ username: stateUsername })
        .eq('id', p.id);
      
      if (updateError) {
        console.error(`Error updating ${p.id}:`, updateError);
      } else {
        console.log(`Synced username for ${p.username} -> ${stateUsername}`);
        count++;
      }
    }
  }

  console.log(`Successfully synced ${count} users.`);
}

run();
