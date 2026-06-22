import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function run() {
  console.log('Fetching all users...');
  const { data: profiles, error } = await supabase.from('profiles').select('id, user_state');
  
  if (error) {
    console.error('Error fetching profiles:', error);
    process.exit(1);
  }

  console.log(`Found ${profiles.length} profiles. Migrating...`);

  let count = 0;
  for (const p of profiles) {
    const state = p.user_state || {};
    let username = state.username || '';
    
    // Check if it already has a #1234 tag
    if (/#\d{4}$/.test(username)) {
      continue;
    }

    // Usually username is user_a1b2c3 or Antoine_123abc
    // We want to extract the name part and append a tag
    let baseName = state.firstName || username.split('_')[0] || 'User';
    baseName = baseName.replace(/[^a-zA-Z0-9]/g, '');
    if (!baseName) baseName = 'User';
    
    const tag = Math.floor(1000 + Math.random() * 9000);
    const newUsername = `${baseName}#${tag}`;
    
    state.username = newUsername;
    
    const { error: updateError } = await supabase.from('profiles').update({ user_state: state }).eq('id', p.id);
    if (updateError) {
      console.error(`Error updating ${p.id}:`, updateError);
    } else {
      console.log(`Migrated ${username} -> ${newUsername}`);
      count++;
    }
  }

  console.log(`Successfully migrated ${count} users.`);
}

run();
